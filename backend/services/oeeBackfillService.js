const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { calcMcStatusDurations, calcAvailability, calcPerformance } = require("./oeeCalcService");
const { SHIFT_HOURS } = require("../utils/timeUtils");

/**
 * Recalculate OEE (Availability & Performance) for a specific machine on a specific date.
 */
async function recalculateAPQForDay(machineName, targetDate) {
    try {
        const dateStr = targetDate.toISOString().split("T")[0];

        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(5, 7)) - 1;
        const day = parseInt(dateStr.substring(8, 10));

        const shiftStart = new Date(Date.UTC(year, month, day, 7, 0, 0));
        const shiftEnd = new Date(Date.UTC(year, month, day + 1, 7, 0, 0));

        const mcStatusRows = await prisma.tb_MCStatus.findMany({
            where: {
                MC: machineName,
                Datetime: { gte: shiftStart, lt: shiftEnd }
            },
            orderBy: { Datetime: "asc" },
            select: { MC: true, Datetime: true, MCStatus: true },
        });

        const carryOverRows = await prisma.$queryRaw`
            SELECT MC, MCStatus, Datetime FROM (
                SELECT MC, MCStatus, Datetime, ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn
                FROM tb_MCStatus WHERE MC = ${machineName} AND Datetime < ${shiftStart}
            ) t WHERE rn = 1
        `;

        const mcRecords = [];
        if (carryOverRows && carryOverRows.length > 0) {
            mcRecords.push({ MC: carryOverRows[0].MC, Datetime: shiftStart, MCStatus: carryOverRows[0].MCStatus });
        }
        mcRecords.push(...mcStatusRows);

        if (mcRecords.length === 0) {
            console.log(`[OEE Backfill] Null MCStatus data for ${machineName} on ${dateStr}`);
            return;
        }

        const [outputRow, targetRow] = await Promise.all([
            prisma.tb_output_actual.findFirst({ where: { machine_name: machineName, date: targetDate } }),
            prisma.tb_output_target.findFirst({ where: { machine_name: machineName, date: targetDate } }),
        ]);

        let runTimeSeconds = 0;
        let excludedSeconds = 0;
        let totalActiveSeconds = 0;
        let totalOutput = 0;

        for (let i = 0; i < SHIFT_HOURS.length; i++) {
            const h = SHIFT_HOURS[i];
            const isActive = !targetRow || (targetRow[`target_${h}`] > 0);
            
            if (isActive) {
                totalOutput += (outputRow ? (outputRow[`actual_${h}`] || 0) : 0);

                const hStart = new Date(shiftStart.getTime() + i * 3600000);
                const hEnd = new Date(hStart.getTime() + 3600000);
                const { runTimeSeconds: rTime, excludedSeconds: eTime } = calcMcStatusDurations(mcRecords, hStart, hEnd);
                
                runTimeSeconds += rTime;
                excludedSeconds += eTime;
                totalActiveSeconds += 3600;
            }
        }

        const availability = calcAvailability(runTimeSeconds, excludedSeconds, totalActiveSeconds);
        const idealCT = targetRow?.cycle_time_target || 0;
        const performance = calcPerformance(totalOutput, idealCT, runTimeSeconds);

        const existingOee = await prisma.tb_oee.findFirst({ where: { machine_name: machineName, date: targetDate } });
        const finalNgQty = existingOee?.ng_qty || 0;
        const quality = totalOutput > 0 ? ((totalOutput - finalNgQty) / totalOutput) * 100 : 0;

        const oeeValue = (availability > 0 && performance > 0 && quality > 0)
            ? (availability / 100) * (performance / 100) * (quality / 100) * 100
            : 0;

        const dataToWrite = {
            availability: parseFloat(availability.toFixed(2)),
            performance: parseFloat(performance.toFixed(2)),
            ng_qty: finalNgQty,
            quality: parseFloat(quality.toFixed(2)),
            oee_value: parseFloat(oeeValue.toFixed(2)),
        };

        await prisma.tb_oee.upsert({
            where: { machine_name_date: { machine_name: machineName, date: targetDate } },
            update: dataToWrite,
            create: {
                date: targetDate,
                machine_name: machineName,
                ...dataToWrite
            },
        });

        console.log(`✅ [OEE Backfill Recalculation] ${machineName} on ${dateStr}: A=${dataToWrite.availability}%, P=${dataToWrite.performance}%`);

    } catch (err) {
        console.error(`❌ [OEE Backfill Recalculation] Failed for ${machineName} on ${targetDate}:`, err.message);
    }
}

module.exports = {
    recalculateAPQForDay
};

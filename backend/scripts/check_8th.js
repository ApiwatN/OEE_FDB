const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { calcMcStatusDurations, calcAvailability, calcPerformance } = require("./services/oeeCalcService");
const { SHIFT_HOURS } = require("./utils/timeUtils");

async function checkData() {
    const machineName = "AHV-001";
    const targetDate = new Date("2026-03-08T00:00:00.000Z");

    const dateStr = targetDate.toISOString().split("T")[0];
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(5, 7)) - 1;
    const day = parseInt(dateStr.substring(8, 10));

    const broadStart = new Date("2026-03-07T17:00:00.000Z"); // Broad net
    const broadEnd = new Date("2026-03-09T17:00:00.000Z");   // Broad net

    const shiftStart = new Date(Date.UTC(year, month, day, 7, 0, 0));
    const shiftEnd = new Date(Date.UTC(year, month, day + 1, 7, 0, 0));

    console.log("shiftStart:", shiftStart);
    console.log("shiftEnd:", shiftEnd);

    const mcStatusRows = await prisma.tb_MCStatus.findMany({
        where: {
            MC: machineName,
            Datetime: { gte: broadStart, lt: broadEnd }
        },
        orderBy: { Datetime: "asc" },
        select: { MC: true, Datetime: true, MCStatus: true },
    });

    console.log("Broad Date Range Records count:", mcStatusRows.length);
    if (mcStatusRows.length > 0) {
        console.log("First record:", mcStatusRows[0]);
        console.log("Last record:", mcStatusRows[mcStatusRows.length - 1]);
    }

    const [outputRow, targetRow] = await Promise.all([
        prisma.tb_output_actual.findFirst({ where: { machine_name: machineName, date: targetDate } }),
        prisma.tb_output_target.findFirst({ where: { machine_name: machineName, date: targetDate } }),
    ]);

    console.log("Output Actual:", outputRow ? outputRow.Overall : null);
    console.log("Target Cycle Time:", targetRow ? targetRow.cycle_time_target : null);

    // Quick calc string
    const mcRecords = [...mcStatusRows];
    console.log("Records length:", mcRecords.length);
    if (mcRecords.length > 0) {
        const { runTimeSeconds, excludedSeconds, totalSeconds } = calcMcStatusDurations(mcRecords, shiftStart, shiftEnd);
        console.log("runTime:", runTimeSeconds, "total:", totalSeconds);
        const ava = calcAvailability(runTimeSeconds, excludedSeconds, totalSeconds);
        console.log("calculated Availability:", ava);
    }
}

checkData().then(() => process.exit(0)).catch(e => console.error(e));

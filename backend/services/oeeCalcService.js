/**
 * OEE Calculation Service — Shared functions for Availability & Performance
 * Used by: realtimeService.js (socket every 5s), cronService.js (hourly upsert tb_oee)
 */

// MC Statuses that are excluded from operating time (not counted as downtime NOR running)
const EXCLUDED_STATUSES = new Set(["Plan_Stop", "Break_Time", "Preventive"]);
// MC Status that counts as running
const RUNNING_STATUS = "Run_Time";

/**
 * Check if status should be excluded. Also catches any status containing 'Preventive'
 */
function isExcludedStatus(status) {
    if (!status) return false;
    if (EXCLUDED_STATUSES.has(status)) return true;
    if (status.includes("Preventive")) return true;
    return false;
}

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { SHIFT_HOURS } = require("../utils/timeUtils");
const path = require('path');
let machineCalcConfig = null;

function getMachineRunTimeMode(machineName) {
    if (!machineCalcConfig) {
        try {
            const configPath = path.join(__dirname, '../config/machine_calc.json');
            machineCalcConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error("⚠️ [Config] failed to load machine_calc.json:", e.message);
            machineCalcConfig = { default_mode: "status_based", custom_modes: {}, ct_calc_modes: { default: "runtime_based" } };
        }
    }
    
    // Check prefix match
    for (const prefix of Object.keys(machineCalcConfig.custom_modes)) {
        if (machineName.startsWith(prefix)) {
            return machineCalcConfig.custom_modes[prefix];
        }
    }
    return machineCalcConfig.default_mode || "status_based";
}

/**
 * Get CT calculation mode for a machine (runtime_based or influx_avg)
 */
function getCTCalcMode(machineName) {
    if (!machineCalcConfig) {
        getMachineRunTimeMode(machineName); // Force load config
    }
    
    if (machineCalcConfig.ct_calc_modes) {
        for (const prefix of Object.keys(machineCalcConfig.ct_calc_modes)) {
            if (prefix !== 'default' && machineName.startsWith(prefix)) {
                return machineCalcConfig.ct_calc_modes[prefix];
            }
        }
    }
    return machineCalcConfig.ct_calc_modes?.default || "runtime_based";
}

/**
 * Get Quality calculation mode (visual_ng or over_reject)
 */
function getNgMode(machineName) {
    if (!machineCalcConfig) {
        getMachineRunTimeMode(machineName); // Force load config
    }
    
    if (machineCalcConfig.ng_modes) {
        for (const prefix of Object.keys(machineCalcConfig.ng_modes)) {
            if (prefix !== 'default' && machineName.startsWith(prefix)) {
                return machineCalcConfig.ng_modes[prefix];
            }
        }
    }
    return machineCalcConfig.ng_modes?.default || "visual_ng";
}

/**
 * Calculate run time and excluded time from MC Status records for a given shift period.
 *
 * @param {Array<{Datetime: Date, MCStatus: string}>} records - sorted by Datetime ASC
 * @param {Date} shiftStart - shift start time (e.g. 07:00 TH)
 * @param {Date} endTime - current time or shift end time
 * @returns {{ runTimeSeconds: number, excludedSeconds: number, totalSeconds: number }}
 */
function calcMcStatusDurations(records, shiftStart, endTime) {
    let runTimeSeconds = 0;
    let excludedSeconds = 0;
    const totalSeconds = Math.max(0, (endTime - shiftStart) / 1000);

    if (records.length === 0) {
        return { runTimeSeconds: 0, excludedSeconds: 0, totalSeconds };
    }

    for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const segStart = new Date(Math.max(rec.Datetime.getTime(), shiftStart.getTime()));
        const segEnd = i + 1 < records.length
            ? new Date(Math.min(records[i + 1].Datetime.getTime(), endTime.getTime()))
            : endTime;

        const durationSec = Math.max(0, (segEnd - segStart) / 1000);

        if (rec.MCStatus === RUNNING_STATUS) {
            runTimeSeconds += durationSec;
        } else if (isExcludedStatus(rec.MCStatus)) {
            excludedSeconds += durationSec;
        }
        // Other statuses = downtime (not counted in either)
    }

    return { runTimeSeconds, excludedSeconds, totalSeconds };
}

/**
 * Calculate run time and excluded time from MC Status records split per hour
 *
 * @param {Array<{Datetime: Date, MCStatus: string}>} records - sorted by Datetime ASC
 * @param {Date} shiftStart - shift start time
 * @param {number} shiftHours - number of hours to calculate (default 24)
 * @returns {Array<{ runTimeSeconds: number, excludedSeconds: number, totalSeconds: number }>}
 */
function calcMcStatusDurationsPerHour(records, shiftStart, shiftHours = 24) {
    const hourlyDurations = [];
    
    for (let i = 0; i < shiftHours; i++) {
        const hourStart = new Date(shiftStart.getTime() + i * 3600000);
        const hourEnd = new Date(hourStart.getTime() + 3600000);
        hourlyDurations.push(calcMcStatusDurations(records, hourStart, hourEnd));
    }
    
    return hourlyDurations;
}

/**
 * Calculate Availability %
 * Availability = RunTime / OperatingTime × 100
 * OperatingTime = TotalTime − ExcludedTime
 *
 * @param {number} runTimeSeconds
 * @param {number} excludedSeconds
 * @param {number} totalSeconds
 * @returns {number} availability percentage (0–100+)
 */
function calcAvailability(runTimeSeconds, excludedSeconds, totalSeconds) {
    const operatingTime = totalSeconds - excludedSeconds;
    if (operatingTime <= 0) return 0;
    return (runTimeSeconds / operatingTime) * 100;
}

/**
 * Calculate Performance %
 * Performance = (TotalOutput × IdealCT) / RunTime × 100
 *
 * @param {number} totalOutput - total pieces produced
 * @param {number} idealCT - ideal cycle time in seconds
 * @param {number} runTimeSeconds - total run time in seconds
 * @returns {number} performance percentage (0–100+)
 */
function calcPerformance(totalOutput, idealCT, runTimeSeconds) {
    if (runTimeSeconds <= 0 || idealCT <= 0) return 0;
    return (totalOutput * idealCT) / runTimeSeconds * 100;
}

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
    EXCLUDED_STATUSES,
    RUNNING_STATUS,
    isExcludedStatus,
    calcMcStatusDurations,
    calcMcStatusDurationsPerHour,
    calcAvailability,
    calcPerformance,
    getMachineRunTimeMode,
    getCTCalcMode,
    getNgMode,
    recalculateAPQForDay
};

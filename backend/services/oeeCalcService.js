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
let machineCalcConfig = null;

function getMachineRunTimeMode(machineName) {
    if (!machineCalcConfig) {
        try {
            const configPath = path.join(__dirname, '../config/machine_calc.json');
            machineCalcConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error("⚠️ [Config] failed to load machine_calc.json:", e.message);
            machineCalcConfig = { default_mode: "status_based", custom_modes: {} };
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

module.exports = {
    EXCLUDED_STATUSES,
    RUNNING_STATUS,
    isExcludedStatus,
    getMachineRunTimeMode,
    calcMcStatusDurations,
    calcAvailability,
    calcPerformance,
};

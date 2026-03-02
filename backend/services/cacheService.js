/**
 * Cache Service — In-Memory Cache Layer
 * เก็บข้อมูลรายชั่วโมงของวันปัจจุบันไว้ใน memory เพื่อลด MSSQL load
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { SHIFT_HOURS, utcHourToThColumn, getShiftDateUTC, getShiftIndex } = require("../utils/timeUtils");

// ==================== Cache Storage ====================

// Machine actual data cache: { machineName: { date, output: {}, cycleTime: {}, efficiency: {}, overall: {} } }
const machineCache = {};

// Target data cache: { machineName: { date, target: { target_07: 100, ... } } }
const targetCache = {};

// Machine list cache: [{ id, machine_name, machine_area, machine_type }]
let machineListCache = [];

// ==================== Machine List ====================

/**
 * Load machine list from MSSQL (run once at startup)
 */
async function loadMachineList() {
    try {
        const machines = await prisma.tbm_machine.findMany({
            where: { status: "active" },
            select: {
                id: true,
                machine_name: true,
                machine_area: true,
                machine_type: true,
            },
            orderBy: { machine_name: "asc" },
        });
        machineListCache = machines;
        console.log(`📋 Machine list loaded: ${machines.length} machines`);
        return machines;
    } catch (err) {
        console.error("❌ Failed to load machine list:", err.message);
        return [];
    }
}

function getMachineList() {
    return machineListCache;
}

function getMachineNames() {
    return machineListCache.map((m) => m.machine_name);
}

// ==================== Cache CRUD ====================

/**
 * Initialize cache entry for a machine+date
 */
function initMachineCache(machineName, dateStr) {
    if (!machineCache[machineName] || machineCache[machineName].date !== dateStr) {
        machineCache[machineName] = {
            date: dateStr,
            output: {},       // { actual_07: 120, actual_08: 150, ... }
            cycleTime: {},    // { cycle_07: 18.5, cycle_08: 19.2, ... }
            efficiency: {},   // { eff_07: 85.2, eff_08: 90.1, ... }
            overall: {
                totalOutput: 0,
                avgCycleTime: 0,
                totalEfficiency: 0,
            },
        };
    }
}

/**
 * Update a specific hour in cache
 */
function updateHour(machineName, thColumn, outputCount, avgCycleTime, efficiency) {
    const dateStr = getShiftDateUTC();
    initMachineCache(machineName, dateStr);

    const cache = machineCache[machineName];
    cache.output[`actual_${thColumn}`] = outputCount;
    cache.cycleTime[`cycle_${thColumn}`] = parseFloat(avgCycleTime.toFixed(2));
    cache.efficiency[`eff_${thColumn}`] = parseFloat(efficiency.toFixed(2));

    // Recalculate overall
    recalcOverall(machineName);
}

/**
 * Recalculate overall values from all cached hours
 */
function recalcOverall(machineName) {
    const cache = machineCache[machineName];
    if (!cache) return;

    let sumOutput = 0;
    let sumCtWeighted = 0; // SUM(ct * count) for weighted average
    let totalOutputForCt = 0;

    for (const h of SHIFT_HOURS) {
        const output = cache.output[`actual_${h}`] || 0;
        const ct = cache.cycleTime[`cycle_${h}`] || 0;

        sumOutput += output;

        if (output > 0 && ct > 0) {
            sumCtWeighted += ct * output;
            totalOutputForCt += output;
        }
    }

    // วันนี้: ใช้ shift index ปัจจุบัน / วันเก่า: กะจบแล้ว = 24 ชม.
    const todayStr = getShiftDateUTC();
    const cacheDate = cache.date || '';
    const isToday = cacheDate === todayStr;
    let totalHoursPassed;
    if (isToday) {
        const currentShiftIdx = getShiftIndex(utcHourToThColumn(new Date().getUTCHours()));
        totalHoursPassed = Math.min(currentShiftIdx + 1, SHIFT_HOURS.length);
    } else {
        totalHoursPassed = SHIFT_HOURS.length; // 24
    }

    // Only count hours that have output target > 0
    const target = targetCache[machineName]?.target || {};
    let totalValidSeconds = 0;
    for (let i = 0; i < totalHoursPassed; i++) {
        const h = SHIFT_HOURS[i];
        const targetVal = target[`target_${h}`] || 0;
        if (targetVal > 0) {
            totalValidSeconds += 3600;
        }
    }

    const avgCt = totalOutputForCt > 0 ? sumCtWeighted / totalOutputForCt : 0;
    const theoreticalMax = avgCt > 0 ? totalValidSeconds / avgCt : 0;
    const overallEff = theoreticalMax > 0 ? (sumOutput / theoreticalMax) * 100 : 0;

    cache.overall = {
        totalOutput: sumOutput,
        avgCycleTime: parseFloat(avgCt.toFixed(2)),
        totalEfficiency: parseFloat(overallEff.toFixed(2)),
    };
}

/**
 * Get full day data for a machine from cache
 * Returns null if not in cache (caller should fallback to MSSQL)
 */
function getFullDay(machineName) {
    return machineCache[machineName] || null;
}

/**
 * Get cache data for all machines
 */
function getAllMachinesCache() {
    return machineCache;
}

/**
 * Get hourly arrays for graphs (ordered by SHIFT_HOURS)
 */
function getHourlyArrays(machineName) {
    const cache = machineCache[machineName];
    if (!cache) {
        return {
            outputActual: new Array(24).fill(0),
            cycleTimeActual: new Array(24).fill(0),
            efficiencyActual: new Array(24).fill(0),
            outputActualAccum: new Array(24).fill(0),
        };
    }

    const outputActual = [];
    const cycleTimeActual = [];
    const efficiencyActual = [];
    const outputActualAccum = [];
    let accum = 0;

    for (const h of SHIFT_HOURS) {
        const out = cache.output[`actual_${h}`] || 0;
        const ct = cache.cycleTime[`cycle_${h}`] || 0;
        const eff = cache.efficiency[`eff_${h}`] || 0;

        accum += out;
        outputActual.push(out);
        cycleTimeActual.push(ct);
        efficiencyActual.push(eff);
        outputActualAccum.push(accum);
    }

    return { outputActual, cycleTimeActual, efficiencyActual, outputActualAccum };
}

/**
 * Get target data for a machine
 */
function getTarget(machineName) {
    return targetCache[machineName] || null;
}

// ==================== Hydration from MSSQL ====================

/**
 * Hydrate cache from MSSQL at startup
 * Query tb_output_actual, tb_cycle_time_actual, tb_efficiency_actual for today
 */
async function hydrateFromMSSQL() {
    const dateStr = getShiftDateUTC();
    const targetDate = new Date(dateStr);
    console.log(`🔄 Hydrating cache for shift date: ${dateStr} ...`);

    try {
        // Load machine list first
        await loadMachineList();

        const [outputs, cycleTimes, efficiencies, targets] = await Promise.all([
            prisma.tb_output_actual.findMany({ where: { date: targetDate } }),
            prisma.tb_cycle_time_actual.findMany({ where: { date: targetDate } }),
            prisma.tb_efficiency_actual.findMany({ where: { date: targetDate } }),
            prisma.tb_output_target.findMany({ where: { date: targetDate } }),
        ]);

        // Cache Targets
        for (const row of targets) {
            const mn = row.machine_name;
            if (!targetCache[mn]) targetCache[mn] = { date: dateStr, target: {} };

            targetCache[mn].target = row; // Store the whole row (contains target_07, target_08...)
        }

        // Fill cache from MSSQL data
        for (const row of outputs) {
            const mn = row.machine_name;
            initMachineCache(mn, dateStr);

            for (const h of SHIFT_HOURS) {
                const val = row[`actual_${h}`];
                if (val != null && val > 0) {
                    machineCache[mn].output[`actual_${h}`] = val;
                }
            }
        }

        for (const row of cycleTimes) {
            const mn = row.machine_name;
            initMachineCache(mn, dateStr);

            for (const h of SHIFT_HOURS) {
                const val = row[`cycle_${h}`];
                if (val != null && val > 0) {
                    machineCache[mn].cycleTime[`cycle_${h}`] = val;
                }
            }
        }

        for (const row of efficiencies) {
            const mn = row.machine_name;
            initMachineCache(mn, dateStr);

            for (const h of SHIFT_HOURS) {
                const val = row[`eff_${h}`];
                if (val != null && val > 0) {
                    machineCache[mn].efficiency[`eff_${h}`] = val;
                }
            }
        }

        // Recalculate overall for all machines
        for (const mn of Object.keys(machineCache)) {
            recalcOverall(mn);
        }

        const count = Object.keys(machineCache).length;
        console.log(`✅ Cache hydrated: ${count} machines loaded for ${dateStr}`);
        return count;
    } catch (err) {
        console.error("❌ Cache hydration failed:", err.message);
        return 0;
    }
}

/**
 * Clear cache and re-hydrate for new day (shift rollover)
 */
async function clearAndRollover() {
    console.log("🔄 Daily rollover: clearing cache...");
    for (const key of Object.keys(machineCache)) {
        delete machineCache[key];
    }
    for (const key of Object.keys(targetCache)) {
        delete targetCache[key];
    }
    await hydrateFromMSSQL();
}

module.exports = {
    loadMachineList,
    getMachineList,
    getMachineNames,
    initMachineCache,
    updateHour,
    recalcOverall,
    getFullDay,
    getAllMachinesCache,
    getHourlyArrays,
    getTarget,
    hydrateFromMSSQL,
    clearAndRollover,
};

/**
 * Cache Service — In-Memory Cache Layer
 * เก็บข้อมูลรายชั่วโมงของวันปัจจุบันไว้ใน memory เพื่อลด MSSQL load
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { SHIFT_HOURS, utcHourToThColumn, getShiftDateUTC, getShiftIndex } = require("../utils/timeUtils");
const { groupActualRowsByMachineAndDate, sumActualByHour } = require("./actualOutputService");

// ==================== Cache Storage ====================

// Machine actual data cache: { machineName: { date, output: {}, cycleTime: {}, efficiency: {}, overall: {} } }
const machineCache = {};

// Target data cache: { machineName: { date, target: { target_07: 100, ... } } }
const targetCache = {};

// Availability cache: { machineName: { date, availability: { avail_07: 85.2, ... } } }
const availabilityCache = {};

// Runtime cache: { machineName: { date, runtime: { runtime_07: 3600, ... }, excluded: { excluded_07: 0, ... } } }
const runtimeCache = {};

// 🆕 NG cache: past hours only (current hour ดึงจาก InfluxDB แยก)
// { machineName: { date, ng: { ng_07: 5, ng_08: 2, ... }, totalPastNg: 7 } }
const ngCache = {};

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

function initAvailabilityCache(machineName, dateStr) {
    if (!availabilityCache[machineName] || availabilityCache[machineName].date !== dateStr) {
        availabilityCache[machineName] = {
            date: dateStr,
            availability: {}, // { avail_07: 85.2, ... }
        };
    }
}

function initRuntimeCache(machineName, dateStr) {
    if (!runtimeCache[machineName] || runtimeCache[machineName].date !== dateStr) {
        runtimeCache[machineName] = {
            date: dateStr,
            runtime: {},      // { runtime_07: 3600, ... }
            excluded: {},     // { excluded_07: 0, ... }
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
 * Update a specific hour's runtime and excluded time
 */
function updateHourRuntime(machineName, thColumn, runtimeSec, excludedSec) {
    const dateStr = getShiftDateUTC();
    initRuntimeCache(machineName, dateStr);

    const cache = runtimeCache[machineName];
    cache.runtime[`runtime_${thColumn}`] = parseFloat(runtimeSec.toFixed(2));
    cache.excluded[`excluded_${thColumn}`] = parseFloat(excludedSec.toFixed(2));
}

/**
 * Update a specific hour's availability %
 */
function updateHourAvailability(machineName, thColumn, availPct) {
    const dateStr = getShiftDateUTC();
    initAvailabilityCache(machineName, dateStr);

    const cache = availabilityCache[machineName];
    cache.availability[`avail_${thColumn}`] = parseFloat(availPct.toFixed(2));
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

/**
 * Get availability array for real-time payloads
 */
function getAvailability(machineName) {
    const cache = availabilityCache[machineName];
    if (!cache) {
        return new Array(24).fill(0);
    }
    const availArr = [];
    for (const h of SHIFT_HOURS) {
        availArr.push(cache.availability[`avail_${h}`] || 0);
    }
    return availArr;
}

/**
 * Get runtime array for any calc needs
 */
function getRuntime(machineName) {
     const cache = runtimeCache[machineName];
    if (!cache) {
        return { runtime: new Array(24).fill(0), excluded: new Array(24).fill(0) };
    }
    const runArr = [];
    const excArr = [];
    for (const h of SHIFT_HOURS) {
        runArr.push(cache.runtime[`runtime_${h}`] || 0);
        excArr.push(cache.excluded[`excluded_${h}`] || 0);
    }
    return { runtime: runArr, excluded: excArr };
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

        const actualRowsByMachineDate = groupActualRowsByMachineAndDate(
            outputs,
            (date) => date.toISOString().split("T")[0]
        );
        for (const [mn, rowsByDate] of Object.entries(actualRowsByMachineDate)) {
            const rows = rowsByDate[dateStr] || [];
            const actualByHour = sumActualByHour(rows, SHIFT_HOURS);
            initMachineCache(mn, dateStr);
            for (const h of SHIFT_HOURS) {
                const val = actualByHour[`actual_${h}`] || 0;
                if (val > 0) {
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
        
        // Hydrate new ones too
        await hydrateAvailabilityFromMSSQL();
        await hydrateRuntimeFromMSSQL();
        await hydrateNgFromMSSQL(); // 🆕 Load past-hours NG into RAM

        return count;
    } catch (err) {
        console.error("❌ Cache hydration failed:", err.message);
        return 0;
    }
}

async function hydrateAvailabilityFromMSSQL() {
    const dateStr = getShiftDateUTC();
    const targetDate = new Date(dateStr);
    try {
        const availabilities = await prisma.tb_availability_actual.findMany({ where: { date: targetDate } });
        for (const row of availabilities) {
            const mn = row.machine_name;
            initAvailabilityCache(mn, dateStr);
            for (const h of SHIFT_HOURS) {
                const val = row[`avail_${h}`];
                if (val != null && val > 0) {
                    availabilityCache[mn].availability[`avail_${h}`] = val;
                }
            }
        }
        console.log(`✅ Availability cache hydrated for ${dateStr}`);
    } catch (err) {
        console.error("❌ Hydrating availability failed:", err.message);
    }
}

async function hydrateRuntimeFromMSSQL() {
    const dateStr = getShiftDateUTC();
    const targetDate = new Date(dateStr);
    try {
        const runtimes = await prisma.tb_mc_runtime_hourly.findMany({ where: { date: targetDate } });
        for (const row of runtimes) {
            const mn = row.machine_name;
            initRuntimeCache(mn, dateStr);
            for (const h of SHIFT_HOURS) {
                const rVal = row[`runtime_${h}`];
                if (rVal != null) {
                    runtimeCache[mn].runtime[`runtime_${h}`] = rVal;
                }
                const eVal = row[`excluded_${h}`];
                if (eVal != null) {
                    runtimeCache[mn].excluded[`excluded_${h}`] = eVal;
                }
            }
        }
        console.log(`✅ Runtime cache hydrated for ${dateStr}`);
    } catch (err) {
        console.error("❌ Hydrating runtime failed:", err.message);
    }
}

/**
 * 🆕 Hydrate NG cache from MSSQL at startup
 * Query tb_machine_ng for today → fill ngCache (past hours only)
 * เรียกครั้งเดียวตอน startup แทนการสแกน InfluxDB ทั้งวันทุก 10 วินาที
 */
async function hydrateNgFromMSSQL() {
    const dateStr = getShiftDateUTC();
    const targetDate = new Date(dateStr);
    try {
        // station_id = 0 คือ True_NG (1 part NG ต่อ 1 row) — ใช้ตัวนี้แทน per-station
        const ngRows = await prisma.tb_machine_ng.findMany({
            where: { date: targetDate, station_id: 0 },
        });

        for (const row of ngRows) {
            const mn = row.machine_name;
            if (!ngCache[mn]) {
                ngCache[mn] = { date: dateStr, ng: {}, totalPastNg: 0 };
            }
            let total = 0;
            for (const h of SHIFT_HOURS) {
                const val = row[`ng_${h}`] || 0;
                ngCache[mn].ng[`ng_${h}`] = val;
                total += val;
            }
            ngCache[mn].totalPastNg = total;
        }
        console.log(`✅ NG cache hydrated for ${dateStr} (${ngRows.length} machines)`);
    } catch (err) {
        console.error("❌ Hydrating NG cache failed:", err.message);
    }
}

/**
 * 🆕 Update a specific hour's NG count in cache
 * เรียกจาก cronService หลัง summarizeNgHourly เขียน MSSQL สำเร็จ
 * ทำให้ RAM sync กับ MSSQL ทันที ไม่ต้อง re-query
 * @returns {boolean} true ถ้า thColumn นี้ถูก confirm แล้ว (ใช้ตรวจสอบการล้าง pendingPrevHour)
 */
function updateHourNg(machineName, thColumn, ngCount) {
    const dateStr = getShiftDateUTC();
    if (!ngCache[machineName]) {
        ngCache[machineName] = { date: dateStr, ng: {}, totalPastNg: 0 };
    }
    ngCache[machineName].ng[`ng_${thColumn}`] = ngCount;
    // Recalculate total
    let total = 0;
    for (const h of SHIFT_HOURS) {
        total += ngCache[machineName].ng[`ng_${h}`] || 0;
    }
    ngCache[machineName].totalPastNg = total;
    return true;
}

/**
 * 🆕 Get sum of NG for all past hours (excluding current hour)
 * เรียกจาก realtimeService Fast/Slow Loop
 * แทนการสแกน InfluxDB ทั้งวัน
 */
function getNgPastHours(machineName) {
    return ngCache[machineName]?.totalPastNg || 0;
}

/**
 * 🆕 Check if a specific thColumn has been confirmed in ngCache
 * เรียกจาก realtimeService เพื่อตัดสินใจล้าง pendingPrevHour
 */
function isNgHourConfirmed(machineName, thColumn) {
    return ngCache[machineName]?.ng?.[`ng_${thColumn}`] !== undefined;
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
    for (const key of Object.keys(availabilityCache)) {
        delete availabilityCache[key];
    }
    for (const key of Object.keys(runtimeCache)) {
        delete runtimeCache[key];
    }
    // 🆕 Clear NG cache on daily rollover
    for (const key of Object.keys(ngCache)) {
        delete ngCache[key];
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
    getAvailability,
    getRuntime,
    updateHourRuntime,
    updateHourAvailability,
    hydrateFromMSSQL,
    hydrateAvailabilityFromMSSQL,
    hydrateRuntimeFromMSSQL,
    // 🆕 NG Cache
    hydrateNgFromMSSQL,
    updateHourNg,
    getNgPastHours,
    isNgHourConfirmed,
    clearAndRollover,
};

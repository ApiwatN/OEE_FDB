/**
 * Real-time Service — InfluxDB Poller + Socket.IO
 * Fast Loop (2s): ดึง InfluxDB + Cache → คำนวณ Output, CT, Eff, Target, Achieve → emit
 * Slow Loop (5min): ดึง MSSQL → คำนวณ Availability, Performance, Quality, OEE → emit
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const influxService = require("./influxService");
const cacheService = require("./cacheService");
const { getMachineStateMem } = require("./mqttService"); // 🆕 Use MQTT Memory
const { getMachineRunTimeMode, calcMcStatusDurations, calcAvailability, calcPerformance } = require("./oeeCalcService");
const {
    SHIFT_HOURS,
    utcHourToThColumn,
    getCurrentHourBoundaries,
    getShiftDateUTC,
    getElapsedSecondsInHour,
    getShiftIndex,
} = require("../utils/timeUtils");

let fastTimer = null;
let slowTimer = null;
// ✅ Worker Thread: Abstract emit functions (replaces ioInstance)
let emitFn = null;      // (room, event, data) => void
let broadcastFn = null; // (event, data) => void
// ✅ Fix #5: Delta update — track last emitted data per machine for dashboard
const lastEmittedData = new Map(); // key: machineName, value: { output, cycleTime }

/**
 * Start real-time polling — 2 loops
 * @param {Function} _emitFn - (room, event, data) → emit to room
 * @param {Function} _broadcastFn - (event, data) → broadcast to all
 */
function startRealtimePolling(_emitFn, _broadcastFn) {
    emitFn = _emitFn;
    broadcastFn = _broadcastFn;
    const fastMs = parseInt(process.env.REALTIME_FAST_POLL_MS || "2000", 10);
    const slowMs = parseInt(process.env.REALTIME_SLOW_POLL_MS || "300000", 10);  // 5 นาที

    // ── Fast Loop (MQTT Memory + Cache → Production Data) ──
    async function fastLoop() {
        try {
            await fastPollAndEmit();
        } catch (e) {
            console.error("❌ Fast poll error:", e.message);
        }
        fastTimer = setTimeout(fastLoop, fastMs);
    }
    fastLoop();

    // ── Slow Loop (MSSQL → MCStatus + OEE) ──
    async function slowLoop() {
        try {
            await slowPollAndEmit();
        } catch (e) {
            console.error("❌ Slow poll error:", e.message);
        }
        slowTimer = setTimeout(slowLoop, slowMs);
    }
    slowLoop();

    // Server time broadcast (every 1s)
    setInterval(() => {
        if (broadcastFn) broadcastFn("server_time", new Date().toISOString());
    }, 1000);

    console.log(`📡 Real-time polling started: Fast=${fastMs}ms, Slow=${slowMs}ms (safe-loop)`);
}

function stopRealtimePolling() {
    if (fastTimer) { clearTimeout(fastTimer); fastTimer = null; }
    if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
    console.log("📡 Real-time polling stopped");
}

// ═══════════════════════════════════════════════════════
// Fast Loop: InfluxDB + Cache → Production Data
// Query: 1 InfluxDB | Data: Cache (in-memory) | ไม่ Query MSSQL
// emit "realtime_output" ทุก 2 วินาที
// ═══════════════════════════════════════════════════════
async function fastPollAndEmit() {
    try {
        const now = new Date();
        const { dateStr, thColumn, start } = getCurrentHourBoundaries(now);
        const elapsedSeconds = getElapsedSecondsInHour(now);
        const currentShiftIndex = getShiftIndex(thColumn);

        // 1. Get current hour data from MQTT Memory
        const machineStateMem = getMachineStateMem();

        // Convert MQTT data format to match expected structure
        // ✅ Fix: Only use MQTT data if it matches the current hour
        // If the machine hasn't received a new message yet in this hour,
        // its memory still has old hour data → treat as 0
        const currentHourData = {};
        for (const [machineName, state] of machineStateMem.entries()) {
            const baseData = {
                live_status: state.live_status || null,
                live_alarm: state.live_alarm || null,
            };

            if (state.current_hour_label === thColumn) {
                currentHourData[machineName] = {
                    ...baseData,
                    output_count: state.current_hour_actual || 0,
                    avg_cycle_time: state.last_cycle_time || 0,
                    station_ng: state.current_hour_station_ng || {} // 🆕 Include station NG
                };
            } else {
                // MQTT memory still has old hour data — don't use it
                currentHourData[machineName] = {
                    ...baseData,
                    output_count: 0,
                    avg_cycle_time: 0,
                    station_ng: {} // 🆕
                };
            }
        }

        // 2. Combine machine names from Cache + MQTT
        const allCache = cacheService.getAllMachinesCache();
        const allMachineNames = new Set([
            ...Object.keys(allCache),
            ...Object.keys(currentHourData),
        ]);

        // 3. Build payload per machine — ใช้ Cache + InfluxDB เท่านั้น
        const dashboardMachines = {};

        for (const machineName of allMachineNames) {
            const cached = cacheService.getFullDay(machineName);
            const currentData = currentHourData[machineName] || { output_count: 0, avg_cycle_time: 0 };

            // Calculate excluded seconds in current hour
            let currentHourExcluded = 0;
            const mcRecords = mcStatusCache.recordsByMachine[machineName] || [];
            if (mcRecords.length > 0) {
                const { excludedSeconds } = calcMcStatusDurations(mcRecords, new Date(start), now);
                currentHourExcluded = excludedSeconds;
            }
            const adjustedElapsedSeconds = Math.max(0, elapsedSeconds - currentHourExcluded);

            // Current hour efficiency
            const theoreticalMax = currentData.avg_cycle_time > 0 && adjustedElapsedSeconds > 0
                ? adjustedElapsedSeconds / currentData.avg_cycle_time : 0;
            const currentEfficiency = theoreticalMax > 0
                ? (currentData.output_count / theoreticalMax) * 100 : 0;

            // Build hourly arrays: cache (past) + InfluxDB (current)
            const hourlyOutput = [];
            const hourlyCycleTime = [];
            const hourlyEfficiency = [];
            const hourlyOutputAccum = [];
            let accum = 0;

            for (let i = 0; i < SHIFT_HOURS.length; i++) {
                const h = SHIFT_HOURS[i];
                let out = 0, ct = 0, eff = 0;

                if (i < currentShiftIndex) {
                    // Past hours → from cache
                    out = cached ? (cached.output[`actual_${h}`] || 0) : 0;
                    ct = cached ? (cached.cycleTime[`cycle_${h}`] || 0) : 0;
                    eff = cached ? (cached.efficiency[`eff_${h}`] || 0) : 0;
                } else if (i === currentShiftIndex) {
                    // Current hour → from InfluxDB
                    out = currentData.output_count;
                    ct = parseFloat(currentData.avg_cycle_time.toFixed(2));
                    eff = parseFloat(currentEfficiency.toFixed(2));
                }

                accum += out;
                hourlyOutput.push(out);
                hourlyCycleTime.push(ct);
                hourlyEfficiency.push(eff);
                hourlyOutputAccum.push(accum);
            }

            // Overall daily aggregates
            const totalOutput = accum;
            let sumCtWeighted = 0, totalOutputForCt = 0;

            for (let i = 0; i <= currentShiftIndex && i < SHIFT_HOURS.length; i++) {
                const out = hourlyOutput[i];
                const ct = hourlyCycleTime[i];
                if (out > 0 && ct > 0) {
                    sumCtWeighted += ct * out;
                    totalOutputForCt += out;
                }
            }

            const overallAvgCt = totalOutputForCt > 0 ? sumCtWeighted / totalOutputForCt : 0;

            // Target & Achieve (from cache — no MSSQL)
            const targetEntry = cacheService.getTarget(machineName);
            const targets = targetEntry?.target || {};

            // Overall efficiency — only count hours with target > 0
            let totalValidSeconds = 0;
            for (let i = 0; i <= currentShiftIndex && i < SHIFT_HOURS.length; i++) {
                const h = SHIFT_HOURS[i];
                const targetVal = targets[`target_${h}`] || 0;
                if (targetVal > 0) {
                    totalValidSeconds += (i < currentShiftIndex) ? 3600 : adjustedElapsedSeconds;
                }
            }

            const overallTheoreticalMax = overallAvgCt > 0 ? totalValidSeconds / overallAvgCt : 0;
            const overallEff = overallTheoreticalMax > 0 ? (totalOutput / overallTheoreticalMax) * 100 : 0;

            // Accumulated target (pro-rated)
            let overallAccumTarget = 0;
            if (targetEntry && targetEntry.target) {
                for (let i = 0; i <= currentShiftIndex && i < SHIFT_HOURS.length; i++) {
                    const h = SHIFT_HOURS[i];
                    const targetVal = targets[`target_${h}`] || 0;
                    if (i < currentShiftIndex) {
                        overallAccumTarget += targetVal;
                    } else {
                        const minutesPassed = (now - new Date(start)) / 1000 / 60;
                        const ratio = Math.min(minutesPassed / 60, 1);
                        overallAccumTarget += Math.round(targetVal * ratio);
                    }
                }
            }

            const overallAchieve = overallAccumTarget > 0 ? (totalOutput / overallAccumTarget) * 100 : 0;

            // Build full production payload
            const machinePayload = {
                currentHour: {
                    hour: thColumn,
                    shiftIndex: currentShiftIndex,
                    output: currentData.output_count,
                    cycleTime: parseFloat(currentData.avg_cycle_time.toFixed(2)),
                    efficiency: parseFloat(currentEfficiency.toFixed(2)),
                    stationNg: currentData.station_ng || {}, // 🆕 Pass to frontend
                    live_status: currentData.live_status, // 🆕 Real-Time Status
                    live_alarm: currentData.live_alarm,   // 🆕 Real-Time Alarm
                },
                daily: {
                    totalOutput,
                    accumTarget: overallAccumTarget,
                    achieve: parseFloat(overallAchieve.toFixed(2)),
                    avgCycleTime: parseFloat(overallAvgCt.toFixed(2)),
                    overallEfficiency: parseFloat(overallEff.toFixed(2)),
                    // ❌ ไม่มี availability, performance, quality, oee (รอ Slow Loop)
                    hourly: {
                        output: hourlyOutput,
                        cycleTime: hourlyCycleTime,
                        efficiency: hourlyEfficiency,
                        outputAccum: hourlyOutputAccum,
                    },
                },
            };

            // ── ส่งเฉพาะเครื่องที่มีคนดู (Room: "machine:<name>") — มี hourly arrays ──
            if (emitFn) {
                emitFn(`machine:${machineName}`, "realtime_output", {
                    serverTimeUTC: now.toISOString(),
                    shiftDate: dateStr,
                    currentHourTH: thColumn,
                    currentShiftIndex,
                    elapsedSeconds: adjustedElapsedSeconds,
                    machines: { [machineName]: machinePayload },
                });
            }

            // Dashboard: check for changes (delta update)
            // ✅ Fix #5: Only include machines whose key values changed
            // ✅ Bug fix: Also track shiftIndex — when hour changes, ALL machines must update
            const lastData = lastEmittedData.get(machineName);
            const currentOutput = machinePayload.daily.totalOutput;
            const currentCt = machinePayload.currentHour.cycleTime;
            const currentTarget = machinePayload.daily.accumTarget;
            const currentAchieve = machinePayload.daily.achieve;
            const currentStationNgStr = JSON.stringify(machinePayload.currentHour.stationNg); // 🆕 Convert to string for deep compare
            const currentStatus = machinePayload.currentHour.live_status;
            const currentAlarm = machinePayload.currentHour.live_alarm;

            const hasChanged = !lastData ||
                lastData.output !== currentOutput ||
                lastData.cycleTime !== currentCt ||
                lastData.accumTarget !== currentTarget ||
                lastData.achieve !== currentAchieve ||
                lastData.shiftIndex !== currentShiftIndex ||
                lastData.stationNgStr !== currentStationNgStr ||
                lastData.status !== currentStatus ||
                lastData.alarm !== currentAlarm;

            if (hasChanged) {
                dashboardMachines[machineName] = machinePayload;
                lastEmittedData.set(machineName, {
                    output: currentOutput,
                    cycleTime: currentCt,
                    accumTarget: currentTarget,
                    achieve: currentAchieve,
                    shiftIndex: currentShiftIndex,
                    stationNgStr: currentStationNgStr, // 🆕 Store stringified state
                    status: currentStatus,
                    alarm: currentAlarm,
                });
            }
        }

        // ── ส่งข้อมูลรวมให้ Dashboard (Room: "dashboard") ──
        // ✅ Fix #5: Only emit if there are changed machines (delta)
        if (emitFn && Object.keys(dashboardMachines).length > 0) {
            emitFn("dashboard", "realtime_output", {
                serverTimeUTC: now.toISOString(),
                shiftDate: dateStr,
                currentHourTH: thColumn,
                currentShiftIndex,
                elapsedSeconds, // For global backward compatibility, though individual machines use adjustedElapsedSeconds to compute theoretical max
                machines: dashboardMachines,
                isDelta: true, // ✅ Frontend should merge, not replace
            });
        }
    } catch (err) {
        console.error("❌ Fast poll error:", err.message);
    }
}

// ✅ Fix #1: MCStatus incremental cache — avoid querying full day every 5 min
const mcStatusCache = {
    shiftDateStr: null,         // Track which date this cache belongs to
    lastQueryTime: null,        // Last query upper bound (for incremental)
    recordsByMachine: {},       // { machineName: [...records] }
    carryOverByMachine: {},     // { machineName: { MC, Datetime, MCStatus } } — stable within day
};

// ═══════════════════════════════════════════════════════
// Slow Loop: MSSQL only → MCStatus + Quality + OEE
// Query: 2 MSSQL queries (MCStatus + tb_oee) | ไม่ Query InfluxDB
// emit "realtime_update" ทุก 5 นาที
// ✅ Timeout protection: ไม่ให้ค้างเกิน 30 วินาที
// ═══════════════════════════════════════════════════════
async function slowPollAndEmit() {
    const TIMEOUT_MS = 30000;
    try {
        await Promise.race([
            _slowPollAndEmitInner(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("SlowPoll timeout (30s)")), TIMEOUT_MS)
            ),
        ]);
    } catch (err) {
        console.error("⚠️ [SlowPoll] timed out or failed:", err.message);
    }
}

async function _slowPollAndEmitInner() {
    try {
        const now = new Date();
        const { dateStr } = getCurrentHourBoundaries(now);

        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(5, 7)) - 1;
        const day = parseInt(dateStr.substring(8, 10));
        const shiftStart = new Date(Date.UTC(year, month, day, 7, 0, 0));

        const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowTH = new Date(now.getTime() + TH_OFFSET_MS);

        // ✅ Fix #1: Incremental MCStatus query
        let mcStatusByMachine;
        const isNewDay = mcStatusCache.shiftDateStr !== dateStr;

        if (isNewDay || !mcStatusCache.lastQueryTime) {
            // === First poll of the day OR new shift date → Full query ===
            const todayMcStatus = await prisma.tb_MCStatus.findMany({
                where: { Datetime: { gte: shiftStart, lte: nowTH } },
                orderBy: { Datetime: "asc" },
                select: { MC: true, Datetime: true, MCStatus: true },
            });

            const carryOverRows = await prisma.$queryRaw`
                SELECT MC, MCStatus, Datetime FROM (
                    SELECT MC, MCStatus, Datetime, ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn
                    FROM tb_MCStatus WHERE Datetime < ${shiftStart}
                ) t WHERE rn = 1
            `;

            // Build cache
            mcStatusCache.shiftDateStr = dateStr;
            mcStatusCache.recordsByMachine = {};
            mcStatusCache.carryOverByMachine = {};

            for (const row of carryOverRows) {
                mcStatusCache.carryOverByMachine[row.MC] = row;
                mcStatusCache.recordsByMachine[row.MC] = [{ MC: row.MC, Datetime: shiftStart, MCStatus: row.MCStatus }];
            }
            for (const rec of todayMcStatus) {
                if (!mcStatusCache.recordsByMachine[rec.MC]) mcStatusCache.recordsByMachine[rec.MC] = [];
                mcStatusCache.recordsByMachine[rec.MC].push(rec);
            }

            mcStatusCache.lastQueryTime = nowTH;
            mcStatusByMachine = mcStatusCache.recordsByMachine;
            console.log(`   📊 [SlowPoll] Full MCStatus query: ${todayMcStatus.length} records cached`);
        } else {
            // === Incremental query — only new records since last poll ===
            const incrementalRecords = await prisma.tb_MCStatus.findMany({
                where: { Datetime: { gt: mcStatusCache.lastQueryTime, lte: nowTH } },
                orderBy: { Datetime: "asc" },
                select: { MC: true, Datetime: true, MCStatus: true },
            });

            // Append to cache
            for (const rec of incrementalRecords) {
                if (!mcStatusCache.recordsByMachine[rec.MC]) {
                    // New machine appeared — add carryover placeholder
                    mcStatusCache.recordsByMachine[rec.MC] = [];
                }
                mcStatusCache.recordsByMachine[rec.MC].push(rec);
            }

            mcStatusCache.lastQueryTime = nowTH;
            mcStatusByMachine = mcStatusCache.recordsByMachine;
            console.log(`   📊 [SlowPoll] Incremental: ${incrementalRecords.length} new MCStatus records (cached total: ${Object.keys(mcStatusByMachine).length} machines)`);
        }

        // 2. Query tb_oee for today (Quality data)
        const targetDate = new Date(dateStr);
        const oeeRows = await prisma.tb_oee.findMany({
            where: { date: targetDate },
            select: { machine_name: true, quality: true, oee_value: true, ng_qty: true },
        });
        const oeeByMachine = {};
        for (const row of oeeRows) {
            oeeByMachine[row.machine_name] = row;
        }

        // 2b. ดึง oee_mode config ทุกเครื่อง
        const configs = await prisma.tb_machine_plan_config.findMany({
            select: { machine_name: true, oee_mode: true },
        });
        const modeMap = new Map(configs.map(c => [c.machine_name, c.oee_mode || "manual"]));

        // 2c. Query NG count จาก InfluxDB สำหรับวันนี้ (ใช้เฉพาะ auto mode)
        const shiftStartUTC = new Date(Date.UTC(year, month, day, 0, 0, 0)); // 07:00 TH = 00:00 UTC
        let ngByMachine = {};
        try {
            ngByMachine = await influxService.queryAllMachinesNgCount(shiftStartUTC, now);
        } catch (e) {
            console.error("   ⚠️ Slow poll: InfluxDB NG query failed:", e.message);
        }

        // 3. Build status payload — เฉพาะ Availability, Performance, Quality, OEE
        const machines = {};
        const allMachineNames = new Set([
            ...Object.keys(mcStatusByMachine),
            ...Object.keys(oeeByMachine),
        ]);

        // ✅ ดึง current hour output จาก InfluxDB เพื่อรวมใน Performance calculation
        const { start: currentHourStart } = getCurrentHourBoundaries(now);
        let currentHourData = {};
        try {
            currentHourData = await influxService.queryAllMachinesForHour(currentHourStart, now);
        } catch (e) {
            console.error("   ⚠️ Slow poll: failed to query InfluxDB for current hour:", e.message);
        }

        // ✅ Bulk-fetch target rows for ALL machines (1 query instead of N)
        const allTargetRows = await prisma.tb_output_target.findMany({ where: { date: targetDate } });
        const targetMap = {};
        for (const row of allTargetRows) targetMap[row.machine_name] = row;

        // ✅ Collect upsert operations (no DB calls in loop)
        const upsertOps = [];

        for (const machineName of allMachineNames) {
            // Availability & Performance from MCStatus
            const mcRecords = mcStatusByMachine[machineName] || [];
            let { runTimeSeconds, excludedSeconds, totalSeconds } = calcMcStatusDurations(mcRecords, shiftStart, nowTH);

            // 🆕 ดึง MCStatus ล่าสุดจาก DB records ที่มีอยู่แล้ว (ไม่ต้อง query เพิ่ม)
            const latestMcStatus = mcRecords.length > 0 ? mcRecords[mcRecords.length - 1].MCStatus : null;
            const modeRunTime = getMachineRunTimeMode(machineName);

            // ✅ ดึง CT_target จาก pre-fetched map (ไม่ query DB)
            const targetRow = targetMap[machineName];
            const idealCT = targetRow?.cycle_time_target || 0;

            // totalOutput for performance: cache (past hours) + InfluxDB (current hour)
            // ✅ ข้าม current hour จาก cache → ใช้ InfluxDB เท่านั้น (ป้องกันนับซ้ำ)
            const cached = cacheService.getFullDay(machineName);
            const { thColumn } = getCurrentHourBoundaries(now);
            const currentShiftIndex = getShiftIndex(thColumn);
            let totalOutput = 0;
            let sumCtWeighted = 0;

            if (cached) {
                for (let i = 0; i < SHIFT_HOURS.length; i++) {
                    if (i === currentShiftIndex) continue; // ข้าม current hour
                    const out = cached.output[`actual_${SHIFT_HOURS[i]}`] || 0;
                    const ct = cached.cycleTime[`cycle_${SHIFT_HOURS[i]}`] || 0;
                    totalOutput += out;
                    if (out > 0 && ct > 0) sumCtWeighted += ct * out;
                }
            }
            // current hour → InfluxDB เท่านั้น (source of truth)
            const currentData = currentHourData[machineName];
            const currOut = currentData?.output_count || 0;
            const currCt = currentData?.avg_cycle_time || 0;
            totalOutput += currOut;
            if (currOut > 0 && currCt > 0) sumCtWeighted += currCt * currOut;

            const overallAvgCt = totalOutput > 0 ? sumCtWeighted / totalOutput : 0;

            if (modeRunTime === "output_based") {
                const avgToUse = overallAvgCt > 0 ? overallAvgCt : idealCT;
                runTimeSeconds = totalOutput * avgToUse;
            }

            const availability = calcAvailability(runTimeSeconds, excludedSeconds, totalSeconds);
            const performance = calcPerformance(totalOutput, idealCT, runTimeSeconds);

            // Quality & OEE — แยกตาม oee_mode (auto/manual)
            const oeeData = oeeByMachine[machineName];
            const mode = modeMap.get(machineName) || "manual";

            let quality = 0;
            let oeeValue = 0;
            let ngQty = 0;

            if (mode === "auto") {
                ngQty = ngByMachine[machineName] || 0;
                quality = totalOutput > 0 ? ((totalOutput - ngQty) / totalOutput) * 100 : 0;
                if (quality < 0) quality = 0;
                oeeValue = (availability > 0 && performance > 0 && quality > 0)
                    ? (availability / 100) * (performance / 100) * (quality / 100) * 100
                    : 0;
            } else {
                quality = oeeData?.quality || 0;
                ngQty = oeeData?.ng_qty || 0;
                oeeValue = (availability > 0 && performance > 0 && quality > 0)
                    ? (availability / 100) * (performance / 100) * (quality / 100) * 100
                    : oeeData?.oee_value || 0;
            }

            let dailyPayload = {
                availability: parseFloat(availability.toFixed(2)),
                performance: parseFloat(performance.toFixed(2)),
                ngQty,
                oeeMode: mode,
            };

            // ✅ For manual machines, prevent overwriting yesterday's OEE with today's incomplete OEE
            const todayStr = getShiftDateUTC();
            if (mode === "auto" || dateStr !== todayStr) {
                dailyPayload.quality = parseFloat(quality.toFixed(2));
                dailyPayload.oee = parseFloat(oeeValue.toFixed(2));
            }

            // 🆕 ซิงค์ MQTT Memory กลับจาก DB ถ้า live_status ยังเป็น null
            // (กรณี backend เพิ่งรีสตาร์ท ยังไม่ได้รับ MQTT status_tb ครั้งแรก)
            const currentMemState = getMachineStateMem().get(machineName);
            if (currentMemState && currentMemState.live_status === null && latestMcStatus) {
                currentMemState.live_status = latestMcStatus;
                getMachineStateMem().set(machineName, currentMemState);
            }

            machines[machineName] = {
                daily: dailyPayload,
                currentHour: {
                    live_status: latestMcStatus, // 🆕 ส่งสถานะล่าสุดจาก MSSQL (ทุก 5 นาที)
                },
            };

            // ✅ Queue upsert (ไม่ await ทีละตัว)
            const upsertData = {
                availability: parseFloat(availability.toFixed(2)),
                performance: parseFloat(performance.toFixed(2)),
            };
            if (mode === "auto") {
                upsertData.ng_qty = ngQty;
                upsertData.quality = parseFloat(quality.toFixed(2));
                upsertData.oee_value = parseFloat(oeeValue.toFixed(2));
            }

            upsertOps.push(
                prisma.tb_oee.upsert({
                    where: { machine_name_date: { machine_name: machineName, date: targetDate } },
                    update: upsertData,
                    create: {
                        date: targetDate,
                        machine_name: machineName,
                        availability: parseFloat(availability.toFixed(2)),
                        performance: parseFloat(performance.toFixed(2)),
                        ng_qty: mode === "auto" ? ngQty : 0,
                        quality: mode === "auto" ? parseFloat(quality.toFixed(2)) : 0,
                        oee_value: mode === "auto" ? parseFloat(oeeValue.toFixed(2)) : 0,
                    },
                }).catch(err => console.error(`   ❌ Slow poll upsert tb_oee failed for ${machineName}:`, err.message))
            );
        }

        // ✅ Batch execute all upserts with event loop yielding
        if (upsertOps.length > 0) {
            const BATCH_SIZE = 50;
            for (let i = 0; i < upsertOps.length; i += BATCH_SIZE) {
                const batch = upsertOps.slice(i, i + BATCH_SIZE);
                await Promise.all(batch);
                if (i + BATCH_SIZE < upsertOps.length) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
        }

        console.log(`✅ [SlowPoll] OEE upserted to DB for ${Object.keys(machines).length} machines (${dateStr})`);


        // 3. Emit status update (broadcast to all — ข้อมูล MCStatus ทุกคนต้องได้)
        if (broadcastFn) {
            broadcastFn("realtime_update", {
                serverTimeUTC: now.toISOString(),
                shiftDate: dateStr,
                machines,
            });
        }
    } catch (err) {
        console.error("❌ Slow poll error:", err.message);
    }
}

module.exports = {
    startRealtimePolling,
    stopRealtimePolling,
    fastPollAndEmit,
    slowPollAndEmit,
};

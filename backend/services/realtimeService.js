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
const { calcMcStatusDurations, calcAvailability, calcPerformance } = require("./oeeCalcService");
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
let ioInstance = null;

/**
 * Start real-time polling — 2 loops
 */
function startRealtimePolling(io) {
    ioInstance = io;
    const fastMs = parseInt(process.env.REALTIME_FAST_POLL_MS || "2000", 10);
    const slowMs = parseInt(process.env.REALTIME_SLOW_POLL_MS || "300000", 10);  // 5 นาที

    // ── Fast Loop (InfluxDB + Cache → Production Data) ──
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
        io.emit("server_time", new Date().toISOString());
    }, 1000);

    console.log(`📡 Real-time polling started: Fast=${fastMs}ms, Slow=${slowMs}ms (safe-loop)`);
}

/**
 * Stop real-time polling
 */
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

        // 1. Query InfluxDB — เฉพาะชั่วโมงปัจจุบัน (1 query เบาๆ)
        const currentHourData = await influxService.queryAllMachinesForHour(start, now);

        // 2. รวม machine names จาก Cache + InfluxDB
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

            // Current hour efficiency
            const theoreticalMax = currentData.avg_cycle_time > 0 && elapsedSeconds > 0
                ? elapsedSeconds / currentData.avg_cycle_time : 0;
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
                    totalValidSeconds += (i < currentShiftIndex) ? 3600 : elapsedSeconds;
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
            if (ioInstance) {
                ioInstance.to(`machine:${machineName}`).emit("realtime_output", {
                    serverTimeUTC: now.toISOString(),
                    shiftDate: dateStr,
                    currentHourTH: thColumn,
                    currentShiftIndex,
                    elapsedSeconds,
                    machines: { [machineName]: machinePayload },
                });
            }

            // Dashboard: ส่งข้อมูลเต็ม (OverallMachineCard ต้องใช้ hourly arrays สำหรับกราฟ)
            dashboardMachines[machineName] = machinePayload;
        }

        // ── ส่งข้อมูลรวมให้ Dashboard (Room: "dashboard") ──
        if (ioInstance) {
            ioInstance.to("dashboard").emit("realtime_output", {
                serverTimeUTC: now.toISOString(),
                shiftDate: dateStr,
                currentHourTH: thColumn,
                currentShiftIndex,
                elapsedSeconds,
                machines: dashboardMachines,
            });
        }
    } catch (err) {
        console.error("❌ Fast poll error:", err.message);
    }
}

// ═══════════════════════════════════════════════════════
// Slow Loop: MSSQL only → MCStatus + Quality + OEE
// Query: 2 MSSQL queries (MCStatus + tb_oee) | ไม่ Query InfluxDB
// emit "realtime_update" ทุก 5 นาที
// ═══════════════════════════════════════════════════════
async function slowPollAndEmit() {
    try {
        const now = new Date();
        const { dateStr } = getCurrentHourBoundaries(now);

        // 1. Query tb_MCStatus for today's shift (all machines)
        // ✅ DB เก็บเวลาไทย (+7) ตรงๆ ใน Datetime column
        // Prisma ส่ง UTC value ของ JS Date ไป SQL query
        // ดังนั้นต้อง:
        //   - shiftStart = Date.UTC(year, month, day, 7) → Prisma ส่ง '07:00' → ตรงกับ 07:00 ไทยใน DB
        //   - nowTH = now + 7h → Prisma ส่งเวลาไทยไป → ตรงกับเวลาไทยใน DB
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(5, 7)) - 1;
        const day = parseInt(dateStr.substring(8, 10));
        const shiftStart = new Date(Date.UTC(year, month, day, 7, 0, 0));

        // ✅ แปลง now เป็นเวลาไทย (+7h) เพื่อเปรียบเทียบกับ DB ที่เก็บเวลาไทย
        const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowTH = new Date(now.getTime() + TH_OFFSET_MS);

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

        // Build grouped records
        const mcStatusByMachine = {};
        for (const row of carryOverRows) {
            mcStatusByMachine[row.MC] = [{ MC: row.MC, Datetime: shiftStart, MCStatus: row.MCStatus }];
        }
        for (const rec of todayMcStatus) {
            if (!mcStatusByMachine[rec.MC]) mcStatusByMachine[rec.MC] = [];
            mcStatusByMachine[rec.MC].push(rec);
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
            const { runTimeSeconds, excludedSeconds, totalSeconds } = calcMcStatusDurations(mcRecords, shiftStart, nowTH);
            const availability = calcAvailability(runTimeSeconds, excludedSeconds, totalSeconds);

            // ✅ ดึง CT_target จาก pre-fetched map (ไม่ query DB)
            const targetRow = targetMap[machineName];
            const idealCT = targetRow?.cycle_time_target || 0;

            // totalOutput for performance: cache (past hours) + InfluxDB (current hour)
            const cached = cacheService.getFullDay(machineName);
            let totalOutput = 0;
            if (cached) {
                for (const h of SHIFT_HOURS) {
                    totalOutput += cached.output[`actual_${h}`] || 0;
                }
            }
            const currentData = currentHourData[machineName];
            if (currentData && currentData.output_count > 0) {
                totalOutput += currentData.output_count;
            }

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

            machines[machineName] = {
                daily: {
                    availability: parseFloat(availability.toFixed(2)),
                    performance: parseFloat(performance.toFixed(2)),
                    quality: parseFloat(quality.toFixed(2)),
                    oee: parseFloat(oeeValue.toFixed(2)),
                    ngQty,
                    oeeMode: mode,
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
        if (ioInstance) {
            ioInstance.emit("realtime_update", {
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

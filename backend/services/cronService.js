/**
 * Cron Service — Hourly Summary + Late Data + Daily Rollover
 * สรุปข้อมูลจาก InfluxDB → upsert MSSQL + update cache
 */
require("dotenv").config();
const cron = require("node-cron");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const influxService = require("./influxService");
const cacheService = require("./cacheService");
const { getMachineStateMem } = require("./mqttService");
const {
    SHIFT_HOURS,
    utcHourToThColumn,
    getPreviousHourBoundaries,
    getShiftDateUTC,
    getHourBoundariesUTC,
    getShiftIndex,
    getCurrentHourBoundaries,
} = require("../utils/timeUtils");
const { calcMcStatusDurations, calcAvailability, calcPerformance } = require("./oeeCalcService");
const dayjs = require("dayjs");
const { generatePlanForMachine } = require("../controllers/PlanConfigController");

// ✅ Fix #2 (v3): True Queue-based lock — resolves thundering herd concurrency issue
const lockQueue = [];
let isLocked = false;
const LOCK_TIMEOUT_MS = 120000; // 120s max wait (handleLateData can take >60s)

const acquireLock = async (jobName) => {
    if (!isLocked) {
        isLocked = true;
        return true; 
    }
    
    console.log(`⏳ [Cron] ${jobName} waiting for lock...`);
    let timeoutId;
    
    try {
        await new Promise((resolve, reject) => {
            lockQueue.push(resolve);
            timeoutId = setTimeout(() => {
                const index = lockQueue.indexOf(resolve);
                if (index > -1) lockQueue.splice(index, 1);
                reject(new Error("Lock timeout"));
            }, LOCK_TIMEOUT_MS);
        });
        clearTimeout(timeoutId);
        return true;
    } catch (e) {
        console.log(`⚠️ [Cron] ${jobName} skipped — lock timeout (${LOCK_TIMEOUT_MS}ms)`);
        return false;
    }
};

const releaseLock = () => {
    if (lockQueue.length > 0) {
        // Pass the lock to the next job in the queue
        const next = lockQueue.shift();
        next(); 
    } else {
        // Queue empty, release the global lock
        isLocked = false; 
    }
};

// Track last processed time per machine for late data detection
const lastProcessedTime = {};

/**
 * Start all cron jobs
 */
function startCronJobs() {
    const hourlyExpr = process.env.CRON_HOURLY || "0 * * * *";
    const lateExpr = process.env.CRON_LATE_DATA || "*/15 * * * *";
    const rolloverExpr = process.env.CRON_DAILY_ROLLOVER || "5 0 * * *";

    // Job 1: Hourly summary — ทุกต้นชั่วโมง (ดึงจาก InfluxDB สำรองไว้)
    // ✅ Fix #2: Protected by heavyCronLock
    cron.schedule(hourlyExpr, async () => {
        if (!(await acquireLock("summarizeLastHour"))) return;
        try {
            console.log(`⏰ [Cron] Hourly summary starting at ${new Date().toISOString()}`);
            await summarizeLastHour();
        } finally { releaseLock(); }
    });

    // ❌ Removed: 5-Min MQTT Bulk Upsert — InfluxDB เป็น source of truth
    // MSSQL เขียนทุก 1 ชม. ผ่าน summarizeLastHour + backfillStartup ตอน restart

    // Job 2: Late data check — ทุก 15 นาที
    // ✅ Fix #2: Protected by heavyCronLock
    cron.schedule(lateExpr, async () => {
        if (!(await acquireLock("handleLateData"))) return;
        try {
            console.log(`🔍 [Cron] Late data check at ${new Date().toISOString()}`);
            await handleLateData();
        } finally { releaseLock(); }
    });

    // Job 3: Daily rollover — 00:05 UTC (07:05 TH)
    cron.schedule(rolloverExpr, async () => {
        console.log(`🌅 [Cron] Daily rollover at ${new Date().toISOString()}`);
        await cacheService.clearAndRollover();
    });

    // Job 3.5: Machine NG per station hourly
    const ngExpr = process.env.CRON_NG_HOURLY || "10 * * * *";
    cron.schedule(ngExpr, async () => {
        if (!(await acquireLock("summarizeNgHourly"))) return;
        try {
            console.log(`🎯 [Cron] Machine NG hourly saving at ${new Date().toISOString()}`);
            await summarizeNgHourly();
        } finally { releaseLock(); }
    });

    // Job 4: OEE hourly — upsert availability + performance to tb_oee
    // ✅ Fix #2: Protected by heavyCronLock
    const oeeExpr = process.env.CRON_OEE_HOURLY || "5 * * * *";
    cron.schedule(oeeExpr, async () => {
        if (!(await acquireLock("upsertOeeHourly"))) return;
        try {
            console.log(`📈 [Cron] OEE hourly upsert at ${new Date().toISOString()}`);
            await upsertOeeHourly();
        } finally { releaseLock(); }
    });

    // Job 4.5: Daily InfluxDB to MSSQL Sync — 00:15 UTC (07:15 TH)
    const dailySyncExpr = process.env.CRON_DAILY_SYNC || "15 0 * * *";
    cron.schedule(dailySyncExpr, async () => {
        if (!(await acquireLock("dailySyncInfluxToMssql"))) return;
        try {
            console.log(`🔄 [Cron] Daily Influx to MSSQL Sync starting at ${new Date().toISOString()}`);
            await backfillStartup(3);
            await backfillNgStartup(3);
            await backfillOeeStartup(3);
            await backfillEventsStartup(3); // 🆕 Sync Status and Alarms
            console.log(`✅ [Cron] Daily Influx to MSSQL Sync completed.`);
        } finally { releaseLock(); }
    });

    // Job 4.6: 5-Minute MSSQL Status Poller for Web Dashboard (Fallback offline MQTT)
    cron.schedule("*/5 * * * *", async () => {
        if (!(await acquireLock("pollMssqlStatusForWeb"))) return;
        try {
            await pollMssqlStatusForWeb();
        } finally { releaseLock(); }
    });

    // Job 5: Auto Plan Daily — 00:10 UTC (07:10 TH)
    const autoPlanExpr = process.env.CRON_AUTO_PLAN || "10 0 * * *";
    cron.schedule(autoPlanExpr, async () => {
        console.log(`📋 [Cron] Auto plan daily at ${new Date().toISOString()}`);
        await autoPlanDaily();
    });

    console.log("✅ Cron jobs started:");
    console.log(`   Hourly: "${hourlyExpr}"`);
    console.log(`   Late data: "${lateExpr}"`);
    console.log(`   Rollover: "${rolloverExpr}"`);
    console.log(`   OEE hourly: "${oeeExpr}"`);
    console.log(`   Daily Sync: "${dailySyncExpr}"`);
    console.log(`   Auto plan: "${autoPlanExpr}"`);
}

/**
 * 🆕 Flush MQTT Memory to MSSQL (Every 5 minutes)
 * ✅ Fix #2: Bulk query (1 query) instead of findFirst per machine (N queries)
 * ✅ Batch processing + event loop yield to prevent Frontend blocking
 */
async function flushMqttMemoryToDb() {
    const BATCH_SIZE = 10;
    try {
        const mem = getMachineStateMem();
        if (mem.size === 0) return;

        const now = new Date();
        const dateStr = now.toISOString().split("T")[0];
        const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
        const { thColumn } = getCurrentHourBoundaries(now);
        const actualField = `actual_${thColumn}`;

        console.log(`💾 Flushing ${mem.size} machines to MSSQL for ${actualField}...`);

        // Filter machines that have data AND whose MQTT memory matches the current hour
        // ✅ Fix: ถ้า current_hour_label ไม่ตรงกับ thColumn → ข้อมูลเป็นของ ชม.ก่อนหน้า ห้ามเขียน
        const entries = [...mem.entries()].filter(
            ([_, s]) => (s.current_hour_actual > 0 || s.current_hour_ng > 0) && s.current_hour_label === thColumn
        );

        if (entries.length === 0) return;

        // ✅ Fix #2: Bulk query — 1 query instead of N findFirst calls
        const existingRows = await prisma.tb_output_actual.findMany({
            where: { date: targetDate },
            select: { machine_name: true, [actualField]: true }
        });
        const existingMap = {};
        for (const row of existingRows) {
            existingMap[row.machine_name] = row[actualField] || 0;
        }

        let updatedCount = 0;

        // ✅ Batch processing with event loop yield
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const batch = entries.slice(i, i + BATCH_SIZE);

            const results = await Promise.all(batch.map(async ([machineName, state]) => {
                try {
                    const mqttOutput = state.current_hour_actual;
                    const existingValue = existingMap[machineName] || 0;
                    if (existingValue >= mqttOutput) return false;

                    await upsertHourlyField("tb_output_actual", machineName, targetDate, actualField, mqttOutput, "Overall", null);
                    cacheService.updateHour(machineName, thColumn, mqttOutput, state.last_cycle_time, 0);
                    return true;
                } catch (err) {
                    console.error(`   ⚠️ Failed to flush ${machineName}:`, err.message);
                    return false;
                }
            }));

            updatedCount += results.filter(Boolean).length;

            // ✅ Yield event loop — ให้ API request อื่นแทรกได้
            if (i + BATCH_SIZE < entries.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        // Recalculate overall ONLY for updated machines
        if (updatedCount > 0) {
            const updatedMachines = entries.map(([name]) => name);
            await recalcOverallInMSSQL(targetDate, updatedMachines);
            console.log(`💾 Flush complete. Updated ${updatedCount} machines.`);
        }

    } catch (err) {
        console.error("❌ Flush MQTT Memory failed:", err.message);
    }
}

/**
 * Job 1: Summarize last hour
 * Query InfluxDB for previous hour → upsert MSSQL → update cache
 */
async function summarizeLastHour() {
    try {
        const { dateStr, utcHour, thColumn, start, end } = getPreviousHourBoundaries();

        console.log(`📊 Summarizing hour UTC:${utcHour} (TH:${thColumn}) for ${dateStr}`);

        // 1. Query InfluxDB — all machines in 1 query
        const machineData = await influxService.queryAllMachinesForHour(start, end);

        if (Object.keys(machineData).length === 0) {
            console.log("   No data found for last hour.");
            return;
        }

        const targetDate = new Date(dateStr);

        // 2. ✅ Upsert MSSQL for each machine (3 ops in parallel per machine)
        for (const [machineName, data] of Object.entries(machineData)) {
            const { output_count, avg_cycle_time } = data;
            const theoreticalMax = avg_cycle_time > 0 ? 3600 / avg_cycle_time : 0;
            const efficiency = theoreticalMax > 0 ? (output_count / theoreticalMax) * 100 : 0;

            // ✅ Run 3 upserts in parallel instead of sequential
            await Promise.all([
                upsertHourlyField("tb_output_actual", machineName, targetDate, `actual_${thColumn}`, output_count, "Overall", null),
                upsertHourlyField("tb_cycle_time_actual", machineName, targetDate, `cycle_${thColumn}`, parseFloat(avg_cycle_time.toFixed(2)), "cycle_time", null),
                upsertHourlyField("tb_efficiency_actual", machineName, targetDate, `eff_${thColumn}`, parseFloat(efficiency.toFixed(2)), "eff_actual", null),
            ]);

            cacheService.updateHour(machineName, thColumn, output_count, avg_cycle_time, efficiency);
            console.log(`   ✅ ${machineName}: output=${output_count}, ct=${avg_cycle_time.toFixed(2)}, eff=${efficiency.toFixed(1)}%`);

            // ✅ Yield event loop — ให้ API request อื่นแทรกได้
            await new Promise(resolve => setImmediate(resolve));
        }

        // 2.5 🆕 Sync Status/Alarm Events from InfluxDB for the last hour
        try {
            console.log(`   🔄 Syncing InfluxDB events to MSSQL for last hour...`);
            await syncEventsFromInfluxDb(start, end);
        } catch (e) {
            console.error("   ⚠️ Failed to sync InfluxDB events in summarizeLastHour:", e.message);
        }

        // 3. Recalculate Overall columns in MSSQL
        await recalcOverallInMSSQL(targetDate, Object.keys(machineData));

        // 4. ✅ Phase 1: Write model_name from InfluxDB to tb_output_actual (batched)
        try {
            const modelsByMachine = await influxService.queryAllMachinesModelsForHour(start, end);
            const modelEntries = Object.entries(modelsByMachine).filter(([, v]) => !!v);
            await Promise.all(modelEntries.map(([machineName, modelName]) =>
                prisma.tb_output_actual.updateMany({
                    where: { machine_name: machineName, date: targetDate },
                    data: { model_name: modelName },
                }).catch(e => console.error(`   ⚠️ Failed to write model_name for ${machineName}:`, e.message))
            ));
            console.log(`   📋 Model names written for ${modelEntries.length} machines`);
        } catch (e) {
            console.error("   ⚠️ InfluxDB model query failed in summarizeLastHour:", e.message);
        }

    } catch (err) {
        console.error("❌ Hourly summary failed:", err.message);
    }
}

/**
 * Upsert a single hourly field in MSSQL
 */
async function upsertHourlyField(tableName, machineName, date, fieldName, value, overallFieldName, overallValue) {
    try {
        const updateData = { [fieldName]: value };
        if (overallValue !== null && overallFieldName) {
            updateData[overallFieldName] = overallValue;
        }

        const createData = {
            machine_name: machineName,
            date,
            [fieldName]: value,
        };
        if (overallValue !== null && overallFieldName) {
            createData[overallFieldName] = overallValue;
        }

        // Atomic upsert using @@unique([machine_name, date]) — no race condition
        await prisma[tableName].upsert({
            where: {
                machine_name_date: { machine_name: machineName, date },
            },
            update: updateData,
            create: createData,
        });
    } catch (err) {
        console.error(`❌ Upsert ${tableName} for ${machineName} failed:`, err.message);
    }
}

/**
 * Recalculate Overall columns in MSSQL for given machines
 * ✅ Yield event loop ทุก 10 เครื่อง เพื่อไม่ให้ block Frontend
 */
async function recalcOverallInMSSQL(targetDate, machineNames) {
    for (let idx = 0; idx < machineNames.length; idx++) {
        const machineName = machineNames[idx];
        try {
            // Read current row
            const outputRow = await prisma.tb_output_actual.findFirst({
                where: { machine_name: machineName, date: targetDate },
            });
            const ctRow = await prisma.tb_cycle_time_actual.findFirst({
                where: { machine_name: machineName, date: targetDate },
            });

            if (!outputRow) continue;

            // Calculate Overall output
            let totalOutput = 0;
            let sumCtWeighted = 0;
            let totalOutputForCt = 0;
            let countWithData = 0;

            for (const h of SHIFT_HOURS) {
                const out = outputRow[`actual_${h}`] || 0;
                const ct = ctRow ? (ctRow[`cycle_${h}`] || 0) : 0;
                totalOutput += out;

                if (out > 0) {
                    if (ct > 0) {
                        sumCtWeighted += ct * out;
                        totalOutputForCt += out;
                    }
                    countWithData++;
                }
            }

            const avgCt = totalOutputForCt > 0 ? sumCtWeighted / totalOutputForCt : 0;
            const todayStr = getShiftDateUTC();
            const isToday = targetDate.toISOString().split('T')[0] === todayStr;
            let totalHoursPassed;
            if (isToday) {
                const currentShiftIdx = getShiftIndex(utcHourToThColumn(new Date().getUTCHours()));
                totalHoursPassed = Math.min(currentShiftIdx + 1, SHIFT_HOURS.length);
            } else {
                totalHoursPassed = SHIFT_HOURS.length;
            }

            const targetRow = await prisma.tb_output_target.findFirst({
                where: { machine_name: machineName, date: targetDate },
            });
            let totalValidSeconds = 0;
            for (let i = 0; i < totalHoursPassed; i++) {
                const h = SHIFT_HOURS[i];
                const targetVal = targetRow ? (targetRow[`target_${h}`] || 0) : 0;
                if (targetVal > 0) {
                    totalValidSeconds += 3600;
                }
            }

            const theoreticalMax = avgCt > 0 ? totalValidSeconds / avgCt : 0;
            const overallEff = theoreticalMax > 0 ? (totalOutput / theoreticalMax) * 100 : 0;

            // Update Overall columns
            await prisma.tb_output_actual.update({
                where: { id: outputRow.id },
                data: { Overall: totalOutput },
            });

            if (ctRow) {
                await prisma.tb_cycle_time_actual.update({
                    where: { id: ctRow.id },
                    data: { cycle_time: parseFloat(avgCt.toFixed(2)) },
                });
            }

            const effRow = await prisma.tb_efficiency_actual.findFirst({
                where: { machine_name: machineName, date: targetDate },
            });
            if (effRow) {
                await prisma.tb_efficiency_actual.update({
                    where: { id: effRow.id },
                    data: { eff_actual: parseFloat(overallEff.toFixed(2)) },
                });
            }
        } catch (err) {
            console.error(`❌ Recalc overall for ${machineName} failed:`, err.message);
        }

        // ✅ Yield event loop ทุก 10 เครื่อง
        if ((idx + 1) % 10 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }
}

/**
 * Job 2: Handle late-arriving data
 * Scan InfluxDB for last 48 hours, re-process any unprocessed data
 * ✅ Optimized: batch upserts + yield event loop to prevent Frontend blocking
 */
async function handleLateData() {
    const BATCH_SIZE = 50;
    try {
        const now = new Date();
        const todayStr = getShiftDateUTC();
        const lookbackMs = 48 * 60 * 60 * 1000; // 48 hours
        const startTime = new Date(now.getTime() - lookbackMs);

        // ── Step 1: Query InfluxDB once for 48h window ──
        const allData = await influxService.queryHoursRange(startTime, now);
        if (Object.keys(allData).length === 0) return;

        // Skip current hour (still in progress)
        const currentHourStart = new Date(now);
        currentHourStart.setUTCMinutes(0, 0, 0);

        // ── Step 2: Group InfluxDB data by date → machine → { field: value } ──
        // Structure: { "2026-03-05": { "AHV-001": { output: {actual_14: 100}, ct: {cycle_14: 4.2}, eff: {eff_14: 85.3} } } }
        const dateGroups = {};

        for (const [machineName, hourData] of Object.entries(allData)) {
            for (const [hourKey, data] of Object.entries(hourData)) {
                const hourDate = new Date(hourKey + ":00:00.000Z");
                if (hourDate.getTime() >= currentHourStart.getTime()) continue;

                // Check lastProcessedTime — skip if no change
                const cacheKey = `${machineName}_${hourKey}`;
                // ✅ Fix: Track both count AND timestamp — re-process if data arrived in last 30min
                const cached = lastProcessedTime[cacheKey];
                const isRecent = !cached?.lastSeenAt || (Date.now() - cached.lastSeenAt < 30 * 60 * 1000);
                if (cached?.count && data.output_count <= cached.count && !isRecent) {
                    continue;
                }

                const utcHour = hourDate.getUTCHours();
                const dateStr = hourDate.toISOString().split("T")[0];
                const thColumn = utcHourToThColumn(utcHour);
                const { output_count, avg_cycle_time } = data;
                const theoreticalMax = avg_cycle_time > 0 ? 3600 / avg_cycle_time : 0;
                const efficiency = theoreticalMax > 0 ? (output_count / theoreticalMax) * 100 : 0;

                if (!dateGroups[dateStr]) dateGroups[dateStr] = {};
                if (!dateGroups[dateStr][machineName]) dateGroups[dateStr][machineName] = { output: {}, ct: {}, eff: {} };

                dateGroups[dateStr][machineName].output[`actual_${thColumn}`] = output_count;
                dateGroups[dateStr][machineName].ct[`cycle_${thColumn}`] = parseFloat(avg_cycle_time.toFixed(2));
                dateGroups[dateStr][machineName].eff[`eff_${thColumn}`] = parseFloat(efficiency.toFixed(2));

                lastProcessedTime[cacheKey] = { count: output_count, lastSeenAt: Date.now() };

                // Update cache for today
                if (dateStr === todayStr) {
                    cacheService.updateHour(machineName, thColumn, output_count, avg_cycle_time, efficiency);
                }
            }
        }

        const dateKeys = Object.keys(dateGroups);
        if (dateKeys.length === 0) return;

        // ── Step 3: Per date — findMany + compare + batch update ──
        let totalUpdated = 0;
        let totalCreated = 0;

        for (const dateStr of dateKeys) {
            const targetDate = new Date(dateStr);
            const machineChanges = dateGroups[dateStr];

            // Load existing rows (3 queries per date — instead of N per machine)
            const [dbOutputRows, dbCtRows, dbEffRows] = await Promise.all([
                prisma.tb_output_actual.findMany({ where: { date: targetDate } }),
                prisma.tb_cycle_time_actual.findMany({ where: { date: targetDate } }),
                prisma.tb_efficiency_actual.findMany({ where: { date: targetDate } }),
            ]);

            // Build lookup maps: machine_name → row
            const outputMap = {};
            for (const row of dbOutputRows) outputMap[row.machine_name] = row;
            const ctMap = {};
            for (const row of dbCtRows) ctMap[row.machine_name] = row;
            const effMap = {};
            for (const row of dbEffRows) effMap[row.machine_name] = row;

            // Collect pending DB operations (1 per machine per table)
            const pendingOps = [];

            for (const [machineName, changes] of Object.entries(machineChanges)) {
                // Output
                if (Object.keys(changes.output).length > 0) {
                    if (outputMap[machineName]) {
                        pendingOps.push(prisma.tb_output_actual.update({
                            where: { id: outputMap[machineName].id },
                            data: changes.output,
                        }));
                        totalUpdated++;
                    } else {
                        pendingOps.push(prisma.tb_output_actual.create({
                            data: { machine_name: machineName, date: targetDate, ...changes.output },
                        }));
                        totalCreated++;
                    }
                }
                // Cycle Time
                if (Object.keys(changes.ct).length > 0) {
                    if (ctMap[machineName]) {
                        pendingOps.push(prisma.tb_cycle_time_actual.update({
                            where: { id: ctMap[machineName].id },
                            data: changes.ct,
                        }));
                        totalUpdated++;
                    } else {
                        pendingOps.push(prisma.tb_cycle_time_actual.create({
                            data: { machine_name: machineName, date: targetDate, ...changes.ct },
                        }));
                        totalCreated++;
                    }
                }
                // Efficiency
                if (Object.keys(changes.eff).length > 0) {
                    if (effMap[machineName]) {
                        pendingOps.push(prisma.tb_efficiency_actual.update({
                            where: { id: effMap[machineName].id },
                            data: changes.eff,
                        }));
                        totalUpdated++;
                    } else {
                        pendingOps.push(prisma.tb_efficiency_actual.create({
                            data: { machine_name: machineName, date: targetDate, ...changes.eff },
                        }));
                        totalCreated++;
                    }
                }
            }

            // Batch execute with event loop yielding
            for (let i = 0; i < pendingOps.length; i += BATCH_SIZE) {
                const batch = pendingOps.slice(i, i + BATCH_SIZE);
                await Promise.all(batch);
                if (i + BATCH_SIZE < pendingOps.length) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }

            // Recalculate Overall
            const machinesForDate = Object.keys(machineChanges);
            await recalcOverallInMSSQL(targetDate, machinesForDate);
            await new Promise(resolve => setImmediate(resolve));
        }

        // ── Step 4: Late Data Event Sync (Check last 2 hours to avoid heavy querying) ──
        try {
            const eventStartCutoff = new Date(now.getTime() - (2 * 60 * 60 * 1000));
            await syncEventsFromInfluxDb(eventStartCutoff, now);
        } catch (e) {
            console.error("❌ Late data event sync failed:", e.message);
        }

        if (totalUpdated > 0 || totalCreated > 0) {
            console.log(`🔍 Late data: ${totalUpdated} updated, ${totalCreated} created across ${dateKeys.length} dates (bulk)`);
        }
    } catch (err) {
        console.error("❌ Late data check failed:", err.message);
    }
}

/**
 * Startup / Sync: Backfill last N days + today from InfluxDB → MSSQL
 * ✅ Best Practice: findMany → compare in memory → batch update only changed records
 * ตรวจสอบและซ่อมข้อมูลย้อนหลัง N วัน (default 5 วัน ตอนรัน Node ใหม่)
 */
async function backfillStartup(days = 5) {
    const BACKFILL_DAYS = days;
    const BATCH_SIZE = 50; // records per transaction batch
    const BATCH_DELAY_MS = 100; // ms delay between batches to let DB breathe

    console.log(`🔄 [Startup] Backfilling last ${BACKFILL_DAYS} days + today from InfluxDB → MSSQL...`);

    try {
        const now = new Date();
        const todayStr = getShiftDateUTC();
        let totalUpdated = 0;
        let totalCreated = 0;

        // Loop from oldest day → today
        for (let i = BACKFILL_DAYS; i >= 0; i--) {
            const shiftDate = new Date(now);
            shiftDate.setUTCDate(shiftDate.getUTCDate() - i);
            const dateStr = shiftDate.toISOString().split("T")[0];

            // Shift boundaries
            const startOfShift = new Date(dateStr + "T00:00:00.000Z");
            let endOfShift;

            if (dateStr === todayStr) {
                // ✅ Include current hour: query up to NOW (not truncated to hour start)
                // This ensures corrupted current-hour data gets overwritten from InfluxDB
                endOfShift = new Date(now);
            } else {
                endOfShift = new Date(startOfShift);
                endOfShift.setUTCDate(endOfShift.getUTCDate() + 1);
            }

            // ── Step 1: Query InfluxDB once for this entire day ──
            const influxData = await influxService.queryHoursRange(startOfShift, endOfShift);
            const influxMachines = Object.keys(influxData);

            if (influxMachines.length === 0) {
                console.log(`   📅 ${dateStr}: No data in InfluxDB.`);
                continue;
            }

            const targetDate = new Date(dateStr);
            const isToday = (dateStr === todayStr);

            // ── Step 2: Load existing MSSQL rows for this date (3 queries total) ──
            const [dbOutputRows, dbCtRows, dbEffRows] = await Promise.all([
                prisma.tb_output_actual.findMany({ where: { date: targetDate } }),
                prisma.tb_cycle_time_actual.findMany({ where: { date: targetDate } }),
                prisma.tb_efficiency_actual.findMany({ where: { date: targetDate } }),
            ]);

            // Build lookup maps: machine_name → row
            const outputMap = {};
            for (const row of dbOutputRows) outputMap[row.machine_name] = row;
            const ctMap = {};
            for (const row of dbCtRows) ctMap[row.machine_name] = row;
            const effMap = {};
            for (const row of dbEffRows) effMap[row.machine_name] = row;

            // ── Step 3: Compare in memory & collect changes ──
            const pendingOps = []; // { type: 'update'|'create', table, ... }

            for (const [machineName, hourData] of Object.entries(influxData)) {
                // Collect all hour changes for this machine first
                const outputChanges = {};
                const ctChanges = {};
                const effChanges = {};

                for (const [hourKey, data] of Object.entries(hourData)) {
                    const hourDate = new Date(hourKey + ":00:00.000Z");
                    const utcHour = hourDate.getUTCHours();
                    const thColumn = utcHourToThColumn(utcHour);

                    const { output_count, avg_cycle_time } = data;
                    if (output_count <= 0) continue;

                    const theoreticalMax = avg_cycle_time > 0 ? 3600 / avg_cycle_time : 0;
                    const efficiency = theoreticalMax > 0 ? (output_count / theoreticalMax) * 100 : 0;
                    const ctRounded = parseFloat(avg_cycle_time.toFixed(2));
                    const effRounded = parseFloat(efficiency.toFixed(2));

                    // ✅ ALWAYS overwrite MSSQL with InfluxDB values (source of truth)
                    // Previous logic skipped if values matched — but corrupted data can persist
                    outputChanges[`actual_${thColumn}`] = output_count;
                    ctChanges[`cycle_${thColumn}`] = ctRounded;
                    effChanges[`eff_${thColumn}`] = effRounded;

                    // Update cache for today
                    if (isToday) {
                        cacheService.updateHour(machineName, thColumn, output_count, avg_cycle_time, efficiency);
                    }
                }

                // Build pending operations per machine (1 update/create per table per machine)
                if (Object.keys(outputChanges).length > 0) {
                    if (outputMap[machineName]) {
                        pendingOps.push({ type: "update", table: "tb_output_actual", id: outputMap[machineName].id, data: outputChanges, machineName });
                    } else {
                        pendingOps.push({ type: "create", table: "tb_output_actual", data: { machine_name: machineName, date: targetDate, ...outputChanges }, machineName });
                    }
                }
                if (Object.keys(ctChanges).length > 0) {
                    if (ctMap[machineName]) {
                        pendingOps.push({ type: "update", table: "tb_cycle_time_actual", id: ctMap[machineName].id, data: ctChanges, machineName });
                    } else {
                        pendingOps.push({ type: "create", table: "tb_cycle_time_actual", data: { machine_name: machineName, date: targetDate, ...ctChanges }, machineName });
                    }
                }
                if (Object.keys(effChanges).length > 0) {
                    if (effMap[machineName]) {
                        pendingOps.push({ type: "update", table: "tb_efficiency_actual", id: effMap[machineName].id, data: effChanges, machineName });
                    } else {
                        pendingOps.push({ type: "create", table: "tb_efficiency_actual", data: { machine_name: machineName, date: targetDate, ...effChanges }, machineName });
                    }
                }
            }
            // ── Step 3.5: Zero out stale current hour data (today only) ──
            // flushMqttMemoryToDb bug may have written prev hour data to current hour column
            if (isToday) {
                const { thColumn: curThCol } = getCurrentHourBoundaries(now);
                const actualField = `actual_${curThCol}`;
                const cycleField = `cycle_${curThCol}`;
                const effField = `eff_${curThCol}`;

                for (const [machineName, dbRow] of Object.entries(outputMap)) {
                    if ((dbRow[actualField] || 0) <= 0) continue;

                    // Check if InfluxDB has data for this machine in current hour
                    const machineInflux = influxData[machineName];
                    let hasCurrentHourInflux = false;
                    if (machineInflux) {
                        for (const hourKey of Object.keys(machineInflux)) {
                            const utcHour = new Date(hourKey + ":00:00.000Z").getUTCHours();
                            if (utcHourToThColumn(utcHour) === curThCol) {
                                hasCurrentHourInflux = true;
                                break;
                            }
                        }
                    }

                    if (!hasCurrentHourInflux) {
                        pendingOps.push({ type: "update", table: "tb_output_actual", id: dbRow.id, data: { [actualField]: 0 }, machineName });
                        if (ctMap[machineName]) {
                            pendingOps.push({ type: "update", table: "tb_cycle_time_actual", id: ctMap[machineName].id, data: { [cycleField]: 0 }, machineName });
                        }
                        if (effMap[machineName]) {
                            pendingOps.push({ type: "update", table: "tb_efficiency_actual", id: effMap[machineName].id, data: { [effField]: 0 }, machineName });
                        }
                        cacheService.updateHour(machineName, curThCol, 0, 0, 0);
                        console.log(`   🧹 ${machineName}: zeroed stale ${actualField} (was ${dbRow[actualField]})`);
                    }
                }
            }

            // ── Step 4: Batch execute pending operations ──
            if (pendingOps.length === 0) {
                console.log(`   📅 ${dateStr}: ✅ Up-to-date (${influxMachines.length} machines checked).`);
                continue;
            }

            let dayUpdated = 0;
            let dayCreated = 0;

            for (let b = 0; b < pendingOps.length; b += BATCH_SIZE) {
                const batch = pendingOps.slice(b, b + BATCH_SIZE);
                const txOps = batch.map(op => {
                    if (op.type === "update") {
                        return prisma[op.table].update({ where: { id: op.id }, data: op.data });
                    } else {
                        // Use upsert instead of create to avoid duplicates from race conditions
                        return prisma[op.table].upsert({
                            where: { machine_name_date: { machine_name: op.data.machine_name, date: op.data.date } },
                            update: op.data,
                            create: op.data,
                        });
                    }
                });

                try {
                    await prisma.$transaction(txOps);
                    for (const op of batch) {
                        if (op.type === "update") dayUpdated++;
                        else dayCreated++;
                    }
                } catch (batchErr) {
                    console.error(`   ❌ Batch error on ${dateStr} (batch ${Math.floor(b / BATCH_SIZE) + 1}):`, batchErr.message);
                    // Fallback: execute one by one so we don't lose all data in this batch
                    for (const op of batch) {
                        try {
                            if (op.type === "update") {
                                await prisma[op.table].update({ where: { id: op.id }, data: op.data });
                                dayUpdated++;
                            } else {
                                await prisma[op.table].create({ data: op.data });
                                dayCreated++;
                            }
                        } catch (singleErr) {
                            console.error(`   ❌ Single op failed: ${op.table} [${op.type}]:`, singleErr.message);
                        }
                    }
                }

                // Delay between batches to prevent connection pool exhaustion
                if (b + BATCH_SIZE < pendingOps.length) {
                    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
                }
            }

            // ── Step 5: Recalculate Overall for this day ──
            const changedMachines = [...new Set(pendingOps.map(op => op.machineName).filter(Boolean))];
            const recalcMachines = changedMachines.length > 0 ? changedMachines : influxMachines;
            await recalcOverallInMSSQL(targetDate, recalcMachines);

            console.log(`   📅 ${dateStr}: ${dayUpdated} updated, ${dayCreated} created (${influxMachines.length} machines).`);
            totalUpdated += dayUpdated;
            totalCreated += dayCreated;
        }

        const totalChanged = totalUpdated + totalCreated;
        if (totalChanged > 0) {
            console.log(`✅ Backfill complete: ${totalUpdated} updated + ${totalCreated} created across ${BACKFILL_DAYS + 1} days.`);
        } else {
            console.log("✅ All data is up-to-date. No backfill needed.");
        }

    } catch (err) {
        console.error("❌ Backfill failed:", err.message);
    }
}

/**
 * Job 4: Hourly OEE upsert
 * Calculate Availability + Performance from MC Status → upsert tb_oee
 * ng_qty, quality, oee_value only written if still 0/null
 * ✅ Optimized: bulk-fetch output+target rows, batch upserts, yield event loop
 */
async function upsertOeeHourly() {
    try {
        const todayStr = getShiftDateUTC();
        const targetDate = new Date(todayStr);
        const now = new Date();

        // ✅ DB เก็บเวลาไทย (+7) ตรงๆ ใน Datetime column
        const year = parseInt(todayStr.substring(0, 4));
        const month = parseInt(todayStr.substring(5, 7)) - 1;
        const day = parseInt(todayStr.substring(8, 10));
        const shiftStart = new Date(Date.UTC(year, month, day, 7, 0, 0));
        const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowTH = new Date(now.getTime() + TH_OFFSET_MS);

        // Query 1: Today's shift MC Status
        const todayMcStatus = await prisma.tb_MCStatus.findMany({
            where: { Datetime: { gte: shiftStart, lte: nowTH } },
            orderBy: { Datetime: "asc" },
            select: { MC: true, Datetime: true, MCStatus: true },
        });

        // Query 2: Last MC Status per machine BEFORE shiftStart (carry-over)
        const carryOverRows = await prisma.$queryRaw`
            SELECT MC, MCStatus, Datetime FROM (
                SELECT MC, MCStatus, Datetime, ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn
                FROM tb_MCStatus WHERE Datetime < ${shiftStart}
            ) t WHERE rn = 1
        `;

        // Build grouped records with carry-over prepended
        const mcStatusByMachine = {};
        for (const row of carryOverRows) {
            mcStatusByMachine[row.MC] = [{ MC: row.MC, Datetime: shiftStart, MCStatus: row.MCStatus }];
        }
        for (const rec of todayMcStatus) {
            if (!mcStatusByMachine[rec.MC]) mcStatusByMachine[rec.MC] = [];
            mcStatusByMachine[rec.MC].push(rec);
        }

        const machineNames = Object.keys(mcStatusByMachine);
        if (machineNames.length === 0) {
            console.log(`✅ [Cron] OEE hourly: no machines to process for ${todayStr}`);
            return;
        }

        // ✅ Bulk-fetch output + target rows for ALL machines (2 queries instead of N×2)
        const [allOutputRows, allTargetRows] = await Promise.all([
            prisma.tb_output_actual.findMany({ where: { date: targetDate } }),
            prisma.tb_output_target.findMany({ where: { date: targetDate } }),
        ]);
        const outputMap = {};
        for (const row of allOutputRows) outputMap[row.machine_name] = row;
        const targetMap = {};
        for (const row of allTargetRows) targetMap[row.machine_name] = row;

        // ✅ ดึง current hour output จาก InfluxDB
        const { start: currentHourStart } = getCurrentHourBoundaries(now);
        let currentHourData = {};
        try {
            currentHourData = await influxService.queryAllMachinesForHour(currentHourStart, now);
        } catch (e) {
            console.error("   ⚠️ OEE cron: failed to query InfluxDB for current hour:", e.message);
        }

        // ✅ Collect all upsert operations (CPU-only calculations, no DB calls)
        const upsertOps = [];

        for (const machineName of machineNames) {
            try {
                // Calc Availability and Performance dynamically
                const mcRecords = mcStatusByMachine[machineName] || [];
                const outputRow = outputMap[machineName];
                const targetRow = targetMap[machineName];
                
                let runTimeSeconds = 0;
                let excludedSeconds = 0;
                let totalActiveSeconds = 0;
                let totalOutput = 0;
                
                // For current hour output checking
                const currentData = currentHourData[machineName];
                // Determine current hour string (e.g. "09" or "14")
                const currentHourStr = nowTH.toISOString().substring(11, 13);

                for (let j = 0; j < SHIFT_HOURS.length; j++) {
                    const h = SHIFT_HOURS[j];
                    const isActive = !targetRow || (targetRow[`target_${h}`] > 0);
                    
                    const hStart = new Date(shiftStart.getTime() + j * 3600000);
                    const hEnd = new Date(hStart.getTime() + 3600000);

                    // Stop evaluating completely future hours
                    if (hStart >= nowTH) break;
                    
                    const blockEnd = new Date(Math.min(hEnd.getTime(), nowTH.getTime()));

                    if (isActive) {
                        // Sum actual output
                        totalOutput += (outputRow ? (outputRow[`actual_${h}`] || 0) : 0);
                        
                        // Add live influx data if this is the active current hour
                        if (h === currentHourStr && currentData && currentData.output_count > 0) {
                            totalOutput += currentData.output_count;
                        }

                        // Add runtime
                        const { runTimeSeconds: rTime, excludedSeconds: eTime } = calcMcStatusDurations(mcRecords, hStart, blockEnd);
                        runTimeSeconds += rTime;
                        excludedSeconds += eTime;
                        totalActiveSeconds += Math.max(0, (blockEnd.getTime() - hStart.getTime()) / 1000);
                    }
                }

                const availability = calcAvailability(runTimeSeconds, excludedSeconds, totalActiveSeconds);
                const idealCT = targetRow?.cycle_time_target || 0;
                const performance = calcPerformance(totalOutput, idealCT, runTimeSeconds);

                // 🆕 Fetch existing OEE to get the saved ng_qty
                const existingOee = await prisma.tb_oee.findFirst({
                    where: { machine_name: machineName, date: targetDate }
                });
                const savedNgQty = existingOee?.ng_qty || 0;

                // 🆕 Recalculate Quality & OEE Value dynamically because totalOutput grows during the day
                let quality = 0;
                let oeeValue = 0;
                
                // For manual mode, if the user hasn't updated yet (savedNgQty=0) BUT the quality was actually 0 due to no output previously,
                // we should recalculate it now that output > 0!
                if (totalOutput > 0) {
                    quality = ((totalOutput - savedNgQty) / totalOutput) * 100;
                    if (quality < 0) quality = 0;
                }
                
                if (availability > 0 && performance > 0 && quality > 0) {
                    oeeValue = (availability / 100) * (performance / 100) * (quality / 100) * 100;
                }

                const dataToWrite = {
                    availability: parseFloat(availability.toFixed(2)),
                    performance: parseFloat(performance.toFixed(2)),
                    // 🆕 Must update quality and oee_value hourly!
                    quality: parseFloat(quality.toFixed(2)),
                    oee_value: parseFloat(oeeValue.toFixed(2)),
                };

                upsertOps.push(
                    prisma.tb_oee.upsert({
                        where: { machine_name_date: { machine_name: machineName, date: targetDate } },
                        update: dataToWrite,
                        create: { date: targetDate, machine_name: machineName, ...dataToWrite, ng_qty: 0, quality: 0, oee_value: 0 },
                    })
                );
            } catch (err) {
                console.error(`   ❌ OEE calc failed for ${machineName}:`, err.message);
            }
        }

        // ✅ Batch execute all upserts
        if (upsertOps.length > 0) {
            await Promise.all(upsertOps);
        }

        console.log(`✅ [Cron] OEE hourly: updated ${upsertOps.length} machines for ${todayStr}`);
    } catch (err) {
        console.error("❌ OEE hourly cron failed:", err.message);
    }
}

/**
 * Job 5: Auto Plan Daily
 * อ่าน Config ทุกเครื่อง → สร้างแผนล่วงหน้า 7 วัน (ข้ามวันหยุด)
 */
async function autoPlanDaily() {
    try {
        const configs = await prisma.tb_machine_plan_config.findMany();
        let totalGenerated = 0;

        for (const config of configs) {
            try {
                const generated = await generatePlanForMachine(config);
                if (generated > 0) {
                    console.log(`   📋 ${config.machine_name}: สร้างแผน ${generated} วัน`);
                    totalGenerated += generated;
                }
            } catch (err) {
                console.error(`   ❌ Auto plan failed for ${config.machine_name}:`, err.message);
            }
        }

        console.log(`✅ [Cron] Auto plan complete: ${totalGenerated} plans for ${configs.length} machines`);
    } catch (err) {
        console.error("❌ Auto plan daily failed:", err.message);
    }
}

/**
 * Startup / Sync: Backfill OEE (Availability + Performance) for past days
 * ✅ recalc จาก MCStatus ย้อนหลัง → upsert tb_oee
 * ✅ Optimized: bulk-fetch output+target rows per date, batch upserts, yield event loop
 */
async function backfillOeeStartup(days = 5) {
    const BACKFILL_DAYS = days;
    console.log(`🔄 [Startup] Backfilling OEE (Availability/Performance) for last ${BACKFILL_DAYS} days...`);

    try {
        const now = new Date();
        const todayStr = getShiftDateUTC();
        let totalUpdated = 0;

        // Loop from oldest day → yesterday (today is handled by upsertOeeHourly)
        for (let i = BACKFILL_DAYS; i >= 1; i--) {
            const shiftDate = new Date(now);
            shiftDate.setUTCDate(shiftDate.getUTCDate() - i);
            const dateStr = shiftDate.toISOString().split("T")[0];
            const targetDate = new Date(dateStr);

            // Shift boundaries
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(5, 7)) - 1;
            const day = parseInt(dateStr.substring(8, 10));
            const shiftStart = new Date(Date.UTC(year, month, day, 7, 0, 0));
            const shiftEnd = new Date(Date.UTC(year, month, day + 1, 7, 0, 0));

            // Query MCStatus for this day's shift
            const mcStatusRows = await prisma.tb_MCStatus.findMany({
                where: { Datetime: { gte: shiftStart, lt: shiftEnd } },
                orderBy: { Datetime: "asc" },
                select: { MC: true, Datetime: true, MCStatus: true },
            });

            // Carry-over: last status before shift start
            const carryOverRows = await prisma.$queryRaw`
                SELECT MC, MCStatus, Datetime FROM (
                    SELECT MC, MCStatus, Datetime, ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn
                    FROM tb_MCStatus WHERE Datetime < ${shiftStart}
                ) t WHERE rn = 1
            `;

            // Group by machine
            const mcStatusByMachine = {};
            for (const row of carryOverRows) {
                mcStatusByMachine[row.MC] = [{ MC: row.MC, Datetime: shiftStart, MCStatus: row.MCStatus }];
            }
            for (const rec of mcStatusRows) {
                if (!mcStatusByMachine[rec.MC]) mcStatusByMachine[rec.MC] = [];
                mcStatusByMachine[rec.MC].push(rec);
            }

            const machineNames = Object.keys(mcStatusByMachine);
            if (machineNames.length === 0) {
                console.log(`   📅 ${dateStr}: No MCStatus data.`);
                continue;
            }

            // ✅ Bulk-fetch output + target rows for this date (2 queries instead of N×2)
            const [allOutputRows, allTargetRows] = await Promise.all([
                prisma.tb_output_actual.findMany({ where: { date: targetDate } }),
                prisma.tb_output_target.findMany({ where: { date: targetDate } }),
            ]);
            const outputMap = {};
            for (const row of allOutputRows) outputMap[row.machine_name] = row;
            const targetMap = {};
            for (const row of allTargetRows) targetMap[row.machine_name] = row;

            // ✅ Collect all upserts (CPU-only calculations, no DB calls in loop)
            const upsertOps = [];

            for (const machineName of machineNames) {
                try {
                    const mcRecords = mcStatusByMachine[machineName] || [];
                    const outputRow = outputMap[machineName];
                    const targetRow = targetMap[machineName];

                    let runTimeSeconds = 0;
                    let excludedSeconds = 0;
                    let totalActiveSeconds = 0;
                    let totalOutput = 0;

                    for (let j = 0; j < SHIFT_HOURS.length; j++) {
                        const h = SHIFT_HOURS[j];
                        const isActive = !targetRow || (targetRow[`target_${h}`] > 0);
                        
                        if (isActive) {
                            totalOutput += (outputRow ? (outputRow[`actual_${h}`] || 0) : 0);
                            const hStart = new Date(shiftStart.getTime() + j * 3600000);
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

                    // 🆕 Fetch existing OEE to get the saved ng_qty for backfilling
                    const existingOee = await prisma.tb_oee.findFirst({
                        where: { machine_name: machineName, date: targetDate }
                    });
                    const savedNgQty = existingOee?.ng_qty || 0;

                    let quality = 0;
                    let oeeValue = 0;
                    
                    if (totalOutput > 0) {
                        quality = ((totalOutput - savedNgQty) / totalOutput) * 100;
                        if (quality < 0) quality = 0;
                    }
                    
                    if (availability > 0 && performance > 0 && quality > 0) {
                        oeeValue = (availability / 100) * (performance / 100) * (quality / 100) * 100;
                    }

                    const dataToWrite = {
                        availability: parseFloat(availability.toFixed(2)),
                        performance: parseFloat(performance.toFixed(2)),
                        quality: parseFloat(quality.toFixed(2)),
                        oee_value: parseFloat(oeeValue.toFixed(2)),
                    };

                    upsertOps.push(
                        prisma.tb_oee.upsert({
                            where: { machine_name_date: { machine_name: machineName, date: targetDate } },
                            update: dataToWrite,
                            create: { date: targetDate, machine_name: machineName, ...dataToWrite, ng_qty: 0, quality: 0, oee_value: 0 },
                        })
                    );
                } catch (err) {
                    console.error(`   ❌ OEE backfill calc failed for ${machineName} on ${dateStr}:`, err.message);
                }
            }

            // ✅ Batch execute all upserts for this day
            if (upsertOps.length > 0) {
                await Promise.all(upsertOps);
            }

            console.log(`   📅 ${dateStr}: OEE backfilled for ${upsertOps.length} machines.`);
            totalUpdated += upsertOps.length;

            // ✅ Yield event loop between days
            await new Promise(resolve => setImmediate(resolve));
        }

        console.log(`✅ [Startup] OEE backfill complete: ${totalUpdated} records updated.`);
    } catch (err) {
        console.error("❌ OEE backfill startup failed:", err.message);
    }
}

/**
 * 🆕 Hourly summarized NG by station 
 * Reads InfluxDB for the past hour and upserts into tb_machine_ng
 */
async function summarizeNgHourly() {
    try {
        const now = new Date();
        const prevHourStart = new Date(now);
        prevHourStart.setUTCMinutes(0, 0, 0);
        prevHourStart.setUTCHours(prevHourStart.getUTCHours() - 1); // Go back 1 hour
        const prevHourEnd = new Date(prevHourStart);
        prevHourEnd.setUTCHours(prevHourEnd.getUTCHours() + 1);

        const dateStr = getShiftDateUTC(prevHourStart);
        const utcHour = prevHourStart.getUTCHours();
        const thColumn = utcHourToThColumn(utcHour);

        console.log(`🎯 [Cron] Summarizing NG for hour ${thColumn} (${dateStr})...`);

        // Get station config
        const stationsGrouped = await getStationConfigGrouped();
        const activeMachines = Object.keys(stationsGrouped);
        if (activeMachines.length === 0) return;

        let totalUpserts = 0;

        for (const machineName of activeMachines) {
             const stations = stationsGrouped[machineName];
             if (!stations || stations.length === 0) continue;

             const stationNgCounts = await influxService.queryNgByStationForHour(machineName, prevHourStart, prevHourEnd, stations);
             
             for (const st of stations) {
                 const ngVal = stationNgCounts[st.station_name] || 0;
                 if (ngVal > 0) {
                     await prisma.tb_machine_ng.upsert({
                         where: {
                             machine_name_date_station_id: {
                                 machine_name: machineName,
                                 date: new Date(dateStr),
                                 station_id: st.id      // ✅ Use station_id FK
                             }
                         },
                         update: {
                             [`ng_${thColumn}`]: ngVal
                         },
                         create: {
                             machine_name: machineName,
                             date: new Date(dateStr),
                             station_id: st.id,         // ✅ FK
                             [`ng_${thColumn}`]: ngVal
                         }
                     });
                     totalUpserts++;
                 }
             }

             // 🆕 Save True NG Parts as station_id = 0
             const trueNgVal = stationNgCounts['True_NG'] || 0;
             if (trueNgVal > 0) {
                 await prisma.tb_machine_ng.upsert({
                     where: {
                         machine_name_date_station_id: {
                             machine_name: machineName,
                             date: new Date(dateStr),
                             station_id: 0      // 🆕 0 represents True Part NG
                         }
                     },
                     update: { [`ng_${thColumn}`]: trueNgVal },
                     create: {
                         machine_name: machineName,
                         date: new Date(dateStr),
                         station_id: 0,
                         [`ng_${thColumn}`]: trueNgVal
                     }
                 });
                 totalUpserts++;
             }
        }

        // Recalculate Overall_ng column for rows updated today
        await recalcOverallNg(new Date(dateStr));
        console.log(`✅ [Cron] NG summarized for ${dateStr} (upserted ${totalUpserts} station records)`);
    } catch (err) {
        console.error("❌ summarizeNgHourly failed:", err.message);
    }
}

/**
 * Helper to get active stations grouped by machine name
 */
async function getStationConfigGrouped() {
    const stations = await prisma.tbm_machine_station.findMany({
        where: { status: 'active' },
        orderBy: { station_number: 'asc' }
    });
    const grouped = {};
    for (const st of stations) {
        if (!grouped[st.machine_name]) grouped[st.machine_name] = [];
        grouped[st.machine_name].push(st);
    }
    return grouped;
}

/**
 * Recalculate the sum of ALL hour columns and update Overall_ng
 */
async function recalcOverallNg(targetDate) {
    const rows = await prisma.tb_machine_ng.findMany({
        where: { date: targetDate }
    });
    
    for (const row of rows) {
        let total = 0;
        for (const h of SHIFT_HOURS) {
            total += (row[`ng_${h}`] || 0);
        }
        await prisma.tb_machine_ng.update({
            where: { id: row.id },
            data: { Overall_ng: total }
        });
    }
}

/**
 * 🆕 Backfill NG data for a single day
 */
async function backfillNgSingleDay(startOfShift, endOfShift, dateStr) {
    const targetDate = new Date(dateStr);
    const stationsGrouped = await getStationConfigGrouped();
    const activeMachines = Object.keys(stationsGrouped);
    if (activeMachines.length === 0) return;

    let totalUpserts = 0;

    for (const machineName of activeMachines) {
        const stations = stationsGrouped[machineName];
        if (!stations || stations.length === 0) continue;

        // Loop over each hour of the shift
        let curHour = new Date(startOfShift);
        while (curHour < endOfShift) {
            const nextHour = new Date(curHour);
            nextHour.setUTCHours(nextHour.getUTCHours() + 1);

            // Break if the nextHour > endOfShift ONLY if it's the current hour we're backfilling
            const queryEnd = nextHour > endOfShift ? endOfShift : nextHour;
            const thColumn = utcHourToThColumn(curHour.getUTCHours());
            
            const stationNgCounts = await influxService.queryNgByStationForHour(machineName, curHour, queryEnd, stations);
            
            for (const st of stations) {
                 const ngVal = stationNgCounts[st.station_name] || 0;
                 if (ngVal > 0) {
                     await prisma.tb_machine_ng.upsert({
                         where: {
                             machine_name_date_station_id: {
                                 machine_name: machineName,
                                 date: targetDate,
                                 station_id: st.id      // ✅ Use station_id FK
                             }
                         },
                         update: {
                             [`ng_${thColumn}`]: ngVal
                         },
                         create: {
                             machine_name: machineName,
                             date: targetDate,
                             station_id: st.id,         // ✅ FK
                             [`ng_${thColumn}`]: ngVal
                         }
                     });
                     totalUpserts++;
                 }
             }

             // 🆕 Save True NG Parts as station_id = 0
             const trueNgVal = stationNgCounts['True_NG'] || 0;
             if (trueNgVal > 0) {
                 await prisma.tb_machine_ng.upsert({
                     where: {
                         machine_name_date_station_id: {
                             machine_name: machineName,
                             date: targetDate,
                             station_id: 0      // 🆕 0 represents True Part NG
                         }
                     },
                     update: { [`ng_${thColumn}`]: trueNgVal },
                     create: {
                         machine_name: machineName,
                         date: targetDate,
                         station_id: 0,
                         [`ng_${thColumn}`]: trueNgVal
                     }
                 });
                 totalUpserts++;
             }

            curHour = nextHour;
        }
    }
    await recalcOverallNg(targetDate);
    if (totalUpserts > 0) {
        console.log(`   🎯 NG Backfilled ${totalUpserts} station segments for ${dateStr}`);
    }
}

/**
 * 🆕 Backfill NG data on server startup / daily sync
 * Mirrors backfillStartup() logic — covers last N days + current moment (NOW)
 * Prevents NG data gaps when server was offline during a cron window
 */
async function backfillNgStartup(days = 5) {
    const BACKFILL_DAYS = days;
    console.log(`🔄 [Startup] Backfilling NG station data for last ${BACKFILL_DAYS} days + today...`);

    try {
        const now = new Date();
        const todayStr = getShiftDateUTC(now);

        for (let i = BACKFILL_DAYS; i >= 0; i--) {
            const shiftDate = new Date(now);
            shiftDate.setUTCDate(shiftDate.getUTCDate() - i);
            const dateStr = getShiftDateUTC(shiftDate);

            const startOfShift = new Date(dateStr + "T00:00:00.000Z");
            let endOfShift;

            if (dateStr === todayStr) {
                // ✅ Today: up to NOW so any hours missed since last crash are backfilled
                endOfShift = new Date(now);
            } else {
                // Past days: full 24h window
                endOfShift = new Date(startOfShift);
                endOfShift.setUTCDate(endOfShift.getUTCDate() + 1);
            }

            await backfillNgSingleDay(startOfShift, endOfShift, dateStr);
        }

        console.log("✅ [Startup] NG backfill complete");
    } catch (err) {
        console.error("❌ backfillNgStartup failed:", err.message);
    }
}

/**
 * Core Logic to Sync Status and Alarm events from InfluxDB to MSSQL
 */
async function syncEventsFromInfluxDb(startUTC, endUTC) {
    const statusData = await influxService.queryStatusRange(startUTC, endUTC);
    const alarmData = await influxService.queryAlarmRange(startUTC, endUTC);

    let statusRecovered = 0;
    let alarmRecovered = 0;

    if (statusData.length > 0) {
        const existingStatus = await prisma.tb_MCStatus.findMany({
            where: { Datetime: { gte: startUTC, lt: endUTC } },
            select: { MC: true, Datetime: true }
        });
        const existingSet = new Set(existingStatus.map(r => `${r.MC}_${r.Datetime.getTime()}`));

        const newStatus = statusData.filter(d => !existingSet.has(`${d.machine_name}_${d.time.getTime()}`));
        if (newStatus.length > 0) {
            await prisma.tb_MCStatus.createMany({
                data: newStatus.map(d => ({
                    Datetime: d.time,
                    MC: d.machine_name,
                    MCStatus: d.status
                }))
            });
            statusRecovered = newStatus.length;
        }
    }

    if (alarmData.length > 0) {
        const existingAlarm = await prisma.tb_MCAlarm.findMany({
            where: { Datetime: { gte: startUTC, lt: endUTC } },
            select: { MC: true, Datetime: true }
        });
        const existingSet = new Set(existingAlarm.map(r => `${r.MC}_${r.Datetime.getTime()}`));

        const newAlarm = alarmData.filter(d => !existingSet.has(`${d.machine_name}_${d.time.getTime()}`));
        if (newAlarm.length > 0) {
            await prisma.tb_MCAlarm.createMany({
                data: newAlarm.map(d => ({
                    Datetime: d.time,
                    MC: d.machine_name,
                    MCAlarm: d.alarm
                }))
            });
            alarmRecovered = newAlarm.length;
        }
    }

    if (statusRecovered > 0 || alarmRecovered > 0) {
        console.log(`   ✅ Recovered ${statusRecovered} Status and ${alarmRecovered} Alarm records from InfluxDB.`);
    }
}

/**
 * Startup / Sync: Backfill historical Status and Alarm data from InfluxDB -> MSSQL
 * Used on server restart to recover missing real-time events.
 */
async function backfillEventsStartup(days = 5) {
    console.log(`🔄 [Startup] Backfilling last ${days} days for Status & Alarm from InfluxDB → MSSQL...`);
    try {
        const now = new Date();
        const start = new Date(now);
        start.setUTCDate(start.getUTCDate() - days);
        await syncEventsFromInfluxDb(start, now);
    } catch (err) {
        console.error("❌ Events startup backfill failed:", err.message);
    }
}

/**
 * 🆕 5-Minute MSSQL Status Poller for Web Dashboard (Fallback mechanism)
 * Fetches the ABSOLUTE LATEST status & alarm from MSSQL for each machine
 * and updates mqttService memory + emits to web if it is newer.
 */
async function pollMssqlStatusForWeb() {
    try {
        const { updateStateFromMssqlPoller } = require("./mqttService");
        if (typeof updateStateFromMssqlPoller !== "function") return;

        console.log("🔍 [Cron] Polling latest MSSQL Status/Alarm for Web Sync...");

        // Use PRISMA raw query or grouping to find latest status per machine
        const machines = await prisma.tbm_machine.findMany({
            where: { status: 'active' },
            select: { machine_name: true }
        });

        for (const m of machines) {
            const machineName = m.machine_name;
            const latestStatus = await prisma.tb_MCStatus.findFirst({
                where: { MC: machineName },
                orderBy: { Datetime: 'desc' },
                select: { MCStatus: true, Datetime: true }
            });
            
            const latestAlarm = await prisma.tb_MCAlarm.findFirst({
                where: { MC: machineName },
                orderBy: { Datetime: 'desc' },
                select: { MCAlarm: true, Datetime: true }
            });

            // Update state (mqttService logic will diff natively and only emit if changed)
            updateStateFromMssqlPoller(
                machineName, 
                latestStatus ? latestStatus.MCStatus : undefined, 
                latestAlarm ? latestAlarm.MCAlarm : undefined
            );
        }
    } catch (err) {
        console.error("❌ pollMssqlStatusForWeb failed:", err.message);
    }
}

module.exports = {
    startCronJobs,
    summarizeLastHour,
    summarizeNgHourly,
    handleLateData,
    recalcOverallInMSSQL,
    backfillStartup,
    backfillNgStartup,
    backfillEventsStartup,
    upsertOeeHourly,
    backfillOeeStartup,
    autoPlanDaily,
    syncEventsFromInfluxDb,
    pollMssqlStatusForWeb
};

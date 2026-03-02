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

// Track last processed time per machine for late data detection
const lastProcessedTime = {};

/**
 * Start all cron jobs
 */
function startCronJobs() {
    const hourlyExpr = process.env.CRON_HOURLY || "0 * * * *";
    const lateExpr = process.env.CRON_LATE_DATA || "*/15 * * * *";
    const rolloverExpr = process.env.CRON_DAILY_ROLLOVER || "5 0 * * *";

    // Job 1: Hourly summary — ทุกต้นชั่วโมง
    cron.schedule(hourlyExpr, async () => {
        console.log(`⏰ [Cron] Hourly summary starting at ${new Date().toISOString()}`);
        await summarizeLastHour();
    });

    // Job 2: Late data check — ทุก 15 นาที
    cron.schedule(lateExpr, async () => {
        console.log(`🔍 [Cron] Late data check at ${new Date().toISOString()}`);
        await handleLateData();
    });

    // Job 3: Daily rollover — 00:05 UTC (07:05 TH)
    cron.schedule(rolloverExpr, async () => {
        console.log(`🌅 [Cron] Daily rollover at ${new Date().toISOString()}`);
        await cacheService.clearAndRollover();
    });

    // Job 4: OEE hourly — upsert availability + performance to tb_oee
    const oeeExpr = process.env.CRON_OEE_HOURLY || "5 * * * *";
    cron.schedule(oeeExpr, async () => {
        console.log(`📈 [Cron] OEE hourly upsert at ${new Date().toISOString()}`);
        await upsertOeeHourly();
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
    console.log(`   Auto plan: "${autoPlanExpr}"`);
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
 */
async function recalcOverallInMSSQL(targetDate, machineNames) {
    for (const machineName of machineNames) {
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
                    // Count valid hours for theoretical max (heuristic)
                    countWithData++;
                }
            }

            const avgCt = totalOutputForCt > 0 ? sumCtWeighted / totalOutputForCt : 0;
            // วันนี้: ใช้ shift index ปัจจุบัน / วันเก่า: กะจบแล้ว = 24 ชม.
            const todayStr = getShiftDateUTC();
            const isToday = targetDate.toISOString().split('T')[0] === todayStr;
            let totalHoursPassed;
            if (isToday) {
                const currentShiftIdx = getShiftIndex(utcHourToThColumn(new Date().getUTCHours()));
                totalHoursPassed = Math.min(currentShiftIdx + 1, SHIFT_HOURS.length);
            } else {
                totalHoursPassed = SHIFT_HOURS.length; // 24 — กะจบแล้ว
            }

            // Query target row to only count hours with target > 0
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

        // Query all data in 48h window grouped by machine+hour
        const allData = await influxService.queryHoursRange(startTime, now);

        // ── Step 1: Collect all pending operations (no DB calls yet) ──
        const pendingOps = [];

        for (const [machineName, hourData] of Object.entries(allData)) {
            for (const [hourKey, data] of Object.entries(hourData)) {
                const hourDate = new Date(hourKey + ":00:00.000Z");
                const utcHour = hourDate.getUTCHours();
                const dateStr = hourDate.toISOString().split("T")[0];
                const thColumn = utcHourToThColumn(utcHour);

                // Skip current hour (still in progress)
                const currentHourStart = new Date(now);
                currentHourStart.setUTCMinutes(0, 0, 0);
                if (hourDate.getTime() >= currentHourStart.getTime()) continue;

                // Check if already processed
                const cacheKey = `${machineName}_${hourKey}`;
                if (lastProcessedTime[cacheKey] && data.output_count <= lastProcessedTime[cacheKey]) {
                    continue;
                }

                const { output_count, avg_cycle_time } = data;
                const theoreticalMax = avg_cycle_time > 0 ? 3600 / avg_cycle_time : 0;
                const efficiency = theoreticalMax > 0 ? (output_count / theoreticalMax) * 100 : 0;
                const targetDate = new Date(dateStr);

                // Queue 3 upsert operations per hour
                pendingOps.push({ table: "tb_output_actual", machineName, date: targetDate, field: `actual_${thColumn}`, value: output_count });
                pendingOps.push({ table: "tb_cycle_time_actual", machineName, date: targetDate, field: `cycle_${thColumn}`, value: parseFloat(avg_cycle_time.toFixed(2)) });
                pendingOps.push({ table: "tb_efficiency_actual", machineName, date: targetDate, field: `eff_${thColumn}`, value: parseFloat(efficiency.toFixed(2)) });

                lastProcessedTime[cacheKey] = output_count;

                // Update cache for today
                if (dateStr === todayStr) {
                    cacheService.updateHour(machineName, thColumn, output_count, avg_cycle_time, efficiency);
                }
            }
        }

        // ── Step 2: Batch execute with event loop yielding ──
        if (pendingOps.length > 0) {
            const updatedHours = pendingOps.length / 3;
            for (let i = 0; i < pendingOps.length; i += BATCH_SIZE) {
                const batch = pendingOps.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(op =>
                    upsertHourlyField(op.table, op.machineName, op.date, op.field, op.value, null, null)
                ));
                // ✅ Yield event loop — ให้ API request อื่นแทรกได้
                if (i + BATCH_SIZE < pendingOps.length) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }

            console.log(`🔍 Late data: updated ${updatedHours} hours (${pendingOps.length} ops batched)`);

            // Recalculate Overall for affected dates
            const affectedDates = [...new Set(
                Object.values(allData)
                    .flatMap(hd => Object.keys(hd))
                    .map(hk => hk.slice(0, 10))
            )].map(d => new Date(d));

            for (const date of affectedDates) {
                const machinesForDate = Object.keys(allData);
                await recalcOverallInMSSQL(date, machinesForDate);
                await new Promise(resolve => setImmediate(resolve));
            }
        }
    } catch (err) {
        console.error("❌ Late data check failed:", err.message);
    }
}

/**
 * Startup: Backfill last 5 days + today from InfluxDB → MSSQL
 * ✅ Best Practice: findMany → compare in memory → batch update only changed records
 * ตรวจสอบและซ่อมข้อมูลย้อนหลัง 5 วัน ทุกครั้งที่รัน Node ใหม่
 */
async function backfillStartup() {
    const BACKFILL_DAYS = 5;
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
                endOfShift = new Date(now);
                endOfShift.setUTCMinutes(0, 0, 0);
                if (startOfShift >= endOfShift) {
                    console.log(`   📅 ${dateStr}: No previous hours to backfill yet.`);
                    continue;
                }
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

                    // Compare with existing DB values
                    const existingOutput = outputMap[machineName];
                    const existingCt = ctMap[machineName];
                    const existingEff = effMap[machineName];

                    const dbOutputVal = existingOutput ? (existingOutput[`actual_${thColumn}`] || 0) : null;
                    const dbCtVal = existingCt ? (existingCt[`cycle_${thColumn}`] || 0) : null;
                    const dbEffVal = existingEff ? (existingEff[`eff_${thColumn}`] || 0) : null;

                    // Only add to changes if value is different
                    if (dbOutputVal === null || dbOutputVal !== output_count) {
                        outputChanges[`actual_${thColumn}`] = output_count;
                    }
                    if (dbCtVal === null || dbCtVal !== ctRounded) {
                        ctChanges[`cycle_${thColumn}`] = ctRounded;
                    }
                    if (dbEffVal === null || dbEffVal !== effRounded) {
                        effChanges[`eff_${thColumn}`] = effRounded;
                    }

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
                // Calc Availability
                const mcRecords = mcStatusByMachine[machineName] || [];
                const { runTimeSeconds, excludedSeconds, totalSeconds } = calcMcStatusDurations(mcRecords, shiftStart, nowTH);
                const availability = calcAvailability(runTimeSeconds, excludedSeconds, totalSeconds);

                // Calc Performance: totalOutput + idealCT
                const outputRow = outputMap[machineName];
                let totalOutput = 0;
                if (outputRow) {
                    for (const h of SHIFT_HOURS) {
                        totalOutput += (outputRow[`actual_${h}`] || 0);
                    }
                }
                const currentData = currentHourData[machineName];
                if (currentData && currentData.output_count > 0) {
                    totalOutput += currentData.output_count;
                }
                const targetRow = targetMap[machineName];
                const idealCT = targetRow?.cycle_time_target || 0;
                const performance = calcPerformance(totalOutput, idealCT, runTimeSeconds);

                const dataToWrite = {
                    availability: parseFloat(availability.toFixed(2)),
                    performance: parseFloat(performance.toFixed(2)),
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
 * Startup: Backfill OEE (Availability + Performance) for past days
 * ✅ recalc จาก MCStatus ย้อนหลัง → upsert tb_oee
 * ✅ Optimized: bulk-fetch output+target rows per date, batch upserts, yield event loop
 */
async function backfillOeeStartup() {
    const BACKFILL_DAYS = 5;
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
                    const { runTimeSeconds, excludedSeconds, totalSeconds } = calcMcStatusDurations(mcRecords, shiftStart, shiftEnd);
                    const availability = calcAvailability(runTimeSeconds, excludedSeconds, totalSeconds);

                    // Total output from pre-fetched map
                    const outputRow = outputMap[machineName];
                    let totalOutput = 0;
                    if (outputRow) {
                        for (const h of SHIFT_HOURS) {
                            totalOutput += (outputRow[`actual_${h}`] || 0);
                        }
                    }

                    const targetRow = targetMap[machineName];
                    const idealCT = targetRow?.cycle_time_target || 0;
                    const performance = calcPerformance(totalOutput, idealCT, runTimeSeconds);

                    const dataToWrite = {
                        availability: parseFloat(availability.toFixed(2)),
                        performance: parseFloat(performance.toFixed(2)),
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

module.exports = {
    startCronJobs,
    summarizeLastHour,
    handleLateData,
    recalcOverallInMSSQL,
    backfillStartup,
    upsertOeeHourly,
    backfillOeeStartup,
    autoPlanDaily,
};

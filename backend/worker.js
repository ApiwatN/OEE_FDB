/**
 * Worker Thread — Background Services
 * ================================
 * Runs: Cron Jobs, MQTT, Real-time Polling, InfluxDB, Cache
 * ไม่มี Express/Socket.IO — ส่ง payload กลับ Main Thread ผ่าน IPC
 */
require("dotenv").config();
const { parentPort } = require("worker_threads");

// ── IPC Emit Functions ─────────────────────────────────
// แทน Socket.IO — ส่ง message กลับ Main Thread ให้ emit ให้

function emitToRoom(room, event, data) {
    parentPort.postMessage({ type: "emit", room, event, data });
}

function broadcast(event, data) {
    parentPort.postMessage({ type: "broadcast", event, data });
}

function log(message) {
    parentPort.postMessage({ type: "log", message });
}

// ── Load Services ──────────────────────────────────────
const { initClient } = require("./services/influxService");
const { hydrateFromMSSQL, hydrateAvailabilityFromMSSQL, hydrateRuntimeFromMSSQL } = require("./services/cacheService");
// Phase 11: State Snapshot Service — Checkpoint + Boot Recovery + Graceful Shutdown
const { loadAndRestore, startCheckpoint } = require("./services/stateSnapshotService");
const {
    startCronJobs,
    backfillStartup,
    upsertOeeHourly,
    backfillOeeStartup,
    backfillNgStartup,
    backfillEventsStartup,
    pollMssqlStatusForWeb,
} = require("./services/cronService");
const { startRealtimePolling } = require("./services/realtimeService");
const {
    initializeMqtt,
    hydrateMqttMemoryFromInflux,
    scheduleResync,
} = require("./services/mqttService");

// ── Startup Sequence ───────────────────────────────────
async function startup() {
    try {
        log("🔧 Worker thread starting...");

        // 1. Initialize InfluxDB client
        initClient();

        // 1.5. Phase 11: Boot Recovery — restore RAM state from snapshot (InfluxDB gap fill included)
        // ถ้า backup ไม่เก่าเกิน 2 ชม. จะ restore mqttMem + oeeState กลับมา แล้ว fill gap จาก InfluxDB
        // ถ้าไม่มี backup หรือ backup เก่าเกินไป → cold boot ตามปกติ
        await loadAndRestore();

        // 2. Hydrate cache from MSSQL (initial load)
        await hydrateFromMSSQL();

        // 2.1 Backfill ALL hours (including current) from InfluxDB → MSSQL
        await backfillStartup();

        // 2.15 🆕 Backfill station NG data (mirrors Output backfill — 5 days + today)
        await backfillNgStartup();

        // 2.16 🆕 Backfill historical Status & Alarm (Recover from InfluxDB)
        await backfillEventsStartup();

        // 2.2 Re-hydrate cache from corrected MSSQL data (including availability + runtime tables)
        await hydrateFromMSSQL();
        // Phase 11: Hydrate Availability + Runtime caches from new tables
        await hydrateAvailabilityFromMSSQL();
        await hydrateRuntimeFromMSSQL();

        // 2.3 OEE: upsert availability + performance to tb_oee immediately
        await upsertOeeHourly();

        // 2.4 OEE Backfill: recalc availability + performance for past 5 days
        await backfillOeeStartup();

        // 2.5 🆕 [Phase 4] Hydrate OEE Memory Stopwatch from MSSQL (cold-boot recovery)
        // ถ้า server รีสตาร์ทกลางวัน stopwatch จะถูก rebuild จาก MCStatus history ทันที
        const memOeeService = require('./services/memoryOeeService');
        const { getShiftDateUTC } = require('./utils/timeUtils');
        const todayShiftDate = getShiftDateUTC();
        await memOeeService.hydrateFromMssql(todayShiftDate);
        log(`✅ OEE memory stopwatch hydrated (shift: ${todayShiftDate})`);

        // 3. Start cron jobs
        startCronJobs();

        // 4. Start real-time polling (emit via IPC instead of Socket.IO)
        startRealtimePolling(emitToRoom, broadcast);

        // 4.5 Sync MQTT memory from InfluxDB for current hour
        await hydrateMqttMemoryFromInflux();

        // 4.6 Start MQTT Service — receives ONLY new messages after this point
        initializeMqtt(emitToRoom, broadcast);

        // 4.7 Re-sync MQTT memory from InfluxDB after 5s (fix timing gap)
        scheduleResync();

        // 4.8 🆕 Force initial poll from MSSQL to populate live Status/Alarm in memory
        await pollMssqlStatusForWeb();

        // 4.9 Phase 11: Start Checkpoint timer — save state to disk every 5 minutes
        // ต้องเริ่มหลังจาก services ทั้งหมดพร้อมแล้ว เพื่อให้ snapshot มีข้อมูลครบ
        startCheckpoint();

        log("✅ Worker thread startup completed!");
    } catch (err) {
        console.error("❌ Worker startup failed:", err);
        process.exit(1);
    }
}

startup();

// Phase 11: รับ IPC message จาก Main Thread (Graceful Shutdown)
// เมื่อ Main Thread ส่ง { type: "save_snapshot" } มา → Worker จะ saveNow() แล้วตอบกลับ
parentPort.on("message", async (msg) => {
    if (msg && msg.type === "save_snapshot") {
        try {
            const snapshotService = require("./services/stateSnapshotService");
            snapshotService.saveNow();
            console.log("[Worker] Snapshot saved on shutdown request.");
        } catch (e) {
            console.error("[Worker] Failed to save snapshot on shutdown:", e.message);
        }
        // แจ้ง Main Thread ว่า save เสร็จแล้ว → safe to call server.close()
        parentPort.postMessage({ type: "snapshot_saved" });
    }
});

/**
 * State Snapshot Service
 * บันทึก Memory State ตัวแปรลงไฟล์ JSON ป้องกันข้อมูลหายตอน Server restart/crash
 */
const fs = require('fs');
const path = require('path');
const mqttService = require('./mqttService');
const memoryOeeService = require('./memoryOeeService');
// ใช้ influxService (InfluxDB 1.x) ที่โปรเจกต์นี้ใช้อยู่แล้ว — ไม่ใช้ @influxdata/influxdb-client (v2)
const { getClient } = require('./influxService');
require('dotenv').config();

const STORE_DIR = path.join(__dirname, '../store');
const BACKUP_FILE = path.join(STORE_DIR, 'state_backup.json');

// Ensure directory exists
if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
}

function mapToObject(map) {
    const obj = {};
    for (const [k, v] of map.entries()) {
        obj[k] = v;
    }
    return obj;
}

/**
 * Save current RAM states to JSON
 */
function saveNow() {
    try {
        const mqttMem = mqttService.getMachineStateMem();
        const oeeState = memoryOeeService.getStateMap();

        const snapshot = {
            timestamp: new Date().toISOString(),
            mqttMem: mapToObject(mqttMem),
            oeeState: mapToObject(oeeState)
        };

        fs.writeFileSync(BACKUP_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
        console.log(`💾 [Snapshot] State saved successfully at ${snapshot.timestamp}`);
    } catch (err) {
        console.error('⚠️ [Snapshot] Failed to save state:', err.message);
    }
}

/**
 * Load backup file and recover state
 */
async function loadAndRestore() {
    if (!fs.existsSync(BACKUP_FILE)) {
        console.log('ℹ️ [Snapshot] No backup file found. Proceeding with cold boot.');
        return false;
    }

    try {
        const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
        const snapshot = JSON.parse(raw);

        // Check age
        const backupTime = new Date(snapshot.timestamp);
        const ageMs = Date.now() - backupTime.getTime();
        
        // If older than 2 hours (2 * 60 * 60 * 1000), ignore it
        if (ageMs > 2 * 3600 * 1000) {
            console.log(`⚠️ [Snapshot] Backup is too old (${Math.round(ageMs/60000)} mins). Ignoring.`);
            return false;
        }

        console.log(`🔄 [Snapshot] Restoring state from backup dated: ${snapshot.timestamp}`);
        mqttService.restoreMachineStateMem(snapshot.mqttMem || {});
        memoryOeeService.restoreStateMap(snapshot.oeeState || {});

        // Fill gap between backup and now from InfluxDB
        await queryInfluxGap(backupTime);

        console.log('✅ [Snapshot] Restore complete.');
        return true;
    } catch (err) {
        console.error('⚠️ [Snapshot] Failed to load backup:', err.message);
        return false;
    }
}

async function queryInfluxGap(fromTime) {
    console.log(`🔍 [Snapshot] Querying InfluxDB for gap since ${fromTime.toISOString()} ...`);
    try {
        // ใช้ influxService client ที่ init แล้ว (InfluxDB 1.x)
        let client;
        try {
            client = getClient();
        } catch (e) {
            console.log('⚠️ [Snapshot] InfluxDB client not ready yet, skipping gap fill.');
            return;
        }

        const fromISO = fromTime.toISOString();
        const toISO = new Date().toISOString();

        const query = `
            SELECT "Status", "machine_name"
            FROM "status_tb"
            WHERE time >= '${fromISO}' AND time <= '${toISO}'
            ORDER BY time ASC
        `;

        const results = await client.query(query);
        for (const row of results) {
            const machineName = row.machine_name || row.tags?.machine_name;
            const status = row.Status;
            if (machineName && status) {
                memoryOeeService.processStatusChange(machineName, status, new Date(row.time));
            }
        }

        console.log(`✅ [Snapshot] InfluxDB gap recovery finished. (${results.length} status events)`);
    } catch (e) {
        console.error('⚠️ [Snapshot] Gap recovery failed:', e.message);
    }
}


let checkpointTimer = null;

function startCheckpoint() {
    if (checkpointTimer) clearInterval(checkpointTimer);
    // every 5 minutes
    checkpointTimer = setInterval(saveNow, 5 * 60 * 1000);
    console.log('⏰ [Snapshot] Checkpoint timer started (5 mins).');
}

module.exports = {
    saveNow,
    loadAndRestore,
    startCheckpoint
};

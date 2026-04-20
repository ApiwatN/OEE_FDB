/**
 * sync_ahv_influx_full.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time full re-sync script สำหรับแก้ปัญหา model \"--\" ใน MSSQL
 *
 * PHASE 1 — AHV (วันที่ 17–20 เมษายน 2026):
 *   - ดึงข้อมูลจาก InfluxDB ทีละวัน (queryHoursRange)
 *   - DELETE แถว AHV เดิมใน MSSQL ทิ้งก่อน (clean slate)
 *   - CREATE แถว "Dorado 10D" ใหม่ด้วยค่าจาก InfluxDB
 *   - กฎพิเศษ: model \"--\" จาก InfluxDB → ตีเป็น \"Dorado 10D\"
 *             ถ้าชั่วโมงเดียวกันมีทั้ง \"--\" และ \"Dorado 10D\" → SUM รวมกัน
 *   - Skip ชั่วโมงปัจจุบัน (ถ้า sync วันที่ 20) เพื่อไม่ตัดข้อมูล live
 *   - Recalculate Overall column หลัง sync ครบทุก machine
 *
 * PHASE 2 — ABR:
 *   - deleteMany แถว model_name = \"--\" ทุกวันออกจาก MSSQL
 *
 * Run: node scripts/sync_ahv_influx_full.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const influxService = require('../services/influxService');
const { utcHourToThColumn, SHIFT_HOURS } = require('../utils/timeUtils');

const prisma = new PrismaClient();

// ──────────────────────────────────────────────────────
// กำหนดช่วงวันที่ที่ต้อง sync (UTC dates = shift dates)
// Shift เริ่ม 00:00 UTC (= 07:00 TH) ของแต่ละวัน
// ──────────────────────────────────────────────────────
const SYNC_DATES = [
    '2026-04-17',
    '2026-04-18',
    '2026-04-19',
    '2026-04-20',
];

const AHV_MODEL_FALLBACK = 'Dorado 10D';

// ──────────────────────────────────────────────────────────────────────────────
// Helper: Recalculate Overall column ใน MSSQL สำหรับ machine+date
// ──────────────────────────────────────────────────────────────────────────────
async function recalcOverall(machineName, targetDate) {
    const rows = await prisma.tb_output_actual.findMany({
        where: { machine_name: machineName, date: targetDate },
    });
    if (rows.length === 0) return;

    for (const row of rows) {
        let total = 0;
        for (const h of SHIFT_HOURS) {
            total += row[`actual_${h}`] || 0;
        }
        await prisma.tb_output_actual.update({
            where: { id: row.id },
            data: { Overall: total },
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PHASE 1: AHV Re-sync from InfluxDB
// ──────────────────────────────────────────────────────────────────────────────
async function syncAhvFromInflux() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  PHASE 1: AHV Re-sync from InfluxDB (17–20)');
    console.log('══════════════════════════════════════════════');

    const now = new Date();
    // Current hour start in UTC — skip hours >= this for today
    const currentHourStart = new Date(now);
    currentHourStart.setUTCMinutes(0, 0, 0);

    let totalDeleted = 0;
    let totalCreated = 0;
    let totalMachines = 0;

    for (const dateStr of SYNC_DATES) {
        const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
        const shiftStart = targetDate; // 00:00 UTC = 07:00 TH
        const shiftEnd = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000); // +1 day

        console.log(`\n📅 Processing ${dateStr}...`);
        console.log(`   InfluxDB window: ${shiftStart.toISOString()} → ${shiftEnd.toISOString()}`);

        // 1. Query InfluxDB — ดึงทุกชั่วโมงของวันนี้
        let influxData;
        try {
            influxData = await influxService.queryHoursRange(shiftStart, shiftEnd);
        } catch (err) {
            console.error(`   ❌ InfluxDB query failed for ${dateStr}:`, err.message);
            continue;
        }

        // 2. Filter เฉพาะ AHV
        const ahvMachines = Object.keys(influxData).filter(m => m.startsWith('AHV-'));
        if (ahvMachines.length === 0) {
            console.log(`   ⚠️  No AHV data found in InfluxDB for ${dateStr}`);
            continue;
        }

        console.log(`   Found ${ahvMachines.length} AHV machines in InfluxDB: ${ahvMachines.join(', ')}`);

        for (const machineName of ahvMachines) {
            const hourData = influxData[machineName]; // { "YYYY-MM-DDTHH": { ..., models: {} } }

            // ── ขั้นตอน A: สร้าง per-hour map รวม "--" เข้า "Dorado 10D" ──
            // { "07": 834, "08": 875, "09": 419, ... }
            const hourTotals = {}; // { thColumn: outputCount }

            for (const [hourKey, data] of Object.entries(hourData)) {
                const hourDate = new Date(`${hourKey}:00:00.000Z`);

                // Skip ชั่วโมงปัจจุบัน (วันที่ 20 เท่านั้น)
                if (hourDate.getTime() >= currentHourStart.getTime()) {
                    console.log(`   ⏭️  [${machineName}] Skipped ${hourKey} (current/future hour)`);
                    continue;
                }

                const utcHour = hourDate.getUTCHours();
                const thColumn = utcHourToThColumn(utcHour);

                // รวมทุก model — "--" ก็ตีเป็น Dorado 10D
                let hourOutput = 0;
                if (data.models && Object.keys(data.models).length > 0) {
                    for (const [, mData] of Object.entries(data.models)) {
                        hourOutput += mData.output_count || 0;
                    }
                } else {
                    // InfluxDB ไม่มี model tag เลย → ใช้ output_count ของ machine
                    hourOutput = data.output_count || 0;
                }

                if (hourOutput > 0) {
                    hourTotals[thColumn] = (hourTotals[thColumn] || 0) + hourOutput;
                }
            }

            if (Object.keys(hourTotals).length === 0) {
                console.log(`   ⏭️  [${machineName}] No usable hourly data for ${dateStr}`);
                continue;
            }

            // ── ขั้นตอน B: DELETE แถว AHV เดิมทั้งหมดสำหรับ machine+date ──
            const deleted = await prisma.tb_output_actual.deleteMany({
                where: { machine_name: machineName, date: targetDate },
            });
            if (deleted.count > 0) {
                console.log(`   🗑️  [${machineName}] Deleted ${deleted.count} old MSSQL row(s) for ${dateStr}`);
                totalDeleted += deleted.count;
            }

            // ── ขั้นตอน C: CREATE แถว "Dorado 10D" ใหม่ด้วยค่าจาก InfluxDB ──
            const createData = {
                machine_name: machineName,
                date: targetDate,
                model_name: AHV_MODEL_FALLBACK,
                Overall: 0,
            };
            let overallTotal = 0;
            for (const [col, count] of Object.entries(hourTotals)) {
                createData[`actual_${col}`] = count;
                overallTotal += count;
            }
            createData.Overall = overallTotal;

            await prisma.tb_output_actual.create({ data: createData });
            console.log(`   ✅ [${machineName}] Created "${AHV_MODEL_FALLBACK}" row for ${dateStr} | Overall=${overallTotal} | Hours: ${Object.keys(hourTotals).map(h => `${h}:${hourTotals[h]}`).join(', ')}`);
            totalCreated++;
            totalMachines++;
        }
    }

    console.log(`\n📊 PHASE 1 Summary:`);
    console.log(`   Deleted old rows : ${totalDeleted}`);
    console.log(`   Created new rows : ${totalCreated}`);
    console.log(`   Machine-dates    : ${totalMachines}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// PHASE 2: ABR — Delete all "--" rows from MSSQL
// ──────────────────────────────────────────────────────────────────────────────
async function deleteAbrDashRows() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  PHASE 2: ABR — Delete "--" rows from MSSQL');
    console.log('══════════════════════════════════════════════');

    const result = await prisma.tb_output_actual.deleteMany({
        where: {
            machine_name: { startsWith: 'ABR-' },
            model_name: '--',
        },
    });

    console.log(`   🗑️  Deleted ${result.count} ABR "--" row(s) from MSSQL`);
    return result.count;
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 Starting full AHV InfluxDB sync + ABR cleanup...');
    console.log(`   Timestamp: ${new Date().toISOString()}`);

    // Initialize InfluxDB client (ต้องเรียกเองเพราะ run นอก server)
    influxService.initClient();

    try {
        // ── PHASE 1: AHV ──
        await syncAhvFromInflux();

        // ── PHASE 2: ABR ──
        await deleteAbrDashRows();

        console.log('\n🎉 All done! Please restart the server to refresh cache:');
        console.log('   Ctrl+C then: node --watch server.js');

    } catch (err) {
        console.error('\n❌ Script failed:', err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();

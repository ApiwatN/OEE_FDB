/**
 * recalc_avail_today.js
 * คำนวณ Availability รายชั่วโมงของวันนี้ใหม่ → เขียนลง tb_availability_actual
 * รองรับ AHV (output_based): avail_h = (output_h × CT_h) / validSec × 100
 * ใช้ per-hour fallback: ถ้าชม.นั้นมี real model → real model, ถ้ามีแค่ "--" → fallback "--"
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { getShiftDateUTC, SHIFT_HOURS } = require('../utils/timeUtils');
const { getMachineRunTimeMode } = require('../services/oeeCalcService');
const prisma = new PrismaClient();

async function main() {
    const todayStr = getShiftDateUTC();
    const targetDate = new Date(todayStr);
    const [y, m, d] = todayStr.split('-').map(Number);
    const shiftStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)); // shift 07:00 TH = 00:00 UTC
    const now = new Date();

    console.log(`\n📅 Recalculating hourly Availability for ${todayStr}...\n`);

    // โหลดเฉพาะเครื่องที่ active
    const machines = await prisma.tbm_machine.findMany({
        where: { status: 'active' },
        select: { machine_name: true }
    });

    let updated = 0;
    for (const { machine_name } of machines) {
        const mode = getMachineRunTimeMode(machine_name);
        if (mode !== 'output_based') continue; // เฉพาะ AHV (output_based)

        const [outputRows, ctRow, targetRow] = await Promise.all([
            prisma.tb_output_actual.findMany({ where: { machine_name, date: targetDate } }),
            prisma.tb_cycle_time_actual.findFirst({ where: { machine_name, date: targetDate } }),
            prisma.tb_output_target.findFirst({ where: { machine_name, date: targetDate } }),
        ]);

        if (!targetRow) continue; // ไม่มี target ข้าม

        const availUpdates = {};
        const debugLine = [];

        for (let i = 0; i < SHIFT_HOURS.length; i++) {
            const h = SHIFT_HOURS[i];
            const hStart = new Date(shiftStart.getTime() + i * 3600000);
            const hEnd = new Date(hStart.getTime() + 3600000);
            if (hStart >= now) break; // ยังไม่ถึงชั่วโมงนี้

            // Target ชั่วโมงนี้ต้องมี (ไม่งั้นไม่นับ)
            const targetHour = targetRow[`target_${h}`] || 0;
            if (targetHour === 0) {
                availUpdates[`avail_${h}`] = 0;
                continue;
            }

            // Per-hour fallback: real model wins, "--" only if no real model has output for this hour
            const realRows = outputRows.filter(r => r.model_name !== '--' && (r[`actual_${h}`] || 0) > 0);
            let output;
            if (realRows.length > 0) {
                output = realRows.reduce((acc, r) => acc + (r[`actual_${h}`] || 0), 0);
            } else {
                const dashRow = outputRows.find(r => r.model_name === '--');
                output = dashRow ? (dashRow[`actual_${h}`] || 0) : 0;
            }

            // CT: actual ก่อน, fallback target CT
            const ct = ctRow ? (ctRow[`cycle_${h}`] || 0) : 0;
            const ctToUse = ct > 0 ? ct : (targetRow.cycle_time_target || 0);

            // validSec: ชั่วโมงที่ผ่านมาแล้ว (capped at now)
            const validSec = (Math.min(hEnd, now) - hStart) / 1000;
            const runTime = output * ctToUse;
            const avail = validSec > 0 ? Math.min(100, (runTime / validSec) * 100) : 0;

            availUpdates[`avail_${h}`] = parseFloat(avail.toFixed(2));
            if (i < 8) debugLine.push(`${h}=${avail.toFixed(0)}%(${output}pcs)`);
        }

        // Upsert to tb_availability_actual
        const existing = await prisma.tb_availability_actual.findFirst({ where: { machine_name, date: targetDate } });
        if (existing) {
            await prisma.tb_availability_actual.update({ where: { id: existing.id }, data: availUpdates });
        } else {
            await prisma.tb_availability_actual.create({ data: { machine_name, date: targetDate, ...availUpdates } });
        }

        console.log(`  ✅ ${machine_name}: ${debugLine.join('  ')}`);
        updated++;
    }

    console.log(`\n✅ Done — ${updated} output_based machines updated.\n`);
    await prisma.$disconnect();
}

main().catch(async e => { console.error(e.message); await prisma.$disconnect(); });

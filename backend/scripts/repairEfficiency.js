/**
 * One-time Repair Script: Fix eff_actual for all records in tb_efficiency_actual
 * 
 * สาเหตุ: recalcOverallInMSSQL() ใช้ new Date() (ชม.ปัจจุบัน) แทน 24 ชม. สำหรับวันเก่า
 * ทำให้ eff_actual ที่เก็บใน MSSQL ผิด
 * 
 * วิธีใช้: cd backend && node scripts/repairEfficiency.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const SHIFT_HOURS = [
    "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
    "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06"
];

async function repair() {
    console.log("🔧 Starting eff_actual repair...\n");

    const effRows = await prisma.tb_efficiency_actual.findMany();
    console.log(`📋 Found ${effRows.length} records in tb_efficiency_actual\n`);

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const effRow of effRows) {
        try {
            const { machine_name, date } = effRow;

            // ดึง output + cycle time ของวันเดียวกัน
            const outputRow = await prisma.tb_output_actual.findFirst({
                where: { machine_name, date },
            });
            const ctRow = await prisma.tb_cycle_time_actual.findFirst({
                where: { machine_name, date },
            });

            if (!outputRow) {
                skippedCount++;
                continue;
            }

            // คำนวณ avgCT (weighted average)
            let sumCtWeighted = 0;
            let totalOutputForCt = 0;
            let totalOutput = 0;

            for (const h of SHIFT_HOURS) {
                const out = outputRow[`actual_${h}`] || 0;
                const ct = ctRow ? (ctRow[`cycle_${h}`] || 0) : 0;
                totalOutput += out;
                if (out > 0 && ct > 0) {
                    sumCtWeighted += ct * out;
                    totalOutputForCt += out;
                }
            }

            const avgCt = totalOutputForCt > 0 ? sumCtWeighted / totalOutputForCt : 0;

            // วันเก่า = กะจบแล้ว = 24 ชม.
            const totalHoursPassed = SHIFT_HOURS.length; // 24
            const totalValidSeconds = totalHoursPassed * 3600;
            const theoreticalMax = avgCt > 0 ? totalValidSeconds / avgCt : 0;
            const newEff = theoreticalMax > 0 ? (totalOutput / theoreticalMax) * 100 : 0;
            const newEffRounded = parseFloat(newEff.toFixed(2));

            const oldEff = effRow.eff_actual || 0;

            // อัปเดตถ้าค่าเปลี่ยน
            if (Math.abs(oldEff - newEffRounded) > 0.01) {
                await prisma.tb_efficiency_actual.update({
                    where: { id: effRow.id },
                    data: { eff_actual: newEffRounded },
                });
                console.log(`  ✅ ${machine_name} | ${date.toISOString().split('T')[0]} | ${oldEff}% → ${newEffRounded}%`);
                fixedCount++;
            } else {
                skippedCount++;
            }
        } catch (err) {
            console.error(`  ❌ Error for id=${effRow.id}:`, err.message);
            errorCount++;
        }
    }

    console.log(`\n🏁 Repair complete!`);
    console.log(`   Fixed:   ${fixedCount}`);
    console.log(`   Skipped: ${skippedCount} (already correct)`);
    console.log(`   Errors:  ${errorCount}`);

    await prisma.$disconnect();
}

repair().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});

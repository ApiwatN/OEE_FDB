/**
 * Fix P OEE ของ AHV machines วันที่ 20 เม.ย. 2026
 * โดยใช้ recalculateAPQForDay ที่มี per-hour fallback อยู่แล้ว
 * แต่ก่อนแก้จะแสดง simulation ก่อนเขียนลง DB
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { recalculateAPQForDay } = require("../services/oeeCalcService");

const SHIFT_HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"];
const TARGET_DATE = new Date("2026-04-20T00:00:00.000Z");

async function simulate(machineName) {
    const actuals = await prisma.tb_output_actual.findMany({ where: { machine_name: machineName, date: TARGET_DATE } });
    const target  = await prisma.tb_output_target.findFirst({ where: { machine_name: machineName, date: TARGET_DATE } });
    const ct      = await prisma.tb_cycle_time_actual.findFirst({ where: { machine_name: machineName, date: TARGET_DATE } });

    // per-hour fallback output (same logic as recalculateAPQForDay in oeeCalcService)
    const outputSumPerHour = {};
    for (const h of SHIFT_HOURS) {
        const realRows = actuals.filter(r => r.model_name !== "--" && (r[`actual_${h}`] || 0) > 0);
        if (realRows.length > 0) {
            outputSumPerHour[h] = realRows.reduce((acc, r) => acc + (r[`actual_${h}`] || 0), 0);
        } else {
            const dashRow = actuals.find(r => r.model_name === "--");
            outputSumPerHour[h] = dashRow ? (dashRow[`actual_${h}`] || 0) : 0;
        }
    }

    // totalOutput: only hours with target > 0
    let totalOutput = 0;
    let totalActiveSeconds = 0;
    for (const h of SHIFT_HOURS) {
        const isActive = !target || (target[`target_${h}`] > 0);
        if (isActive) {
            totalOutput += (outputSumPerHour[h] || 0);
            totalActiveSeconds += 3600;
        }
    }

    // avgCT: weighted average from ct row
    let sumCtWeighted = 0, totalOutputForCt = 0;
    for (const h of SHIFT_HOURS) {
        const out = outputSumPerHour[h] || 0;
        const ctV = ct ? (ct[`cycle_${h}`] || 0) : 0;
        if (out > 0 && ctV > 0) { sumCtWeighted += ctV * out; totalOutputForCt += out; }
    }
    const avgCt = totalOutputForCt > 0 ? (sumCtWeighted / totalOutputForCt) : 0;
    const avgToUse = avgCt > 0 ? avgCt : (target?.cycle_time_target || 0);

    const runTimeSeconds = totalOutput * avgToUse;
    const availPct = totalActiveSeconds > 0 ? Math.min(100, (runTimeSeconds / totalActiveSeconds) * 100) : 0;
    const idealCT  = target?.cycle_time_target || 0;
    const perfPct  = runTimeSeconds > 0 && idealCT > 0 ? (totalOutput * idealCT / runTimeSeconds) * 100 : 0;

    console.log(`  [SIM] output=${totalOutput} | avgCT=${avgToUse.toFixed(2)}s | idealCT=${idealCT}s`);
    console.log(`  [SIM] runTime=${runTimeSeconds.toFixed(0)}s | totalActive=${totalActiveSeconds}s`);
    console.log(`  [SIM] A=${availPct.toFixed(2)}% | P=${perfPct.toFixed(2)}%`);
}

async function main() {
    const machines = await prisma.tbm_machine.findMany({
        where: { machine_name: { startsWith: "AHV" }, status: "active" },
        select: { machine_name: true },
        orderBy: { machine_name: "asc" },
    });

    console.log("\n=== SIMULATION (before fix) ===");
    for (const { machine_name } of machines) {
        const oee = await prisma.tb_oee.findFirst({ where: { machine_name, date: TARGET_DATE } });
        console.log(`\n${machine_name}: current A=${oee?.availability}% P=${oee?.performance}%`);
        await simulate(machine_name);
    }

    console.log("\n=== APPLYING FIX via recalculateAPQForDay ===\n");
    for (const { machine_name } of machines) {
        await recalculateAPQForDay(machine_name, TARGET_DATE);
    }

    console.log("\n=== RESULT AFTER FIX ===");
    for (const { machine_name } of machines) {
        const oee = await prisma.tb_oee.findFirst({ where: { machine_name, date: TARGET_DATE } });
        console.log(`  ${machine_name}: A=${oee?.availability}% | P=${oee?.performance}% | Q=${oee?.quality}% | OEE=${oee?.oee_value}%`);
    }

    await prisma.$disconnect();
    console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });

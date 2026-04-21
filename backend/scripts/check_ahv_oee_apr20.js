/**
 * ตรวจสอบข้อมูล AHV machines วันที่ 20 เม.ย. 2026
 * เพื่อหาสาเหตุที่ P ไม่ถูกต้อง
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TARGET_DATE = new Date("2026-04-20T00:00:00.000Z"); // MSSQL stores UTC midnight = Thai shift date

async function main() {
    console.log("=== AHV OEE check for 2026-04-20 ===\n");

    // 1. ดึง machines ที่เป็น AHV
    const machines = await prisma.tbm_machine.findMany({
        where: { machine_name: { startsWith: "AHV" }, status: "active" },
        select: { machine_name: true },
        orderBy: { machine_name: "asc" },
    });
    console.log(`Found ${machines.length} AHV machines: ${machines.map(m => m.machine_name).join(", ")}\n`);

    for (const { machine_name } of machines) {
        console.log(`─── ${machine_name} ───`);

        // tb_oee
        const oee = await prisma.tb_oee.findFirst({ where: { machine_name, date: TARGET_DATE } });
        if (oee) {
            console.log(`  tb_oee: A=${oee.availability}% | P=${oee.performance}% | Q=${oee.quality}% | OEE=${oee.oee_value}% | ng=${oee.ng_qty}`);
        } else {
            console.log(`  tb_oee: NO RECORD`);
        }

        // tb_output_target
        const target = await prisma.tb_output_target.findFirst({ where: { machine_name, date: TARGET_DATE } });
        if (target) {
            const SHIFT_HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"];
            const totalTarget = SHIFT_HOURS.reduce((s, h) => s + (target[`target_${h}`] || 0), 0);
            console.log(`  target: totalTarget=${totalTarget} | eff_target=${target.eff_target}% | cycle_time_target=${target.cycle_time_target}s`);
        } else {
            console.log(`  target: NO RECORD`);
        }

        // tb_output_actual (per model)
        const actuals = await prisma.tb_output_actual.findMany({ where: { machine_name, date: TARGET_DATE } });
        if (actuals.length > 0) {
            const SHIFT_HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"];
            for (const a of actuals) {
                const total = SHIFT_HOURS.reduce((s, h) => s + (a[`actual_${h}`] || 0), 0);
                console.log(`  actual[${a.model_name}]: total=${total}`);
            }
        } else {
            console.log(`  actual: NO RECORD`);
        }

        // tb_cycle_time_actual – avg CT
        const ct = await prisma.tb_cycle_time_actual.findFirst({ where: { machine_name, date: TARGET_DATE } });
        if (ct) {
            const SHIFT_HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"];
            let sumCt = 0, cntHr = 0;
            for (const h of SHIFT_HOURS) {
                const v = ct[`cycle_${h}`] || 0;
                if (v > 0) { sumCt += v; cntHr++; }
            }
            const avgCt = cntHr > 0 ? (sumCt / cntHr) : 0;
            console.log(`  cycle_time_actual: cycle_time(daily_avg)=${ct.cycle_time}s | computed avg=${avgCt.toFixed(2)}s across ${cntHr} hours`);
        } else {
            console.log(`  cycle_time_actual: NO RECORD`);
        }

        // tb_availability_actual
        const avail = await prisma.tb_availability_actual.findFirst({ where: { machine_name, date: TARGET_DATE } });
        if (avail) {
            console.log(`  availability_actual: avail_actual=${avail.avail_actual}%`);
        } else {
            console.log(`  availability_actual: NO RECORD`);
        }

        console.log("");
    }

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

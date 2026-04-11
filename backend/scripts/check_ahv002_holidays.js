/**
 * Diagnostic: Check AHV-002 data on holiday dates in InfluxDB and MSSQL (March 2026)
 * Usage: node check_ahv002_holidays.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { initClient, getClient } = require("./services/influxService");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

const MACHINE = "AHV-002";
const MONTH = "2026-03";

async function main() {
    const prisma = new PrismaClient();
    initClient();

    const startDate = dayjs(MONTH).startOf("month").toDate();
    const endDate = dayjs(MONTH).endOf("month").toDate();

    console.log(`\n====================================================`);
    console.log(` Diagnostic: ${MACHINE} | Month: ${MONTH}`);
    console.log(`====================================================\n`);

    // ── MSSQL: Holidays ──────────────────────────────────────────────
    const holidays = await prisma.tb_machine_holiday.findMany({
        where: { machine_name: MACHINE, holiday_date: { gte: startDate, lte: endDate } },
        orderBy: { holiday_date: "asc" },
    });
    const holidayDates = holidays.map(h => dayjs(h.holiday_date).format("YYYY-MM-DD"));
    console.log(`[MSSQL] tb_machine_holiday (${holidayDates.length} rows):`);
    if (holidayDates.length === 0) console.log("  → No holidays found.");
    holidayDates.forEach(d => console.log(`  - ${d}`));
    console.log();

    // ── MSSQL: tb_machine_ng on holiday dates ─────────────────────────
    console.log(`[MSSQL] tb_machine_ng on holiday dates:`);
    for (const hDate of holidayDates) {
        const ngs = await prisma.tb_machine_ng.findMany({
            where: {
                machine_name: MACHINE,
                date: {
                    gte: new Date(`${hDate}T00:00:00.000Z`),
                    lte: new Date(`${hDate}T23:59:59.999Z`),
                },
            },
        });
        const total = ngs.reduce((sum, ng) => {
            const cols = ["ng_07","ng_08","ng_09","ng_10","ng_11","ng_12","ng_13","ng_14","ng_15","ng_16","ng_17","ng_18","ng_19","ng_20","ng_21","ng_22","ng_23","ng_00","ng_01","ng_02","ng_03","ng_04","ng_05","ng_06"];
            return sum + cols.reduce((s, c) => s + (ng[c] || 0), 0);
        }, 0);
        console.log(`  ${hDate}: ${ngs.length} NG row(s), total_ng=${total}, has_production=${ngs.some(n => n.station_id === 0)}`);
    }
    console.log();

    // ── MSSQL: tb_oee on holiday dates ───────────────────────────────
    console.log(`[MSSQL] tb_oee on holiday dates:`);
    for (const hDate of holidayDates) {
        const oees = await prisma.tb_oee.findMany({
            where: {
                machine_name: MACHINE,
                date: {
                    gte: new Date(`${hDate}T00:00:00.000Z`),
                    lte: new Date(`${hDate}T23:59:59.999Z`),
                },
            },
        });
        if (oees.length === 0) {
            console.log(`  ${hDate}: No tb_oee row`);
        } else {
            oees.forEach(o => console.log(`  ${hDate}: ng_qty=${o.ng_qty}, quality=${o.quality}, oee_value=${o.oee_value}`));
        }
    }
    console.log();

    // ── MSSQL: tb_output_actual on holiday dates ──────────────────────
    console.log(`[MSSQL] tb_output_actual on holiday dates:`);
    for (const hDate of holidayDates) {
        const actuals = await prisma.tb_output_actual.findMany({
            where: {
                machine_name: MACHINE,
                date: {
                    gte: new Date(`${hDate}T00:00:00.000Z`),
                    lte: new Date(`${hDate}T23:59:59.999Z`),
                },
            },
        });
        if (actuals.length === 0) {
            console.log(`  ${hDate}: No tb_output_actual row`);
        } else {
            actuals.forEach(a => console.log(`  ${hDate}: Overall=${a.Overall}, model=${a.model_name}`));
        }
    }
    console.log();

    // ── InfluxDB: output_count on holiday dates (Thai shift: 07:00–07:00 UTC+7 = 00:00–00:00 UTC) ──
    const influx = getClient();
    const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";
    console.log(`[InfluxDB] output_count for ${MACHINE} on holiday dates (UTC shift 00:00–23:59:59):`);
    for (const hDate of holidayDates) {
        // Thai factory day: 07:00 ICT = 00:00 UTC  to  next day 06:59:59 ICT = 23:59:59 UTC
        const startUTC = `${hDate}T00:00:00Z`;
        const endUTC   = `${hDate}T23:59:59Z`;
        const q = `SELECT COUNT("cycle_time") AS "cnt" FROM "${measurement}" WHERE "machine_name"='${MACHINE}' AND time>='${startUTC}' AND time<='${endUTC}'`;
        try {
            const res = await influx.query(q);
            const cnt = res.length > 0 ? (res[0].cnt || 0) : 0;
            console.log(`  ${hDate}: output_count=${cnt}`);
        } catch (e) {
            console.log(`  ${hDate}: ERROR - ${e.message}`);
        }
    }
    console.log();

    console.log("====================================================");
    console.log(" Done.");
    console.log("====================================================\n");
    await prisma.$disconnect();
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});

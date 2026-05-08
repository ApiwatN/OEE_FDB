const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const Influx = require('influx');
const fs = require('fs');
require('dotenv').config();

const influxClient = new Influx.InfluxDB({
    host: process.env.INFLUX_HOST || "192.168.100.99",
    port: parseInt(process.env.INFLUX_PORT || "5012", 10),
    database: process.env.INFLUX_DATABASE || "machine_db",
});

async function run() {
    try {
        console.log("Starting 7-day data consistency check (Local Date)...");
        
        // 7 days ago corresponds to March 10th to March 16th
        const START_DATE = '2026-03-10';
        const END_DATE = '2026-03-16';

        // 1. Influx DB Query - Note: we group by 1d, so we shift by -7h in query logic if needed, 
        // but here we can just query UTC boundaries strictly and map it
        // Local: 2026-03-10 07:00 TH -> 2026-03-10 00:00 UTC
        // Local: 2026-03-17 06:59 TH -> 2026-03-16 23:59 UTC
        console.log("Querying InfluxDB (UTC 00:00 to 23:59 represents Local TH Shifts)...");
        const influxQuery = `
            SELECT count("cycle_time") 
            FROM "data_tb" 
            WHERE time >= '${START_DATE}T00:00:00Z' AND time <= '${END_DATE}T23:59:59Z' 
            GROUP BY time(1d)
        `;
        const influxResults = await influxClient.query(influxQuery);
        
        const influxMap = {};
        for (const row of influxResults) {
            const dStr = row.time.toISOString().split('T')[0];
            influxMap[dStr] = row.count || 0;
        }

        // 2. MSSQL Query
        console.log("Querying MSSQL tb_output_actual...");
        const sqlDailyCounts = await prisma.tb_output_actual.groupBy({
            by: ['date'],
            where: {
                date: {
                    gte: new Date(`${START_DATE}T00:00:00.000Z`),
                    lte: new Date(`${END_DATE}T23:59:59.000Z`),
                }
            },
            _sum: {
                Overall: true
            },
            orderBy: {
                date: 'asc'
            }
        });

        const sqlMap = {};
        for (const row of sqlDailyCounts) {
            const dStr = row.date.toISOString().split('T')[0];
            sqlMap[dStr] = row._sum.Overall || 0;
        }

        // 3. Compare Both
        console.log("\n=======================================================");
        console.log(" 🗓️  7-Day Comparison Report (Local Shift Dates) ");
        console.log("=======================================================");
        console.log("| Date       | InfluxDB | MSSQL    | Diff (In - SQL) | Status |");
        console.log("|------------|----------|----------|-----------------|--------|");
        
        const dateArray = ['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15', '2026-03-16'];

        for (const d of dateArray) {
            const inCount = influxMap[d] || 0;
            const sqlCount = sqlMap[d] || 0;
            const diff = inCount - sqlCount;
            const status = diff === 0 ? "✅ MATCH " : "❌ DIFF ";
            
            console.log(`| ${d} | ${inCount.toString().padEnd(8)} | ${sqlCount.toString().padEnd(8)} | ${diff.toString().padEnd(15)} | ${status}|`);
        }
        console.log("=======================================================\n");

    } catch (e) {
        console.error("Error during check:", e);
    } finally {
        await prisma.$disconnect();
    }
}

run();

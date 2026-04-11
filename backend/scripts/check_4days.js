const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const Influx = require('influx');
require('dotenv').config();

const influxClient = new Influx.InfluxDB({
    host: process.env.INFLUX_HOST || "192.168.100.99",
    port: parseInt(process.env.INFLUX_PORT || "5012", 10),
    database: process.env.INFLUX_DATABASE || "machine_db",
});

async function run() {
    try {
        console.log("Checking last 4 days data between InfluxDB and MSSQL...");
        const dates = ['2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20'];
        
        for (const dateStr of dates) {
            console.log(`\n========================================`);
            console.log(`--- Date: ${dateStr} ---`);
            const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
            
            // Query MSSQL
            const mssqlResults = await prisma.tb_output_actual.findMany({
                where: { date: targetDate },
                select: { machine_name: true, Overall: true }
            });
            const mssqlMap = {};
            let totalMssql = 0;
            for (const row of mssqlResults) {
                mssqlMap[row.machine_name] = row.Overall || 0;
                totalMssql += row.Overall || 0;
            }

            // Query InfluxDB
            const dateStart = `${dateStr}T00:00:00Z`;
            const dateEnd = `${dateStr}T23:59:59Z`;

            const query = `
                SELECT count("cycle_time") as "count" 
                FROM "data_tb" 
                WHERE time >= '${dateStart}' AND time <= '${dateEnd}' 
                GROUP BY "machine_name"
            `;
            const influxResults = await influxClient.query(query);
            
            const influxMap = {};
            let totalInflux = 0;
            
            for (const row of influxResults) {
                const mac = row.machine_name;
                const count = row.count || 0;
                influxMap[mac] = count;
                totalInflux += count;
            }

            console.log(`InfluxDB Total: ${totalInflux}`);
            console.log(`MSSQL Total:    ${totalMssql}`);
            console.log(`Status:         ${totalInflux === totalMssql ? '✅ MATCH' : '❌ MISMATCH'}`);
            
            if (totalInflux !== totalMssql) {
                console.log(`\nMachine Level Differences for ${dateStr}:`);
                const allMachines = new Set([...Object.keys(mssqlMap), ...Object.keys(influxMap)]);
                for (const mac of allMachines) {
                    const mVal = mssqlMap[mac] || 0;
                    const iVal = influxMap[mac] || 0;
                    if (mVal !== iVal) {
                        console.log(`  - ${mac}: Influx=${iVal}, MSSQL=${mVal} (Diff: ${iVal - mVal})`);
                    }
                }
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
run();

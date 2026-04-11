const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function run() {
    try {
        console.log("Preparing to sync 10th Efficiency Data to MSSQL tb_efficiency_actual...");
        
        const targetDate = new Date('2026-03-10T00:00:00.000Z');
        
        const Influx = require('influx');
        require('dotenv').config();

        const influxClient = new Influx.InfluxDB({
            host: process.env.INFLUX_HOST || "192.168.100.99",
            port: parseInt(process.env.INFLUX_PORT || "5012", 10),
            database: process.env.INFLUX_DATABASE || "machine_db",
        });

        console.log("Querying InfluxDB directly for 10th hourly by machine...");
        const query = `
            SELECT count("cycle_time") as output_count, mean("cycle_time") as avg_cycle_time
            FROM "data_tb" 
            WHERE time >= '2026-03-10T00:00:00Z' AND time <= '2026-03-10T23:59:59Z' 
            GROUP BY "machine_name", time(1h)
        `;
        const results = await influxClient.query(query);

        const effUpdates = {};
        
        for (const row of results) {
            const m = row.machine_name;
            if (!m) continue;
            if (!effUpdates[m]) effUpdates[m] = {};

            const utcHour = new Date(row.time).getUTCHours();
            let thHour = (utcHour + 7) % 24;
            let thColumn = thHour.toString().padStart(2, '0');
            
            const output_count = row.output_count || 0;
            const avg_cycle_time = row.avg_cycle_time || 0;
            
            // Calculate theoretical max and efficiency
            const theoreticalMax = avg_cycle_time > 0 ? 3600 / avg_cycle_time : 0;
            const efficiency = theoreticalMax > 0 ? (output_count / theoreticalMax) * 100 : 0;

            effUpdates[m][`eff_${thColumn}`] = parseFloat(efficiency.toFixed(2));
            effUpdates[m][`_output_${thColumn}`] = output_count; // Temporary storage for weighted avg
            effUpdates[m][`_ct_weighted_${thColumn}`] = (avg_cycle_time * output_count);
        }

        console.log("Updating tb_efficiency_actual...");
        
        for (const machine of Object.keys(effUpdates)) {
            const effData = effUpdates[machine];
            
            let sumOutput = 0;
            let sumWeightedCT = 0;
            
            for (let i = 0; i < 24; i++) {
                const col = i.toString().padStart(2, '0');
                sumOutput += (effData[`_output_${col}`] || 0);
                sumWeightedCT += (effData[`_ct_weighted_${col}`] || 0);
                
                // Remove temporary keys before Prisma upsert
                delete effData[`_output_${col}`];
                delete effData[`_ct_weighted_${col}`];
            }
            
            const overallAvgCT = sumOutput > 0 ? (sumWeightedCT / sumOutput) : 0;
            const SHIFT_HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"];
            
            // Fetch target to know valid working hours
            const targetRow = await prisma.tb_output_target.findFirst({
                where: { machine_name: machine, date: targetDate }
            });
            
            let totalValidSeconds = 0;
            for (const h of SHIFT_HOURS) {
                const targetVal = targetRow ? (targetRow[`target_${h}`] || 0) : 0;
                if (targetVal > 0) {
                    totalValidSeconds += 3600;
                }
            }
            // For backfill, assume all 24 hours passed
            const overallTheoreticalMax = overallAvgCT > 0 ? totalValidSeconds / overallAvgCT : 0;
            const overallEff = overallTheoreticalMax > 0 ? (sumOutput / overallTheoreticalMax) * 100 : 0;

            effData.eff_actual = parseFloat(overallEff.toFixed(2));
            
            try {
                await prisma.tb_efficiency_actual.upsert({
                    where: { machine_name_date: { machine_name: machine, date: targetDate } },
                    update: effData,
                    create: { machine_name: machine, date: targetDate, ...effData }
                });
                console.log(`Updated ${machine} - Overall Eff: ${effData.eff_actual}%`);
            } catch (err) {
                console.error(`Error updating ${machine}: ${err.message}`);
            }
        }

        console.log("Efficiency updates completed successfully.");
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
run();

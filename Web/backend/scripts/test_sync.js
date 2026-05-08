const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function run() {
    try {
        console.log("Preparing to sync 10th Hourly Data to MSSQL tb_output_actual...");
        
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
            SELECT count("cycle_time"), mean("cycle_time") 
            FROM "data_tb" 
            WHERE time >= '2026-03-10T00:00:00Z' AND time <= '2026-03-10T23:59:59Z' 
            GROUP BY "machine_name", time(1h)
        `;
        const results = await influxClient.query(query);

        // Group by machine
        const machineUpdates = {};
        const cycleTimeUpdates = {};
        
        for (const row of results) {
            const m = row.machine_name;
            if (!m) continue;
            if (!machineUpdates[m]) machineUpdates[m] = {};
            if (!cycleTimeUpdates[m]) cycleTimeUpdates[m] = {};

            const utcHour = new Date(row.time).getUTCHours();
            
            // utcHourToThColumn logic (UTC+7 -> 07, 08... 00, 01... 06)
            let thHour = (utcHour + 7) % 24;
            let thColumn = thHour.toString().padStart(2, '0');
            
            machineUpdates[m][`actual_${thColumn}`] = row.count || 0;
            cycleTimeUpdates[m][`cycle_${thColumn}`] = parseFloat((row.mean || 0).toFixed(2));
        }

        console.log("Updating tb_output_actual and tb_cycle_time_actual...");
        
        for (const machine of Object.keys(machineUpdates)) {
            const dataToUpdate = machineUpdates[machine];
            const sumOverall = Object.values(dataToUpdate).reduce((a, b) => a + b, 0);
            dataToUpdate.Overall = sumOverall;
            
            try {
                await prisma.tb_output_actual.upsert({
                    where: { machine_name_date: { machine_name: machine, date: targetDate } },
                    update: dataToUpdate,
                    create: { machine_name: machine, date: targetDate, ...dataToUpdate }
                });

                const ctData = cycleTimeUpdates[machine];
                let avgCycleTime = 0;
                let totalRecords = 0;
                let totalWeightedCT = 0;
                
                for (let i = 0; i < 24; i++) {
                    const col = i.toString().padStart(2, '0');
                    const hourOutput = machineUpdates[machine][`actual_${col}`] || 0;
                    const hourCT = ctData[`cycle_${col}`] || 0;
                    if (hourOutput > 0 && hourCT > 0) {
                        totalRecords += hourOutput;
                        totalWeightedCT += (hourOutput * hourCT);
                    }
                }
                if (totalRecords > 0) {
                    avgCycleTime = totalWeightedCT / totalRecords;
                }
                ctData.cycle_time = parseFloat(avgCycleTime.toFixed(2));

                await prisma.tb_cycle_time_actual.upsert({
                    where: { machine_name_date: { machine_name: machine, date: targetDate } },
                    update: ctData,
                    create: { machine_name: machine, date: targetDate, ...ctData }
                });
                console.log(`Updated ${machine} - Overall Output: ${sumOverall}, Avg CT: ${avgCycleTime.toFixed(2)}`);
            } catch (err) {
                console.error(`Error updating ${machine}: ${err.message}`);
            }
        }

        console.log("Updates completed successfully.");
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
run();

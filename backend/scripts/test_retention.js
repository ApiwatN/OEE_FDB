const Influx = require('influx');
require('dotenv').config();

const influxClient = new Influx.InfluxDB({
    host: process.env.INFLUX_HOST || "192.168.100.99",
    port: parseInt(process.env.INFLUX_PORT || "5012", 10),
    database: process.env.INFLUX_DATABASE || "machine_db",
});

async function run() {
    try {
        console.log("Checking oldest record in InfluxDB...");
        
        const queryOldest = `
            SELECT first("cycle_time") 
            FROM "data_tb"
        `;
        const resultOldest = await influxClient.query(queryOldest);
        
        if (resultOldest.length > 0) {
            const oldestTime = new Date(resultOldest[0].time);
            const now = new Date();
            
            const diffTime = Math.abs(now - oldestTime);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            
            console.log("Oldest Record Time (UTC):", oldestTime.toISOString());
            console.log("Oldest Record Time (Local):", oldestTime.toLocaleString());
            console.log(`\n=> InfluxDB currently holds approximately ${diffDays} days of historical data.`);
        } else {
            console.log("No data found in InfluxDB.");
        }
        
        console.log("\nChecking total count of records...");
        const queryCount = `SELECT count("cycle_time") FROM "data_tb"`;
        const resultCount = await influxClient.query(queryCount);
        if (resultCount.length > 0) {
            console.log("Total records in database:", resultCount[0].count);
        }
    } catch (e) {
        console.error(e);
    }
}

run();

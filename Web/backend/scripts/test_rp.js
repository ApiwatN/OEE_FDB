const Influx = require('influx');
require('dotenv').config();

const influxClient = new Influx.InfluxDB({
    host: process.env.INFLUX_HOST || "192.168.100.99",
    port: parseInt(process.env.INFLUX_PORT || "5012", 10),
    database: process.env.INFLUX_DATABASE || "machine_db",
});

async function run() {
    try {
        console.log("Checking InfluxDB Retention Policies...");
        
        // InfluxDB 1.x Query to show retention policies
        const queryRP = `SHOW RETENTION POLICIES ON "machine_db"`;
        const resultRP = await influxClient.query(queryRP);
        
        console.log(JSON.stringify(resultRP, null, 2));

    } catch (e) {
        console.error("Error retrieving policies:", e.message);
    }
}

run();

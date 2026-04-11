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
        console.log("Querying InfluxDB for UTC 2026-03-14 (Local 14 07:00 to 15 07:00) ...");
        const data = {};

        // Hourly counts for UTC 14th
        const query14_hourly = `
            SELECT count("cycle_time") 
            FROM "data_tb" 
            WHERE time >= '2026-03-14T00:00:00Z' AND time <= '2026-03-14T23:59:59Z' 
            GROUP BY time(1h)
        `;
        data.hourly_utc_14 = await influxClient.query(query14_hourly);

        // Machine counts for UTC 14th
        const query14_machine = `
            SELECT count("cycle_time") 
            FROM "data_tb" 
            WHERE time >= '2026-03-14T00:00:00Z' AND time <= '2026-03-14T23:59:59Z' 
            GROUP BY "machine_name"
        `;
        data.machine_utc_14 = await influxClient.query(query14_machine);

        fs.writeFileSync('influx_results_14_utc.json', JSON.stringify(data, null, 2));
        console.log("Results written to influx_results_14_utc.json");
    } catch (e) {
        console.error(e);
    }
}
run();

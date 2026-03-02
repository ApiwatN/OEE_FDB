/**
 * InfluxDB 1.x Service
 * เชื่อมต่อ InfluxDB และ query ข้อมูลเครื่องจักร
 */
require("dotenv").config();
const Influx = require("influx");

let influxClient = null;

/**
 * Initialize InfluxDB 1.x client
 */
function initClient() {
    const host = process.env.INFLUX_HOST || "192.168.100.99";
    const port = parseInt(process.env.INFLUX_PORT || "5012", 10);
    const database = process.env.INFLUX_DATABASE || "machine_db";

    influxClient = new Influx.InfluxDB({
        host,
        port,
        database,
    });

    console.log(`✅ InfluxDB client initialized: ${host}:${port}/${database}`);
    return influxClient;
}

/**
 * Get the client instance
 */
function getClient() {
    if (!influxClient) {
        throw new Error("InfluxDB client not initialized. Call initClient() first.");
    }
    return influxClient;
}

/**
 * Test connection to InfluxDB
 */
async function testConnection() {
    try {
        const client = getClient();
        const names = await client.getDatabaseNames();
        console.log("✅ InfluxDB connected. Databases:", names);
        return true;
    } catch (err) {
        console.error("❌ InfluxDB connection failed:", err.message);
        return false;
    }
}

/**
 * Query all machines for a specific hour range
 * Returns: { "MACHINE_NAME": { output_count: N, avg_cycle_time: N } }
 */
async function queryAllMachinesForHour(startUTC, endUTC) {
    const client = getClient();
    const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";

    const startISO = startUTC instanceof Date ? startUTC.toISOString() : startUTC;
    const endISO = endUTC instanceof Date ? endUTC.toISOString() : endUTC;

    const query = `
        SELECT COUNT("cycle_time") AS "output_count",
               MEAN("cycle_time") AS "avg_cycle_time"
        FROM "${measurement}"
        WHERE time >= '${startISO}' AND time < '${endISO}'
        GROUP BY "machine_name"
    `;

    try {
        const results = await client.query(query);
        const machineData = {};

        for (const row of results) {
            const machineName = row.machine_name || row.tags?.machine_name;
            if (machineName) {
                machineData[machineName] = {
                    output_count: row.output_count || 0,
                    avg_cycle_time: row.avg_cycle_time || 0,
                };
            }
        }

        return machineData;
    } catch (err) {
        console.error("❌ InfluxDB query error:", err.message);
        return {};
    }
}

/**
 * Query a single machine for a specific hour range
 */
async function queryMachineForHour(machineName, startUTC, endUTC) {
    const client = getClient();
    const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";

    const startISO = startUTC instanceof Date ? startUTC.toISOString() : startUTC;
    const endISO = endUTC instanceof Date ? endUTC.toISOString() : endUTC;

    const query = `
        SELECT COUNT("cycle_time") AS "output_count",
               MEAN("cycle_time") AS "avg_cycle_time"
        FROM "${measurement}"
        WHERE "machine_name" = '${machineName}'
        AND time >= '${startISO}' AND time < '${endISO}'
    `;

    try {
        const results = await client.query(query);
        if (results.length > 0) {
            return {
                output_count: results[0].output_count || 0,
                avg_cycle_time: results[0].avg_cycle_time || 0,
            };
        }
        return { output_count: 0, avg_cycle_time: 0 };
    } catch (err) {
        console.error(`❌ InfluxDB query error for ${machineName}:`, err.message);
        return { output_count: 0, avg_cycle_time: 0 };
    }
}

/**
 * Query multiple hours for late data detection
 * Returns: { "MACHINE_NAME": { "YYYY-MM-DDTHH": { output_count, avg_cycle_time } } }
 */
async function queryHoursRange(startUTC, endUTC) {
    const client = getClient();
    const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";

    const startISO = startUTC instanceof Date ? startUTC.toISOString() : startUTC;
    const endISO = endUTC instanceof Date ? endUTC.toISOString() : endUTC;

    const query = `
        SELECT COUNT("cycle_time") AS "output_count",
               MEAN("cycle_time") AS "avg_cycle_time"
        FROM "${measurement}"
        WHERE time >= '${startISO}' AND time < '${endISO}'
        GROUP BY "machine_name", time(1h)
    `;

    try {
        const results = await client.query(query);
        const machineHourData = {};

        for (const row of results) {
            const machineName = row.machine_name || row.tags?.machine_name;
            if (!machineName) continue;

            if (!machineHourData[machineName]) machineHourData[machineName] = {};

            const hourKey = new Date(row.time).toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
            machineHourData[machineName][hourKey] = {
                output_count: row.output_count || 0,
                avg_cycle_time: row.avg_cycle_time || 0,
            };
        }

        return machineHourData;
    } catch (err) {
        console.error("❌ InfluxDB range query error:", err.message);
        return {};
    }
}

/**
 * Count NG records for a single machine (judg_result contains "NG")
 */
async function queryNgCount(machineName, startUTC, endUTC) {
    const client = getClient();
    const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";
    const startISO = startUTC instanceof Date ? startUTC.toISOString() : startUTC;
    const endISO = endUTC instanceof Date ? endUTC.toISOString() : endUTC;

    const query = `
        SELECT COUNT("cycle_time") AS "ng_count"
        FROM "${measurement}"
        WHERE "machine_name" = '${machineName}'
        AND "judg_result" =~ /NG/
        AND time >= '${startISO}' AND time < '${endISO}'
    `;
    try {
        const results = await client.query(query);
        return results.length > 0 ? (results[0].ng_count || 0) : 0;
    } catch (err) {
        console.error(`❌ InfluxDB NG query error for ${machineName}:`, err.message);
        return 0;
    }
}

/**
 * Count NG records for ALL machines (judg_result contains "NG")
 * Returns: { "MACHINE_NAME": ng_count }
 */
async function queryAllMachinesNgCount(startUTC, endUTC) {
    const client = getClient();
    const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";
    const startISO = startUTC instanceof Date ? startUTC.toISOString() : startUTC;
    const endISO = endUTC instanceof Date ? endUTC.toISOString() : endUTC;

    const query = `
        SELECT COUNT("cycle_time") AS "ng_count"
        FROM "${measurement}"
        WHERE "judg_result" =~ /NG/
        AND time >= '${startISO}' AND time < '${endISO}'
        GROUP BY "machine_name"
    `;
    try {
        const results = await client.query(query);
        const data = {};
        for (const row of results) {
            const mn = row.machine_name || row.tags?.machine_name;
            if (mn) data[mn] = row.ng_count || 0;
        }
        return data;
    } catch (err) {
        console.error("❌ InfluxDB all-machines NG query error:", err.message);
        return {};
    }
}

/**
 * Query distinct actual Models for a machine in a time range
 * Note: "Model" is a FIELD (not tag) in InfluxDB, so we use DISTINCT()
 * Returns: [{ model_name: "Longspeak10D" }, ...]
 */
async function queryActualModels(machineName, startUTC, endUTC) {
    const client = getClient();
    const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";
    const startISO = startUTC instanceof Date ? startUTC.toISOString() : startUTC;
    const endISO = endUTC instanceof Date ? endUTC.toISOString() : endUTC;

    const query = `
        SELECT DISTINCT("Model") AS "model_name"
        FROM "${measurement}"
        WHERE "machine_name" = '${machineName}'
        AND time >= '${startISO}' AND time < '${endISO}'
    `;

    try {
        const results = await client.query(query);
        const models = [];
        for (const row of results) {
            const modelName = row.distinct || row.model_name;
            if (modelName) {
                models.push({ model_name: modelName });
            }
        }
        return models;
    } catch (err) {
        console.error(`❌ InfluxDB queryActualModels error for ${machineName}:`, err.message);
        return [];
    }
}

/**
 * Query all machines' last Model for a specific hour range
 * Note: "Model" is a FIELD, "machine_name" is a TAG
 * Returns: { "MACHINE_NAME": "ModelName" } (last model per machine in range)
 */
async function queryAllMachinesModelsForHour(startUTC, endUTC) {
    const client = getClient();
    const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";
    const startISO = startUTC instanceof Date ? startUTC.toISOString() : startUTC;
    const endISO = endUTC instanceof Date ? endUTC.toISOString() : endUTC;

    const query = `
        SELECT LAST("Model") AS "model_name"
        FROM "${measurement}"
        WHERE time >= '${startISO}' AND time < '${endISO}'
        GROUP BY "machine_name"
    `;

    try {
        const results = await client.query(query);
        const result = {};
        for (const row of results) {
            const machineName = row.machine_name || row.tags?.machine_name;
            const modelName = row.last || row.model_name;
            if (machineName && modelName) {
                result[machineName] = modelName;
            }
        }
        return result;
    } catch (err) {
        console.error("❌ InfluxDB queryAllMachinesModelsForHour error:", err.message);
        return {};
    }
}

module.exports = {
    initClient,
    getClient,
    testConnection,
    queryAllMachinesForHour,
    queryMachineForHour,
    queryHoursRange,
    queryNgCount,
    queryAllMachinesNgCount,
    queryActualModels,
    queryAllMachinesModelsForHour,
};

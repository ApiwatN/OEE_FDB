require("dotenv").config();
const { initClient } = require("./services/influxService");
const { hydrateFromMSSQL } = require("./services/cacheService");
const {
    backfillStartup,
    backfillOeeStartup,
    backfillNgStartup,
} = require("./services/cronService");

async function run() {
    console.log("Starting backfill for all tables (last 5 days) as requested...");
    try {
        initClient();
        await hydrateFromMSSQL();

        console.log("--- 1. Backfilling Output, CT, EFF ---");
        await backfillStartup();

        console.log("--- 2. Backfilling NG Data ---");
        await backfillNgStartup();

        console.log("--- 3. Backfilling OEE Data ---");
        await backfillOeeStartup();

        console.log("✅ Backfill complete!");
    } catch (e) {
        console.error("Backfill error:", e);
    } finally {
        process.exit(0);
    }
}
run();

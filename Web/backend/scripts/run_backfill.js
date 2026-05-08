require("dotenv").config();
const { initClient } = require("../services/influxService");
const { hydrateFromMSSQL } = require("../services/cacheService");
const {
    backfillStartup,
    backfillOeeStartup,
    backfillNgStartup,
    backfillEventsStartup
} = require("../services/cronService");

async function run() {
    // Check if user passed a custom day count, default to 5
    const args = process.argv.slice(2);
    const daysStr = args[0];
    const days = daysStr ? parseInt(daysStr, 10) : 5;

    console.log(`🚀 Starting manual backfill for all tables (last ${days} days) as requested...`);
    try {
        initClient();
        console.log("--- 0. Hydrating Cache ---");
        await hydrateFromMSSQL();

        console.log("--- 1. Backfilling Output, CT, EFF ---");
        await backfillStartup(days);

        console.log("--- 2. Backfilling NG Data ---");
        await backfillNgStartup(days);

        console.log("--- 3. Backfilling OEE Data ---");
        await backfillOeeStartup(days);

        console.log("--- 4. Backfilling Events (MC Status & MC Alarm) ---");
        await backfillEventsStartup(days);

        console.log(`✅ Backfill complete for the last ${days} days!`);
    } catch (e) {
        console.error("❌ Backfill error:", e);
    } finally {
        process.exit(0);
    }
}

run();

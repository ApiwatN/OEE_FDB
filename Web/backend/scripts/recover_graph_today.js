const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getShiftDateUTC, getCurrentHourBoundaries } = require('../utils/timeUtils');

async function main() {
    console.log("🚀 Starting One-time Recovery for Today's Graph...");
    try {
        const influxService = require('../services/influxService');
        influxService.initClient();
        
        // We will call the same cronService logic but manually triggered.
        const cronService = require('../services/cronService');

        // First, explicitly trigger syncEventsFromInfluxDb for the last 12 hours
        const now = new Date();
        const eventStartCutoff = new Date(now.getTime() - (12 * 60 * 60 * 1000));
        
        console.log(`1. Syncing lost MQTT events from InfluxDB into MSSQL (from ${eventStartCutoff.toISOString()} to ${now.toISOString()})...`);
        const recovered = await cronService.syncEventsFromInfluxDb(eventStartCutoff, now);
        
        console.log("Recovered status:", recovered);

        console.log(`2. Recalculating Runtime and Availability for the past 12 hours...`);
        // Find all active machines
        const activeMachinesRaw = await prisma.tbm_machine.findMany({ where: { status: 'active' }, select: { machine_name: true } });
        const activeMachines = activeMachinesRaw.map(m => m.machine_name);
        
        const { getMachineRunTimeMode } = require('../services/oeeCalcService');
        const statusMachines = activeMachines.filter(m => getMachineRunTimeMode(m) !== "output_based");
        
        for (let h = 1; h <= 12; h++) {
            const pastDate = new Date(now.getTime() - (h * 60 * 60 * 1000));
            const { dateStr, thColumn, start, end } = getCurrentHourBoundaries(pastDate);
            const targetDateObj = new Date(dateStr + "T00:00:00.000Z");
            
            console.log(`   👉 Upserting Hour ${thColumn} (Date: ${dateStr})...`);
            await cronService.upsertRuntimeAndAvailabilityForHour(thColumn, start, end, targetDateObj, statusMachines);
        }
        
        console.log("✅ Recovery complete! You can reload the web dashboard now.");
    } catch (e) {
        console.error("❌ Recovery Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();

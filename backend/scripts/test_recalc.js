const { recalculateAPQForDay } = require('./services/oeeBackfillService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Recalculating OEE for 2026-03-14...");
        const targetDate = new Date('2026-03-14T00:00:00.000Z');
        
        const machines = await prisma.tbm_machine.findMany({ select: { machine_name: true } });
        
        for (const m of machines) {
            console.log(`Processing ${m.machine_name}...`);
            await recalculateAPQForDay(m.machine_name, targetDate);
        }
        
        console.log("OEE Recalculation Complete.");
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();

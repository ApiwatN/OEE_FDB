require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixABR() {
    try {
        console.log('--- Shifting ABR timestamps +7 hours in tb_MCStatus and tb_MCAlarm ---');
        
        // Add 7 hours ONLY to records that are logically UTC.
        // The last UTC record we know of was today at ~05:00 UTC. 
        // If it's already > 06:00:00 (which would mean 13:00 local time), it might already be processed by our new code.
        // So we strictly limit the fix to records before '2026-04-11 06:00:00'.
        
        const countStatus = await prisma.$executeRawUnsafe(`UPDATE tb_MCStatus SET Datetime = DATEADD(hour, 7, Datetime) WHERE MC LIKE 'ABR%' AND Datetime < '2026-04-11 06:00:00'`);
        console.log('Fixed tb_MCStatus ABR rows:', countStatus);

        const countAlarm = await prisma.$executeRawUnsafe(`UPDATE tb_MCAlarm SET Datetime = DATEADD(hour, 7, Datetime) WHERE MC LIKE 'ABR%' AND Datetime < '2026-04-11 06:00:00'`);
        console.log('Fixed tb_MCAlarm ABR rows:', countAlarm);
        
    } catch(e) {
        console.error('Error:', e.message);
    } finally {
        process.exit(0);
    }
}
fixABR();

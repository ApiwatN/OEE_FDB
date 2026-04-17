const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
    console.log("--- Fixing historical ABR timestamps in tb_MCStatus and tb_MCAlarm ---");
    
    try {
        // Fix tb_MCStatus
        console.log("Step 1: Storing original mistaken Datetime (which is UTC) to UTC_Time for ABR machines...");
        const statusUtcUpdate = await prisma.$executeRawUnsafe(`
            UPDATE tb_MCStatus 
            SET UTC_Time = Datetime 
            WHERE MC LIKE 'ABR%' AND UTC_Time IS NULL
        `);
        console.log(`Updated UTC_Time in tb_MCStatus: ${statusUtcUpdate} rows.`);

        console.log("Step 2: Shifting Local Datetime +7 hours for ABR machines in tb_MCStatus...");
        const statusHourUpdate = await prisma.$executeRawUnsafe(`
            UPDATE tb_MCStatus 
            SET Datetime = DATEADD(hour, 7, Datetime) 
            WHERE MC LIKE 'ABR%' AND Datetime = UTC_Time
        `);
        console.log(`Shifted Datetime +7 hours in tb_MCStatus: ${statusHourUpdate} rows.`);

        // Fix tb_MCAlarm
        console.log("Step 3: Storing original mistaken Datetime (which is UTC) to UTC_Time for ABR machines in tb_MCAlarm...");
        const alarmUtcUpdate = await prisma.$executeRawUnsafe(`
            UPDATE tb_MCAlarm 
            SET UTC_Time = Datetime 
            WHERE MC LIKE 'ABR%' AND UTC_Time IS NULL
        `);
        console.log(`Updated UTC_Time in tb_MCAlarm: ${alarmUtcUpdate} rows.`);

        console.log("Step 4: Shifting Local Datetime +7 hours for ABR machines in tb_MCAlarm...");
        const alarmHourUpdate = await prisma.$executeRawUnsafe(`
            UPDATE tb_MCAlarm 
            SET Datetime = DATEADD(hour, 7, Datetime) 
            WHERE MC LIKE 'ABR%' AND Datetime = UTC_Time
        `);
        console.log(`Shifted Datetime +7 hours in tb_MCAlarm: ${alarmHourUpdate} rows.`);

        console.log("✅ Successfully migrated ABR historical data.");
    } catch (e) {
        console.error("❌ Migration failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

run();

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    console.log("Checking history for AHV-001...");

    // 1. Get ANY active sessions (end_time: null)
    const active = await prisma.tb_history_working.findMany({
        where: {
            machine_name: "AHV-001",
            end_time: null
        }
    });

    console.log("--- Active Sessions (end_time: null) ---");
    if (active.length === 0) {
        console.log("No active sessions found. All clear.");
    } else {
        console.table(active);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });

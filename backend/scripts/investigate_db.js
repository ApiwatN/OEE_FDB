const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    console.log("Checking DB Connection and Data...");

    // 1. List all machines to verify names
    const machines = await prisma.tbm_machine.findMany({
        take: 5
    });
    console.log("--- First 5 Machines ---");
    console.table(machines);

    // 2. Count history records
    const count = await prisma.tb_history_working.count();
    console.log(`--- Total History Records: ${count} ---`);

    // 3. Get ANY history record
    const validHistory = await prisma.tb_history_working.findFirst();
    if (validHistory) {
        console.log("--- Sample History Record ---");
        console.log(validHistory);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });

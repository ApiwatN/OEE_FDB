const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    console.log("Searching for machines with 'AHV'...");

    const machines = await prisma.tbm_machine.findMany({
        where: {
            machine_name: {
                contains: "AHV"
            }
        }
    });

    console.table(machines);

    if (machines.length > 0) {
        const name = machines[0].machine_name;
        console.log(`Checking history for correct name: ${name}`);

        const history = await prisma.tb_history_working.findMany({
            where: { machine_name: name },
            orderBy: { id: "desc" }, // Descending to see latest
            take: 5
        });
        console.table(history);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const machines = await prisma.tbm_machine.findMany({
        where: {
            machine_area: 'CLASS100'
        },
        orderBy: {
            machine_name: 'asc'
        }
    });

    console.log('Total machines in CLASS100:', machines.length);
    machines.forEach(m => console.log(m.machine_name));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const ge3Machines = await prisma.tbm_machine.findMany({
        where: {
            machine_name: {
                startsWith: 'GE3'
            }
        },
        orderBy: {
            machine_name: 'asc'
        }
    });

    console.log('Found GE3 machines:', ge3Machines.length);
    ge3Machines.forEach(m => console.log(m.machine_name));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());

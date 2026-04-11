
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkMachines() {
    try {
        const machines = await prisma.tbm_machine.findMany({
            where: {
                OR: [
                    { machine_name: { startsWith: 'ARA' } },
                    { machine_name: { startsWith: 'ART' } }
                ]
            },
            select: { machine_name: true }
        });

        console.log('Found machines:', machines.map(m => m.machine_name).sort());
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkMachines();

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkATX() {
    try {
        const machines = await prisma.tbm_machine.findMany({
            where: {
                machine_name: { startsWith: 'ATX' }
            },
            select: { machine_name: true, machine_area: true }
        });

        if (machines.length > 0) {
            console.log('✅ Found ATX machines:', machines);
        } else {
            console.log('❌ No ATX machines found in database');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkATX();

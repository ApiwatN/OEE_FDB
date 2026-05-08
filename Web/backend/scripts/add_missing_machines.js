const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAndAddMachines() {
    try {
        // Machines to check and add if missing
        const machines = [
            { machine_name: 'ATX-001', machine_area: 'CLASS100', machine_type: 'ATX' },
            { machine_name: 'LSM-005', machine_area: 'CLASS100', machine_type: 'LSM' },
            { machine_name: 'LSW-021', machine_area: 'CLASS100', machine_type: 'LSW' },
            { machine_name: 'VNS-011', machine_area: 'CLASS100', machine_type: 'VNS' }
        ];

        for (const machine of machines) {
            // Check if already exists
            const existing = await prisma.tbm_machine.findFirst({
                where: { machine_name: machine.machine_name }
            });

            if (existing) {
                console.log(`✅ ${machine.machine_name} already exists`);
            } else {
                await prisma.tbm_machine.create({
                    data: {
                        machine_name: machine.machine_name,
                        machine_area: machine.machine_area,
                        machine_type: machine.machine_type,
                        status: 'active'
                    }
                });
                console.log(`➕ Added ${machine.machine_name}`);
            }
        }

        console.log('\n--- Done! ---');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkAndAddMachines();

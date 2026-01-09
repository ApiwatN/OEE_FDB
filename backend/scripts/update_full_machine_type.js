// Script to update full_machine_type based on machine_type
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Mapping from machine_type to full_machine_type (based on provided image)
const machineTypeMapping = {
    'AOC': 'Auto Oil Clean Machine',
    'AIU': 'Auto Install Shaft to Sleeve ',
    'ACP': 'Auto Install Counterplate to Sleeve Assy',
    'AFU': 'Assy Line Auto FDB Unit',
    'ARA': 'Auto Rotor Assy Line ',
    'LSW': 'Laser Welding Machine',
    'LSM': 'Laser Marking Machine',
    'HEL': 'Auto Helium Leak Tester',
    'GE2': 'Oil Fill Machine',
    'GE3': 'Oil Fill Machine',
    'ATX': 'Auto Axial Play Inspection',
    'VNS': 'Oil Level Tester',
    'ART': 'Auto TIR Machine',
    'DLC': 'Sputtering Machine',
    'Chydos': 'Washing Machine',  // Chiyoda in image
    'VCM': 'Auto visual Inspection Cone FCC',
    'AQS': 'Auto ECM Machine',
    'ACR': 'Auto ECM Machine',
    'AHV': 'Auto Visual Inspection Machine',
    'AVE': 'Auto Visual ECM Groove Machine',
    'WTM': 'Washing Machine',
    'ASI': 'Auto Press Shaft Thrust Washer',
    'ACI': 'Auto Load Counter Plate',
    'WSM': 'Washing Machine',
    'ABR': 'Auto Apply Barrier Film to Sleeve',
    // Types not in image - use same name
    'FSPZ': 'FSPZ',
    'STC': 'STC'
};

async function updateFullMachineType() {
    try {
        console.log('Starting update of full_machine_type...\n');

        for (const [machineType, fullName] of Object.entries(machineTypeMapping)) {
            const result = await prisma.tbm_machine.updateMany({
                where: { machine_type: machineType },
                data: { full_machine_type: fullName }
            });

            if (result.count > 0) {
                console.log(`✅ Updated ${result.count} record(s) for ${machineType} -> "${fullName}"`);
            } else {
                console.log(`⚠️  No records found for ${machineType}`);
            }
        }

        console.log('\n✅ Update completed successfully!');

        // Show summary
        const machines = await prisma.tbm_machine.findMany({
            select: { machine_type: true, full_machine_type: true },
            distinct: ['machine_type'],
            orderBy: { machine_type: 'asc' }
        });

        console.log('\n--- Summary ---');
        console.table(machines);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

updateFullMachineType();

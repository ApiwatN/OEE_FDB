const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const machines = [
    // ==================== DLC Area (13 เครื่อง) ====================
    { machine_area: 'DLC', machine_type: 'Chydos', machine_name: 'Chydos1' },
    { machine_area: 'DLC', machine_type: 'Chydos', machine_name: 'Chydos2' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-002' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-003' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-004' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-005' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-006' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-007' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-008' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-009' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-010' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-011' },
    { machine_area: 'DLC', machine_type: 'DLC', machine_name: 'DLC-012' },

    // ==================== ECM Area (16 เครื่อง) ====================
    { machine_area: 'ECM', machine_type: 'ACR', machine_name: 'ACR-001' },
    { machine_area: 'ECM', machine_type: 'ACR', machine_name: 'ACR-002' },
    { machine_area: 'ECM', machine_type: 'ACR', machine_name: 'ACR-003' },
    { machine_area: 'ECM', machine_type: 'ACR', machine_name: 'ACR-004' },
    { machine_area: 'ECM', machine_type: 'ACR', machine_name: 'ACR-005' },
    { machine_area: 'ECM', machine_type: 'ACR', machine_name: 'ACR-006' },
    { machine_area: 'ECM', machine_type: 'AHV', machine_name: 'AHV-001' },
    { machine_area: 'ECM', machine_type: 'AHV', machine_name: 'AHV-002' },
    { machine_area: 'ECM', machine_type: 'AHV', machine_name: 'AHV-003' },
    { machine_area: 'ECM', machine_type: 'AHV', machine_name: 'AHV-004' },
    { machine_area: 'ECM', machine_type: 'AHV', machine_name: 'AHV-005' },
    { machine_area: 'ECM', machine_type: 'AHV', machine_name: 'AHV-006' },
    { machine_area: 'ECM', machine_type: 'AQS', machine_name: 'AQS-009' },
    { machine_area: 'ECM', machine_type: 'AVE', machine_name: 'AVE-001' },
    { machine_area: 'ECM', machine_type: 'WTM', machine_name: 'WTM-001' },
    { machine_area: 'ECM', machine_type: 'WTM', machine_name: 'WTM-002' },

    // ==================== CLASS100 Area ====================
    // ABR (6 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'ABR', machine_name: 'ABR-001' },
    { machine_area: 'CLASS100', machine_type: 'ABR', machine_name: 'ABR-002' },
    { machine_area: 'CLASS100', machine_type: 'ABR', machine_name: 'ABR-003' },
    { machine_area: 'CLASS100', machine_type: 'ABR', machine_name: 'ABR-004' },
    { machine_area: 'CLASS100', machine_type: 'ABR', machine_name: 'ABR-005' },
    { machine_area: 'CLASS100', machine_type: 'ABR', machine_name: 'ABR-006' },

    // ACP (11 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-002' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-003' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-004' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-005' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-006' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-007' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-008' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-009' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-010' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-011' },
    { machine_area: 'CLASS100', machine_type: 'ACP', machine_name: 'ACP-012' },

    // AIU (2 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'AIU', machine_name: 'AIU-001' },
    { machine_area: 'CLASS100', machine_type: 'AIU', machine_name: 'AIU-002' },

    // AOC (7 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'AOC', machine_name: 'AOC-001' },
    { machine_area: 'CLASS100', machine_type: 'AOC', machine_name: 'AOC-002' },
    { machine_area: 'CLASS100', machine_type: 'AOC', machine_name: 'AOC-003' },
    { machine_area: 'CLASS100', machine_type: 'AOC', machine_name: 'AOC-004' },
    { machine_area: 'CLASS100', machine_type: 'AOC', machine_name: 'AOC-005' },
    { machine_area: 'CLASS100', machine_type: 'AOC', machine_name: 'AOC-006' },
    { machine_area: 'CLASS100', machine_type: 'AOC', machine_name: 'AOC-007' },

    // AFU (3 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'AFU', machine_name: 'AFU-002' },
    { machine_area: 'CLASS100', machine_type: 'AFU', machine_name: 'AFU-003' },
    { machine_area: 'CLASS100', machine_type: 'AFU', machine_name: 'AFU-004' },

    // ARA (1 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'ARA', machine_name: 'ARA-001' },

    // ART (11 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-002' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-004' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-006' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-009' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-010' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-011' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-013' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-015' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-016' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-018' },
    { machine_area: 'CLASS100', machine_type: 'ART', machine_name: 'ART-021' },

    // ATX (3 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'ATX', machine_name: 'ATX-002' },
    { machine_area: 'CLASS100', machine_type: 'ATX', machine_name: 'ATX-003' },
    { machine_area: 'CLASS100', machine_type: 'ATX', machine_name: 'ATX-004' },

    // STC (1 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'STC', machine_name: 'STC-001' },

    // FSPZ (1 เครื่อง - ไม่มี "-")
    { machine_area: 'CLASS100', machine_type: 'FSPZ', machine_name: 'FSPZ' },

    // GE2 (29 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-001' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-002' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-003' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-004' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-005' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-006' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-007' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-008' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-009' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-010' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-011' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-012' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-013' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-014' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-015' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-016' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-017' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-018' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-019' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-020' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-021' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-022' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-033' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-034' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-035' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-036' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-038' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-039' },
    { machine_area: 'CLASS100', machine_type: 'GE2', machine_name: 'GE2-040' },

    // GE3 (6 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'GE3', machine_name: 'GE3-001' },
    { machine_area: 'CLASS100', machine_type: 'GE3', machine_name: 'GE3-003' },
    { machine_area: 'CLASS100', machine_type: 'GE3', machine_name: 'GE3-007' },
    { machine_area: 'CLASS100', machine_type: 'GE3', machine_name: 'GE3-008' },
    { machine_area: 'CLASS100', machine_type: 'GE3', machine_name: 'GE3-009' },
    { machine_area: 'CLASS100', machine_type: 'GE3', machine_name: 'GE3-010' },

    // HEL (30 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-001' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-002' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-003' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-004' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-005' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-006' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-007' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-017' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-018' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-026' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-028' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-030' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-032' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-033' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-036' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-040' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-041' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-043' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-044' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-046' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-047' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-048' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-049' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-050' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-051' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-052' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-053' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-055' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-056' },
    { machine_area: 'CLASS100', machine_type: 'HEL', machine_name: 'HEL-057' },

    // LSM (2 เครื่อง ใน CLASS100)
    { machine_area: 'CLASS100', machine_type: 'LSM', machine_name: 'LSM-001' },
    { machine_area: 'CLASS100', machine_type: 'LSM', machine_name: 'LSM-002' },

    // LSW (21 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-001' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-002' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-003' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-004' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-005' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-006' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-009' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-017' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-019' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-024' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-025' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-026' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-027' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-028' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-029' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-030' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-031' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-032' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-033' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-034' },
    { machine_area: 'CLASS100', machine_type: 'LSW', machine_name: 'LSW-035' },

    // VNS (25 เครื่อง)
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-001' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-002' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-003' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-004' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-005' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-006' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-007' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-008' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-009' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-010' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-012' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-013' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-014' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-015' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-016' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-017' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-018' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-019' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-020' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-021' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-022' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-023' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-024' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-025' },
    { machine_area: 'CLASS100', machine_type: 'VNS', machine_name: 'VNS-026' },

    // ==================== CLASS1000 Area (13 เครื่อง) ====================
    { machine_area: 'CLASS1000', machine_type: 'ACI', machine_name: 'ACI-001' },
    { machine_area: 'CLASS1000', machine_type: 'ACI', machine_name: 'ACI-002' },
    { machine_area: 'CLASS1000', machine_type: 'ACI', machine_name: 'ACI-003' },
    { machine_area: 'CLASS1000', machine_type: 'ASI', machine_name: 'ASI-001' },
    { machine_area: 'CLASS1000', machine_type: 'ASI', machine_name: 'ASI-002' },
    { machine_area: 'CLASS1000', machine_type: 'ASI', machine_name: 'ASI-003' },
    { machine_area: 'CLASS1000', machine_type: 'LSM', machine_name: 'LSM-003' },
    { machine_area: 'CLASS1000', machine_type: 'LSM', machine_name: 'LSM-004' },
    { machine_area: 'CLASS1000', machine_type: 'LSM', machine_name: 'LSM-006' },
    { machine_area: 'CLASS1000', machine_type: 'WSM', machine_name: 'WSM-001' },
    { machine_area: 'CLASS1000', machine_type: 'WSM', machine_name: 'WSM-002' },
    { machine_area: 'CLASS1000', machine_type: 'VCM', machine_name: 'VCM-001' },
    { machine_area: 'CLASS1000', machine_type: 'VCM', machine_name: 'VCM-002' },
];

async function main() {
    console.log('Starting machine seed...');
    console.log(`Total machines to insert: ${machines.length}`);

    let inserted = 0;
    let skipped = 0;

    for (const machine of machines) {
        try {
            // Check if machine already exists
            const existing = await prisma.tbm_machine.findUnique({
                where: { machine_name: machine.machine_name }
            });

            if (existing) {
                console.log(`Skipped (exists): ${machine.machine_name}`);
                skipped++;
            } else {
                await prisma.tbm_machine.create({
                    data: {
                        machine_area: machine.machine_area,
                        machine_type: machine.machine_type,
                        machine_name: machine.machine_name,
                        status: 'active'
                    }
                });
                console.log(`Inserted: ${machine.machine_name}`);
                inserted++;
            }
        } catch (error) {
            console.error(`Error inserting ${machine.machine_name}:`, error.message);
        }
    }

    console.log('\n========== Summary ==========');
    console.log(`Total: ${machines.length}`);
    console.log(`Inserted: ${inserted}`);
    console.log(`Skipped: ${skipped}`);
    console.log('=============================');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const rawData = [
    // 4 values
    ["DLC", "Chydos", "Chydos1", "active"],
    ["DLC", "Chydos", "Chydos2", "active"],
    ["DLC", "DLC", "DLC-002", "active"],
    ["DLC", "DLC", "DLC-003", "active"],
    ["DLC", "DLC", "DLC-004", "active"],
    ["DLC", "DLC", "DLC-005", "active"],
    // 5 values (ID included, skipping index 0)
    ["DLC", "DLC", "DLC-006", "active"],
    ["DLC", "DLC", "DLC-007", "active"],
    ["DLC", "DLC", "DLC-008", "active"],
    ["DLC", "DLC", "DLC-009", "active"],
    ["DLC", "DLC", "DLC-010", "active"],
    ["DLC", "DLC", "DLC-011", "active"],
    ["DLC", "DLC", "DLC-012", "active"],
    ["ECM", "AQS", "AQS-009", "active"],
    ["ECM", "AVE", "AVE-001", "active"],
    ["ECM", "WTM", "WTM-001", "active"],
    ["ECM", "WTM", "WTM-002", "active"],
    ["CLASS100", "ABR", "ABR-001", "active"],
    ["CLASS100", "ABR", "ABR-002", "active"],
    ["CLASS100", "ABR", "ABR-003", "active"],
    ["CLASS100", "ABR", "ABR-004", "active"],
    ["CLASS100", "ABR", "ABR-005", "active"],
    ["CLASS100", "ABR", "ABR-006", "active"],
    ["CLASS100", "ACP", "ACP-002", "active"],
    ["CLASS100", "ACP", "ACP-003", "active"],
    ["CLASS100", "ACP", "ACP-004", "active"],
    ["CLASS100", "ACP", "ACP-005", "active"],
    ["CLASS100", "ACP", "ACP-006", "active"],
    ["CLASS100", "ACP", "ACP-007", "active"],
    ["CLASS100", "ACP", "ACP-008", "active"],
    ["CLASS100", "ACP", "ACP-009", "active"],
    ["CLASS100", "ACP", "ACP-010", "active"],
    ["CLASS100", "ACP", "ACP-011", "active"],
    ["CLASS100", "ACP", "ACP-012", "active"],
    ["CLASS100", "AIU", "AIU-001", "active"],
    ["CLASS100", "AIU", "AIU-002", "active"],
    ["CLASS100", "AOC", "AOC-001", "active"],
    ["CLASS100", "AOC", "AOC-002", "active"],
    ["CLASS100", "AOC", "AOC-003", "active"],
    ["CLASS100", "AOC", "AOC-004", "active"],
    ["CLASS100", "AOC", "AOC-005", "active"],
    ["CLASS100", "AOC", "AOC-006", "active"],
    ["CLASS100", "AOC", "AOC-007", "active"],
    ["CLASS100", "AFU", "AFU-002", "active"],
    ["CLASS100", "AFU", "AFU-003", "active"],
    ["CLASS100", "AFU", "AFU-004", "active"],
    ["CLASS100", "ARA", "ARA-001", "active"],
    ["CLASS100", "ART", "ART-002", "active"],
    ["CLASS100", "ART", "ART-004", "active"],
    ["CLASS100", "ART", "ART-006", "active"],
    ["CLASS100", "ART", "ART-009", "active"],
    ["CLASS100", "ART", "ART-010", "active"],
    ["CLASS100", "ART", "ART-011", "active"],
    ["CLASS100", "ART", "ART-013", "active"],
    ["CLASS100", "ART", "ART-015", "active"],
    ["CLASS100", "ART", "ART-016", "active"],
    ["CLASS100", "ART", "ART-018", "active"],
    ["CLASS100", "ART", "ART-021", "active"],
    ["CLASS100", "ATX", "ATX-002", "active"],
    ["CLASS100", "ATX", "ATX-003", "active"],
    ["CLASS100", "ATX", "ATX-004", "active"],
    ["CLASS100", "STC", "STC-001", "active"],
    ["CLASS100", "FSPZ", "FSPZ", "active"],
    ["CLASS100", "GE2", "GE2-001", "active"],
    ["CLASS100", "GE2", "GE2-002", "active"],
    ["CLASS100", "GE2", "GE2-003", "active"],
    ["CLASS100", "GE2", "GE2-004", "active"],
    ["CLASS100", "GE2", "GE2-005", "active"],
    ["CLASS100", "GE2", "GE2-006", "active"],
    ["CLASS100", "GE2", "GE2-007", "active"],
    ["CLASS100", "GE2", "GE2-008", "active"],
    ["CLASS100", "GE2", "GE2-009", "active"],
    ["CLASS100", "GE2", "GE2-010", "active"],
    ["CLASS100", "GE2", "GE2-011", "active"],
    ["CLASS100", "GE2", "GE2-012", "active"],
    ["CLASS100", "GE2", "GE2-013", "active"],
    ["CLASS100", "GE2", "GE2-014", "active"],
    ["CLASS100", "GE2", "GE2-015", "active"],
    ["CLASS100", "GE2", "GE2-016", "active"],
    ["CLASS100", "GE2", "GE2-017", "active"],
    ["CLASS100", "GE2", "GE2-018", "active"],
    ["CLASS100", "GE2", "GE2-019", "active"],
    ["CLASS100", "GE2", "GE2-020", "active"],
    ["CLASS100", "GE2", "GE2-021", "active"],
    ["CLASS100", "GE2", "GE2-022", "active"],
    ["CLASS100", "GE2", "GE2-033", "active"],
    ["CLASS100", "GE2", "GE2-034", "active"],
    ["CLASS100", "GE2", "GE2-035", "active"],
    ["CLASS100", "GE2", "GE2-036", "active"],
    ["CLASS100", "GE2", "GE2-038", "active"],
    ["CLASS100", "GE2", "GE2-039", "active"],
    ["CLASS100", "GE2", "GE2-040", "active"],
    ["CLASS100", "GE3", "GE3-001", "active"],
    ["CLASS100", "GE3", "GE3-003", "active"],
    ["CLASS100", "GE3", "GE3-007", "active"],
    ["CLASS100", "GE3", "GE3-008", "active"],
    ["CLASS100", "GE3", "GE3-009", "active"],
    ["CLASS100", "GE3", "GE3-010", "active"],
    ["CLASS100", "HEL", "HEL-001", "active"],
    ["CLASS100", "HEL", "HEL-002", "active"],
    ["CLASS100", "HEL", "HEL-003", "active"],
    ["CLASS100", "HEL", "HEL-004", "active"],
    ["CLASS100", "HEL", "HEL-005", "active"],
    ["CLASS100", "HEL", "HEL-006", "active"],
    ["CLASS100", "HEL", "HEL-007", "active"],
    ["CLASS100", "HEL", "HEL-017", "active"],
    ["CLASS100", "HEL", "HEL-018", "active"],
    ["CLASS100", "HEL", "HEL-026", "active"],
    ["CLASS100", "HEL", "HEL-028", "active"],
    ["CLASS100", "HEL", "HEL-030", "active"],
    ["CLASS100", "HEL", "HEL-032", "active"],
    ["CLASS100", "HEL", "HEL-033", "active"],
    ["CLASS100", "HEL", "HEL-036", "active"],
    ["CLASS100", "HEL", "HEL-040", "active"],
    ["CLASS100", "HEL", "HEL-041", "active"],
    ["CLASS100", "HEL", "HEL-043", "active"],
    ["CLASS100", "HEL", "HEL-044", "active"],
    ["CLASS100", "HEL", "HEL-046", "active"],
    ["CLASS100", "HEL", "HEL-047", "active"],
    ["CLASS100", "HEL", "HEL-048", "active"],
    ["CLASS100", "HEL", "HEL-049", "active"],
    ["CLASS100", "HEL", "HEL-050", "active"],
    ["CLASS100", "HEL", "HEL-051", "active"],
    ["CLASS100", "HEL", "HEL-052", "active"],
    ["CLASS100", "HEL", "HEL-053", "active"],
    ["CLASS100", "HEL", "HEL-055", "active"],
    ["CLASS100", "HEL", "HEL-056", "active"],
    ["CLASS100", "HEL", "HEL-057", "active"],
    ["CLASS100", "LSM", "LSM-001", "active"],
    ["CLASS100", "LSM", "LSM-002", "active"],
    ["CLASS100", "LSW", "LSW-001", "active"],
    ["CLASS100", "LSW", "LSW-002", "active"],
    ["CLASS100", "LSW", "LSW-003", "active"],
    ["CLASS100", "LSW", "LSW-004", "active"],
    ["CLASS100", "LSW", "LSW-005", "active"],
    ["CLASS100", "LSW", "LSW-006", "active"],
    ["CLASS100", "LSW", "LSW-009", "active"],
    ["CLASS100", "LSW", "LSW-017", "active"],
    ["CLASS100", "LSW", "LSW-019", "active"],
    ["CLASS100", "LSW", "LSW-024", "active"],
    ["CLASS100", "LSW", "LSW-025", "active"],
    ["CLASS100", "LSW", "LSW-026", "active"],
    ["CLASS100", "LSW", "LSW-027", "active"],
    ["CLASS100", "LSW", "LSW-028", "active"],
    ["CLASS100", "LSW", "LSW-029", "active"],
    ["CLASS100", "LSW", "LSW-030", "active"],
    ["CLASS100", "LSW", "LSW-031", "active"],
    ["CLASS100", "LSW", "LSW-032", "active"],
    ["CLASS100", "LSW", "LSW-033", "active"],
    ["CLASS100", "LSW", "LSW-034", "active"],
    ["CLASS100", "LSW", "LSW-035", "active"],
    ["CLASS100", "VNS", "VNS-001", "active"],
    ["CLASS100", "VNS", "VNS-002", "active"],
    ["CLASS100", "VNS", "VNS-003", "active"],
    ["CLASS100", "VNS", "VNS-004", "active"],
    ["CLASS100", "VNS", "VNS-005", "active"],
    ["CLASS100", "VNS", "VNS-006", "active"],
    ["CLASS100", "VNS", "VNS-007", "active"],
    ["CLASS100", "VNS", "VNS-008", "active"],
    ["CLASS100", "VNS", "VNS-009", "active"],
    ["CLASS100", "VNS", "VNS-010", "active"],
    ["CLASS100", "VNS", "VNS-012", "active"],
    ["CLASS100", "VNS", "VNS-013", "active"],
    ["CLASS100", "VNS", "VNS-014", "active"],
    ["CLASS100", "VNS", "VNS-015", "active"],
    ["CLASS100", "VNS", "VNS-016", "active"],
    ["CLASS100", "VNS", "VNS-017", "active"],
    ["CLASS100", "VNS", "VNS-018", "active"],
    ["CLASS100", "VNS", "VNS-019", "active"],
    ["CLASS100", "VNS", "VNS-020", "active"],
    ["CLASS100", "VNS", "VNS-021", "active"],
    ["CLASS100", "VNS", "VNS-022", "active"],
    ["CLASS100", "VNS", "VNS-023", "active"],
    ["CLASS100", "VNS", "VNS-024", "active"],
    ["CLASS100", "VNS", "VNS-025", "active"],
    ["CLASS100", "VNS", "VNS-026", "active"],
    ["CLASS1000", "ACI", "ACI-001", "active"],
    ["CLASS1000", "ACI", "ACI-002", "active"],
    ["CLASS1000", "ACI", "ACI-003", "active"],
    ["CLASS1000", "ASI", "ASI-001", "active"],
    ["CLASS1000", "ASI", "ASI-002", "active"],
    ["CLASS1000", "ASI", "ASI-003", "active"],
    ["CLASS1000", "LSM", "LSM-003", "active"],
    ["CLASS1000", "LSM", "LSM-004", "active"],
    ["CLASS1000", "LSM", "LSM-006", "active"],
    ["CLASS1000", "WSM", "WSM-001", "active"],
    ["CLASS1000", "WSM", "WSM-002", "active"],
    ["CLASS1000", "VCM", "VCM-001", "active"],
    ["CLASS1000", "VCM", "VCM-002", "active"],
    ["CLASS100", "ARA", "ARA-002", "active"],
    ["CLASS100", "ART", "ART-019", "active"],
    ["CLASS100", "ATX", "ATX-001", "active"],
    ["CLASS100", "LSM", "LSM-005", "active"],
    ["CLASS100", "LSW", "LSW-021", "active"],
    ["CLASS100", "VNS", "VNS-011", "active"]
];

async function main() {
    console.log(`Start seeding ${rawData.length} machines...`);

    for (const row of rawData) {
        let machine_area, machine_type, machine_name, status;

        if (row.length === 5) {
            // Ignore ID at index 0
            machine_area = row[1];
            machine_type = row[2];
            machine_name = row[3];
            status = row[4];
        } else {
            machine_area = row[0];
            machine_type = row[1];
            machine_name = row[2];
            status = row[3];
        }

        try {
            await prisma.tbm_machine.upsert({
                where: { machine_name: machine_name },
                update: {
                    machine_area,
                    machine_type,
                    status
                },
                create: {
                    machine_area,
                    machine_type,
                    machine_name,
                    status
                }
            });
            // console.log(`Processed ${machine_name}`);
        } catch (e) {
            console.error(`Error processing ${machine_name}:`, e.message);
        }
    }

    console.log("Seeding finished.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

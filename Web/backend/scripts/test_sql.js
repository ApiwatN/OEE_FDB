const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Querying SQL Server via Prisma...");

        // Query daily totals for 12th - 16th
        const dailyCounts = await prisma.tb_output_actual.groupBy({
            by: ['date'],
            where: {
                date: {
                    gte: new Date('2026-03-12T00:00:00.000Z'),
                    lte: new Date('2026-03-16T23:59:59.000Z'),
                }
            },
            _sum: {
                Overall: true
            },
            orderBy: {
                date: 'asc'
            }
        });
        
        console.log("Daily counts by Local Time (12th - 16th):");
        console.log(dailyCounts);

        // Query machine data specifically for the 14th
        const machine14 = await prisma.tb_output_actual.findMany({
            where: {
                date: new Date('2026-03-14T00:00:00.000Z')
            },
            select: {
                machine_name: true,
                Overall: true,
                actual_07: true, actual_08: true, actual_09: true, actual_10: true,
                actual_11: true, actual_12: true, actual_13: true, actual_14: true,
                actual_15: true, actual_16: true, actual_17: true, actual_18: true,
                actual_19: true, actual_20: true, actual_21: true, actual_22: true,
                actual_23: true, actual_00: true, actual_01: true, actual_02: true,
                actual_03: true, actual_04: true, actual_05: true, actual_06: true
            }
        });

        // Let's also check the 15th
        const machine15 = await prisma.tb_output_actual.findMany({
            where: {
                date: new Date('2026-03-15T00:00:00.000Z')
            },
            select: {
                machine_name: true,
                Overall: true,
                actual_07: true, actual_08: true, actual_09: true, actual_10: true,
                actual_11: true, actual_12: true, actual_13: true, actual_14: true,
                actual_15: true, actual_16: true, actual_17: true, actual_18: true,
                actual_19: true, actual_20: true, actual_21: true, actual_22: true,
                actual_23: true, actual_00: true, actual_01: true, actual_02: true,
                actual_03: true, actual_04: true, actual_05: true, actual_06: true
            }
        });

        fs.writeFileSync('sql_results.json', JSON.stringify({ daily: dailyCounts, machine14, machine15 }, null, 2));
        console.log("Results written to sql_results.json");
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
run();

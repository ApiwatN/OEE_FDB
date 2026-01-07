const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const machinesToUpdate = [
    { oldName: "AHV001", newName: "AHV-001" },
    { oldName: "AHV002", newName: "AHV-002" },
    { oldName: "AHV003", newName: "AHV-003" },
    { oldName: "AHV004", newName: "AHV-004" },
    { oldName: "AHV005", newName: "AHV-005" },
    { oldName: "AHV006", newName: "AHV-006" },
];

const tables = [
    "tbm_machine",
    "tb_output_target",
    "tb_output_actual",
    "tb_cycle_time_actual",
    "tb_efficiency_actual",
    "tb_oee",
    "tb_history_working"
];

async function main() {
    console.log("Starting machine name updates...");

    for (const { oldName, newName } of machinesToUpdate) {
        console.log(`Updating ${oldName} -> ${newName}`);

        try {
            // 1. Update tbm_machine first (handle unique constraint if needed, but usually update is fine if newName doesn't exist)
            // Check if newName already exists in tbm_machine
            const existingNew = await prisma.tbm_machine.findUnique({
                where: { machine_name: newName }
            });

            if (existingNew) {
                console.warn(`⚠️ Target machine ${newName} already exists in tbm_machine. Skipping tbm_machine update for this one, but will update other tables.`);
            } else {
                const updateMachine = await prisma.tbm_machine.updateMany({
                    where: { machine_name: oldName },
                    data: { machine_name: newName }
                });
                console.log(`  - tbm_machine: ${updateMachine.count} rows`);
            }

            // 2. Update other tables
            const updateTarget = await prisma.tb_output_target.updateMany({
                where: { machine_name: oldName },
                data: { machine_name: newName }
            });
            console.log(`  - tb_output_target: ${updateTarget.count} rows`);

            const updateActual = await prisma.tb_output_actual.updateMany({
                where: { machine_name: oldName },
                data: { machine_name: newName }
            });
            console.log(`  - tb_output_actual: ${updateActual.count} rows`);

            const updateCycle = await prisma.tb_cycle_time_actual.updateMany({
                where: { machine_name: oldName },
                data: { machine_name: newName }
            });
            console.log(`  - tb_cycle_time_actual: ${updateCycle.count} rows`);

            const updateEff = await prisma.tb_efficiency_actual.updateMany({
                where: { machine_name: oldName },
                data: { machine_name: newName }
            });
            console.log(`  - tb_efficiency_actual: ${updateEff.count} rows`);

            const updateOee = await prisma.tb_oee.updateMany({
                where: { machine_name: oldName },
                data: { machine_name: newName }
            });
            console.log(`  - tb_oee: ${updateOee.count} rows`);

            const updateHistory = await prisma.tb_history_working.updateMany({
                where: { machine_name: oldName },
                data: { machine_name: newName }
            });
            console.log(`  - tb_history_working: ${updateHistory.count} rows`);

        } catch (error) {
            console.error(`❌ Error updating ${oldName}:`, error.message);
        }
    }

    console.log("Update finished.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

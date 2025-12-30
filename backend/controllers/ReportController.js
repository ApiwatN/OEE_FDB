const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const dayjs = require("dayjs");

module.exports = {
    getMachineReport: async (req, res) => {
        try {
            const { month, area, type } = req.query; // month format: YYYY-MM

            if (!month) {
                return res.status(400).json({ message: "Month is required (YYYY-MM)" });
            }

            const startDate = dayjs(month).startOf("month").toDate();
            const endDate = dayjs(month).endOf("month").toDate();

            // 1. Find Active Machines based on filters
            const machineFilter = { status: "active" };
            if (area && area !== "all") machineFilter.machine_area = area;
            if (type && type !== "all") machineFilter.machine_type = type;

            const machines = await prisma.tbm_machine.findMany({
                where: machineFilter,
                select: { machine_name: true, machine_type: true },
                orderBy: { machine_name: "asc" },
            });

            const machineNames = machines.map((m) => m.machine_name);

            if (machineNames.length === 0) {
                return res.json({ results: [] });
            }

            // 2. Fetch Data from all related tables
            const whereClause = {
                machine_name: { in: machineNames },
                date: {
                    gte: startDate,
                    lte: endDate,
                },
            };

            const [targets, actuals, effs, cycles, oees] = await Promise.all([
                prisma.tb_output_target.findMany({ where: whereClause }),
                prisma.tb_output_actual.findMany({ where: whereClause }),
                prisma.tb_efficiency_actual.findMany({ where: whereClause }),
                prisma.tb_cycle_time_actual.findMany({ where: whereClause }),
                prisma.tb_oee.findMany({ where: whereClause }),
            ]);

            // 3. Aggregate Data
            const reportData = machines.map((machine) => {
                const mName = machine.machine_name;
                const dailyData = {};

                // Initialize daily data structure for the whole month? 
                // Or just map existing data. Let's map existing data by date key (YYYY-MM-DD).

                // Helper to get date key
                const getDateKey = (date) => dayjs(date).format("YYYY-MM-DD");

                // --- Targets ---
                const mTargets = targets.filter((t) => t.machine_name === mName);
                // Use the first target found for model info (assuming 1 model per month mostly, or take latest)
                // Ideally, we should show model info per day, but the UI shows it as row header. 
                // If multiple models in a month, we might need to pick one or list unique.
                // For now, let's pick the latest one or distinct.
                const latestTarget = mTargets.sort((a, b) => b.date - a.date)[0];

                const modelInfo = {
                    model_type: latestTarget?.model_type || "-",
                    model_name: latestTarget?.model_name || "-",
                    process_name: latestTarget?.process_name || "-",
                };

                mTargets.forEach(t => {
                    const key = getDateKey(t.date);
                    if (!dailyData[key]) dailyData[key] = {};

                    // Sum hourly targets (07:00 - 06:00)
                    const totalTarget = [
                        t.target_07, t.target_08, t.target_09, t.target_10, t.target_11, t.target_12,
                        t.target_13, t.target_14, t.target_15, t.target_16, t.target_17, t.target_18,
                        t.target_19, t.target_20, t.target_21, t.target_22, t.target_23, t.target_00,
                        t.target_01, t.target_02, t.target_03, t.target_04, t.target_05, t.target_06
                    ].reduce((sum, val) => sum + (val || 0), 0);

                    dailyData[key].output_target = totalTarget;
                    dailyData[key].eff_target = t.eff_target || 0;
                    dailyData[key].cycle_target = t.cycle_time_target || 0;
                });

                // --- Actual Output ---
                actuals.filter(a => a.machine_name === mName).forEach(a => {
                    const key = getDateKey(a.date);
                    if (!dailyData[key]) dailyData[key] = {};
                    // Calculate total actual from hourly fields if accum not present or reliable
                    // But let's assume we sum hourly fields for accuracy if needed, or use a summary field if exists.
                    // Looking at schema, there is no accum_actual in tb_output_actual, only hourly.
                    // So we must sum them.
                    const totalActual = [
                        a.actual_07, a.actual_08, a.actual_09, a.actual_10, a.actual_11, a.actual_12,
                        a.actual_13, a.actual_14, a.actual_15, a.actual_16, a.actual_17, a.actual_18,
                        a.actual_19, a.actual_20, a.actual_21, a.actual_22, a.actual_23, a.actual_00,
                        a.actual_01, a.actual_02, a.actual_03, a.actual_04, a.actual_05, a.actual_06
                    ].reduce((sum, val) => sum + (val || 0), 0);

                    dailyData[key].output_actual = totalActual;
                });

                // --- Efficiency Actual ---
                effs.filter(e => e.machine_name === mName).forEach(e => {
                    const key = getDateKey(e.date);
                    if (!dailyData[key]) dailyData[key] = {};
                    dailyData[key].eff_actual = e.eff_actual || 0;
                });

                // --- Cycle Time Actual ---
                cycles.filter(c => c.machine_name === mName).forEach(c => {
                    const key = getDateKey(c.date);
                    if (!dailyData[key]) dailyData[key] = {};
                    dailyData[key].cycle_actual = c.cycle_time || 0;
                });

                // --- OEE ---
                oees.filter(o => o.machine_name === mName).forEach(o => {
                    const key = getDateKey(o.date);
                    if (!dailyData[key]) dailyData[key] = {};
                    dailyData[key].ng_qty = o.ng_qty || 0;
                    dailyData[key].availability = o.availability || 0;
                    dailyData[key].performance = o.performance || 0;
                    dailyData[key].quality = o.quality || 0;
                    dailyData[key].oee = o.oee_value || 0;
                });

                return {
                    machine_name: mName,
                    model_info: modelInfo,
                    daily_data: dailyData
                };
            });

            res.json({ results: reportData });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error fetching machine report", error: err.message });
        }
    },
};

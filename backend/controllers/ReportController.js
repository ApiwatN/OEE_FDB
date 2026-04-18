const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");

const { getNgMode } = require("../services/oeeCalcService");

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

            const [targets, actuals, effs, cycles, oees, holidays, configs, ngs, avails] = await Promise.all([
                prisma.tb_output_target.findMany({ where: whereClause }),
                prisma.tb_output_actual.findMany({ where: whereClause }),
                prisma.tb_efficiency_actual.findMany({ where: whereClause }),
                prisma.tb_cycle_time_actual.findMany({ where: whereClause }),
                prisma.tb_oee.findMany({ where: whereClause }),
                prisma.tb_machine_holiday.findMany({
                    where: {
                        machine_name: { in: machineNames },
                        holiday_date: { gte: startDate, lte: endDate },
                    },
                    select: { machine_name: true, holiday_date: true },
                }),
                prisma.tb_machine_plan_config.findMany({
                    where: { machine_name: { in: machineNames } },
                    select: { machine_name: true, oee_mode: true },
                }),
                prisma.tb_machine_ng.findMany({ where: whereClause }),
                prisma.tb_availability_actual.findMany({ where: whereClause }),
            ]);
            const modeMap = new Map(configs.map(c => [c.machine_name, c.oee_mode || "manual"]));

            // 3. Aggregate Data
            const reportData = machines.map((machine) => {
                const mName = machine.machine_name;
                const ngMode = getNgMode(machine.machine_name);
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

                // ✅ model_name = actual model produced (from tb_output_actual / InfluxDB only)
                const modelNamesSet = new Set();
                actuals.filter(a => a.machine_name === mName).forEach(a => { if (a.model_name) modelNamesSet.add(a.model_name); });

                const allModelNames = [...modelNamesSet];

                const modelInfo = {
                    model_type: latestTarget?.model_type || "-",
                    model_name: allModelNames.length > 0 ? allModelNames.join(", ") : "-",
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

                    dailyData[key].machine_output_actual = totalActual;
                    dailyData[key].output_actual = totalActual;
                });

                // --- Station NG Data (for over_reject) ---
                const dailyNgTotals = {};
                if (ngMode === "over_reject") {
                    ngs.filter(ng => ng.machine_name === mName && ng.station_id === 0).forEach(ng => {
                        const key = getDateKey(ng.date);
                        const totalNg = [
                            ng.ng_07, ng.ng_08, ng.ng_09, ng.ng_10, ng.ng_11, ng.ng_12,
                            ng.ng_13, ng.ng_14, ng.ng_15, ng.ng_16, ng.ng_17, ng.ng_18,
                            ng.ng_19, ng.ng_20, ng.ng_21, ng.ng_22, ng.ng_23, ng.ng_00,
                            ng.ng_01, ng.ng_02, ng.ng_03, ng.ng_04, ng.ng_05, ng.ng_06
                        ].reduce((sum, val) => sum + (val || 0), 0);
                        
                        if (!dailyNgTotals[key]) dailyNgTotals[key] = 0;
                        dailyNgTotals[key] += totalNg;
                    });
                }

                // --- Availability & Efficiency Actual Priority Read ---
                // Try from tb_availability_actual first
                avails.filter(a => a.machine_name === mName).forEach(a => {
                    const key = getDateKey(a.date);
                    if (!dailyData[key]) dailyData[key] = {};
                    dailyData[key].eff_actual = a.avail_actual || 0; // mapping to eff_actual for UI compatibility
                });

                // Fallback to tb_efficiency_actual if availability is 0 or empty (for older legacy data)
                effs.filter(e => e.machine_name === mName).forEach(e => {
                    const key = getDateKey(e.date);
                    if (!dailyData[key]) dailyData[key] = {};
                    if (!dailyData[key].eff_actual) {
                        dailyData[key].eff_actual = e.eff_actual || 0;
                    }
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
                    if (ngMode !== "over_reject") {
                        dailyData[key].ng_qty = o.ng_qty || 0; // Only use Visual NG for non ABR machines
                    }
                    dailyData[key].availability = o.availability || 0;
                    dailyData[key].performance = o.performance || 0;
                    dailyData[key].quality = o.quality || 0;
                    dailyData[key].oee = o.oee_value || 0;
                });

                // --- Calculate Over_Reject & Override Totals ---
                Object.keys(dailyData).forEach(key => {
                    if (ngMode === "over_reject") {
                        const overReject = dailyNgTotals[key] || 0;
                        dailyData[key].over_reject_qty = overReject;
                        dailyData[key].ng_qty = 0; // Force NG Qty to 0
                        const machineOut = dailyData[key].machine_output_actual || 0;
                        dailyData[key].output_actual = Math.max(0, machineOut - overReject);
                        
                        // Force Quality to 100 if there's output
                        if (machineOut > 0) {
                            dailyData[key].quality = 100;
                            dailyData[key].oee = ((dailyData[key].availability || 0) * (dailyData[key].performance || 0) * 100) / 10000;
                        } else {
                            dailyData[key].quality = 0;
                            dailyData[key].oee = 0;
                        }
                    } else {
                        // Ensure machine_output_actual is populated for standard mode
                        dailyData[key].machine_output_actual = dailyData[key].output_actual;
                    }
                });

                return {
                    machine_name: mName,
                    machine_type: machine.machine_type || "Unknown",
                    model_info: modelInfo,
                    daily_data: dailyData,
                    oee_mode: modeMap.get(mName) || "manual",
                    ng_mode: ngMode,
                    holidays: holidays
                        .filter(h => h.machine_name === mName)
                        .map(h => dayjs(h.holiday_date).format("YYYY-MM-DD")),
                };
            });

            res.json({ results: reportData });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error fetching machine report", error: err.message });
        }
    },
};

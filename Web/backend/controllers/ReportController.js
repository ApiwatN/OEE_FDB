const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");

const {
    getNgMode,
    getAvailabilityTargetConfig,
    sumHourlyFields,
    calcRejectSummary,
    calcOeeValue,
} = require("../services/oeeCalcService");
const { groupActualRowsByMachineAndDate, sumActualTotal } = require("../services/actualOutputService");

// ✅ Same shift-hour order used by cronService & OeeDashboardController
const SHIFT_HOURS = [
    "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
    "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06",
];

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
            const actualRowsByMachineDate = groupActualRowsByMachineAndDate(
                actuals,
                (date) => dayjs(date).format("YYYY-MM-DD")
            );

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

                // ✅ model_name = actual model produced — exclude '--' placeholder rows
                const modelNamesSet = new Set();
                actuals
                    .filter(a => a.machine_name === mName && a.model_name && a.model_name !== "--")
                    .forEach(a => modelNamesSet.add(a.model_name));

                const allModelNames = [...modelNamesSet];

                const modelInfo = {
                    model_type: latestTarget?.model_type || "-",
                    model_name: allModelNames.length > 0 ? allModelNames.join(", ") : "-",
                    process_name: latestTarget?.process_name || "-",
                };

                const availConf = getAvailabilityTargetConfig(mName);

                mTargets.forEach(t => {
                    const key = getDateKey(t.date);
                    if (!dailyData[key]) dailyData[key] = {};

                    // Sum hourly targets (07:00 - 06:00)
                    const totalTarget = sumHourlyFields(t, "target", SHIFT_HOURS);

                    dailyData[key].output_target = totalTarget;
                    dailyData[key].eff_target = typeof availConf === "number" ? availConf : (t.eff_target || 0);
                    dailyData[key].cycle_target = t.cycle_time_target || 0;
                });

                // --- Actual Output (per-hour fallback — same logic as OeeDashboardController) ---
                // 🔧 Fix Bug #1: สะสม rows ต่อ date ก่อน แล้วทำ per-hour fallback
                // Rule: ถ้าชั่วโมงมี real model → SUM real only; ถ้ามีแค่ '--' → ใช้ '--' แทน
                // วิธีนี้ป้องกัน double-count ในวันที่มีทั้ง real model row และ '--' row
                // Apply per-hour fallback per date
                const actualRowsByDate = actualRowsByMachineDate[mName] || {};
                Object.keys(actualRowsByDate).forEach(key => {
                    if (!dailyData[key]) dailyData[key] = {};
                    const rows = actualRowsByDate[key];
                    const totalActual = sumActualTotal(rows, SHIFT_HOURS);

                    dailyData[key].machine_output_actual = totalActual;
                    dailyData[key].output_actual = totalActual;
                });

                // --- Station NG Data (for over_reject) ---
                const dailyNgTotals = {};
                if (ngMode === "over_reject") {
                    ngs.filter(ng => ng.machine_name === mName && ng.station_id === 0).forEach(ng => {
                        const key = getDateKey(ng.date);
                        const totalNg = sumHourlyFields(ng, "ng", SHIFT_HOURS);
                        
                        if (!dailyNgTotals[key]) dailyNgTotals[key] = 0;
                        dailyNgTotals[key] += totalNg;
                    });
                }

                // --- Availability: tb_availability_actual (primary) + tb_efficiency_actual (legacy fallback) ---
                // 🔧 Fix Bug #2: ใช้ avail_actual จาก tb_availability_actual เป็น source หลัก
                // เพราะ Cron Worker เขียนทุกชั่วโมง และตรงกับที่ machine_working ใช้
                avails.filter(a => a.machine_name === mName).forEach(a => {
                    const key = getDateKey(a.date);
                    if (!dailyData[key]) dailyData[key] = {};
                    // eff_actual → แสดงเป็น "Availability (Target)" column ใน UI
                    dailyData[key].eff_actual = a.avail_actual || 0;
                    // availability → แสดงเป็น "Availability" column (ใช้ค่าเดียวกัน เป็น primary source)
                    dailyData[key].availability = a.avail_actual || 0;
                });

                // Legacy fallback: tb_efficiency_actual สำหรับวันเก่าที่ยังไม่มีใน tb_availability_actual
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

                // --- OEE: tb_oee เป็น source ของ performance, quality, oee, ng_qty ---
                // 🔧 Fix Bug #2: availability ถูก set จาก tb_availability_actual แล้วด้านบน
                // tb_oee ให้แค่ performance, quality, oee_value, ng_qty เท่านั้น
                // ถ้ายังไม่มี availability จาก tb_availability_actual → fallback ใช้ o.availability จาก tb_oee
                oees.filter(o => o.machine_name === mName).forEach(o => {
                    const key = getDateKey(o.date);
                    if (!dailyData[key]) dailyData[key] = {};
                    if (ngMode !== "over_reject") {
                        dailyData[key].ng_qty = o.ng_qty || 0;
                    }
                    // Fallback availability ถ้า tb_availability_actual ยังไม่มีข้อมูลวันนี้
                    if (!dailyData[key].availability) {
                        dailyData[key].availability = o.availability || 0;
                    }
                    dailyData[key].performance = o.performance || 0;
                    dailyData[key].quality = o.quality || 0;
                    dailyData[key].oee = o.oee_value || 0;
                });

                // --- Calculate Over_Reject & Override Totals ---
                Object.keys(dailyData).forEach(key => {
                    if (ngMode === "over_reject") {
                        const { rejectQty: overReject, totalOutput } = calcRejectSummary(
                            dailyData[key].machine_output_actual || 0,
                            dailyNgTotals[key] || 0
                        );
                        dailyData[key].over_reject_qty = overReject;
                        dailyData[key].ng_qty = 0; // Force NG Qty to 0
                        const machineOut = dailyData[key].machine_output_actual || 0;
                        dailyData[key].output_actual = totalOutput;
                        
                        // Force Quality to 100 if there's output
                        if (machineOut > 0) {
                            dailyData[key].quality = 100;
                            dailyData[key].oee = calcOeeValue(
                                dailyData[key].availability || 0,
                                dailyData[key].performance || 0,
                                100
                            );
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

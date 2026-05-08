const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");

const { getNgMode, sumHourlyFields, calcRejectSummary } = require("../services/oeeCalcService");

module.exports = {
    getMachineNgReport: async (req, res) => {
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

            const [targets, actuals, oees, ngs, stations, configs, holidays] = await Promise.all([
                prisma.tb_output_target.findMany({ where: whereClause }),
                prisma.tb_output_actual.findMany({ where: whereClause, select: { machine_name: true, model_name: true, date: true, Overall: true } }),
                prisma.tb_oee.findMany({ where: whereClause, select: { machine_name: true, date: true, ng_qty: true, quality: true, oee_value: true } }),
                prisma.tb_machine_ng.findMany({ where: whereClause }),
                prisma.tbm_machine_station.findMany({ where: { machine_name: { in: machineNames }, status: 'active' }, orderBy: { station_number: 'asc' } }),
                prisma.tb_machine_plan_config.findMany({
                    where: { machine_name: { in: machineNames } },
                    select: { machine_name: true, oee_mode: true },
                }),
                // ✅ Bug 4 Fix: Query holidays so frontend can highlight them correctly
                prisma.tb_machine_holiday.findMany({
                    where: {
                        machine_name: { in: machineNames },
                        holiday_date: { gte: startDate, lte: endDate },
                    },
                    select: { machine_name: true, holiday_date: true },
                }),
            ]);
            
            const modeMap = new Map(configs.map(c => [c.machine_name, c.oee_mode || "manual"]));

            // Organize stations by machine — key by station_id for FK lookups
            const stationMap = {};
            stations.forEach(st => {
                if (!stationMap[st.machine_name]) stationMap[st.machine_name] = [];
                stationMap[st.machine_name].push(st); // full station object (id + station_name)
            });

            // Build a quick id→station_name lookup for display
            const stationIdToName = {};
            stations.forEach(st => { stationIdToName[st.id] = st.station_name; });

            // 3. Aggregate Data
            const reportData = machines.map((machine) => {
                const mName = machine.machine_name;
                const oeeMode = modeMap.get(mName);
                const dailyData = {};
                const mStations = stationMap[mName] || [];     // array of station objects
                const mStationNames = mStations.map(s => s.station_name); // names for UI

                const getDateKey = (date) => dayjs(date).format("YYYY-MM-DD");

                // --- Model Info logic (Same as Machine Report) ---
                const mTargets = targets.filter((t) => t.machine_name === mName);
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

                // Initialize daily objects
                const daysInMonth = dayjs(startDate).daysInMonth();
                for (let i = 1; i <= daysInMonth; i++) {
                     const key = dayjs(startDate).date(i).format("YYYY-MM-DD");
                     dailyData[key] = {
                         has_production: false,
                         stations: {},
                         Machine_Output: "-",
                         Total_Output: "-",
                         All: 0,
                         Visual_NG: "-",
                         Over_Reject: "-",
                         Over_Reject_Percent: "-"
                     };
                     // Pre-fill stations with 0
                     mStationNames.forEach(name => dailyData[key].stations[name] = 0);
                }

                // --- Total Output (Machine Output) Data ---
                actuals.filter(a => a.machine_name === mName).forEach(a => {
                    const key = getDateKey(a.date);
                    if (dailyData[key] && a.Overall !== undefined && a.Overall !== null) {
                        // Machine_Output = raw output from machine
                        dailyData[key].Machine_Output = a.Overall;
                        // Default: Total_Output = Machine_Output (may be overridden below for over_reject)
                        dailyData[key].Total_Output = a.Overall;
                        if (a.Overall > 0) dailyData[key].has_production = true;
                    }
                });

                // --- Station NG Data --- group by station_id FK, display by station_name
                ngs.filter(ng => ng.machine_name === mName).forEach(ng => {
                    const key = getDateKey(ng.date);
                    if (!dailyData[key]) return;

                    const totalStationNg = sumHourlyFields(ng, "ng");

                    if (ng.station_id === 0) {
                        // ✅ This is the special record holding "True NG Parts"
                        dailyData[key].All += totalStationNg;
                        dailyData[key].has_production = true;
                    } else {
                        // Use station_id to lookup display name for standard stations
                        const displayName = ng.station_id
                            ? (stationIdToName[ng.station_id] || ng.station_name)
                            : ng.station_name;

                        if (dailyData[key].stations[displayName] !== undefined) {
                            dailyData[key].stations[displayName] = totalStationNg;
                            dailyData[key].has_production = true;
                        }
                    }
                });

                // --- NG Calculation based on ng_mode ---
                const ngMode = getNgMode(machine.machine_name);

                if (ngMode === "over_reject") {
                    // ABR: NG = All station NG (Over Reject). Visual NG is not applicable.
                    // Total_Output = Machine_Output - Over_Reject
                    // Trigger: when station NG data exists (has_production set by station loop)
                    for (const key of Object.keys(dailyData)) {
                        const d = dailyData[key];
                        if (!d.has_production) continue;
                        const machineOut = d.Machine_Output !== "-" ? Number(d.Machine_Output) : 0;
                        const { rejectQty: overReject, totalOutput: totalOut, rejectPercent } = calcRejectSummary(machineOut, d.All || 0);
                        d.Over_Reject = overReject;
                        d.Total_Output = totalOut;
                        d.Over_Reject_Percent = rejectPercent;
                        // Visual_NG is not applicable for ABR — leave as null
                        d.Visual_NG = null;
                    }
                } else {
                    // AHV / default: Visual NG mode — existing logic
                    oees.filter(o => o.machine_name === mName).forEach(o => {
                        const key = getDateKey(o.date);
                        if (dailyData[key]) {
                            const visualNg = o.ng_qty;
                            dailyData[key].has_production = true;

                            if (visualNg !== null && visualNg !== undefined) {
                                const userHasNotUpdated = oeeMode === 'manual' && visualNg === 0 && o.quality === 0 && o.oee_value === 0;

                                if (userHasNotUpdated) {
                                    dailyData[key].Visual_NG = "-";
                                } else {
                                    dailyData[key].Visual_NG = visualNg;
                                    const overReject = Math.max(0, dailyData[key].All - visualNg);
                                    dailyData[key].Over_Reject = overReject;

                                    const totalOutput = dailyData[key].Total_Output !== "-" ? dailyData[key].Total_Output : 0;
                                    dailyData[key].Over_Reject_Percent = calcRejectSummary(totalOutput, overReject).rejectPercent;
                                    // Machine_Output = Total_Output for visual_ng mode
                                    dailyData[key].Machine_Output = dailyData[key].Total_Output;
                                }
                            }
                        }
                    });
                }

                return {
                    machine_name: mName,
                    machine_type: machine.machine_type || "Unknown",
                    oee_mode: oeeMode,
                    ng_mode: getNgMode(machine.machine_name),
                    model_info: modelInfo,
                    dailyData: dailyData,
                    stations: mStationNames,
                    holidays: holidays
                        .filter(h => h.machine_name === mName)
                        .map(h => dayjs(h.holiday_date).format("YYYY-MM-DD")),
                };
            });

            res.json({ results: reportData });
        } catch (error) {
            console.error("Machine NG Report Error:", error);
            res.status(500).json({ message: "Server error", error: error.message });
        }
    },
};

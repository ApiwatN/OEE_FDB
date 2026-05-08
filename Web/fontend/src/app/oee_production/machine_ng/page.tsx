"use client";
import React, { Suspense, useCallback, useEffect, useState, useMemo } from "react";
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import * as XLSX from "xlsx-js-style";
import { useDashboardSocket } from "@/app/hooks/useDashboardSocket";
import config from "@/app/config";
import LoadingSpinner from "@/app/components/LoadingSpinner";

type CellValue = string | number | boolean | null | undefined;
type StationValues = Record<string, number>;
type NgDailyData = Record<string, CellValue | StationValues> & {
    has_production?: boolean;
    stations: StationValues;
    Machine_Output?: CellValue;
    Total_Output?: CellValue;
    All?: CellValue;
    Visual_NG?: CellValue;
    Over_Reject?: CellValue;
    Over_Reject_Percent?: CellValue;
};
type ModelInfo = {
    model_type?: string;
    model_name?: string;
    process_name?: string;
};
type MachineNgReport = {
    machine_name: string;
    machine_type?: string;
    oee_mode?: string;
    ng_mode?: string;
    model_info: ModelInfo;
    dailyData: Record<string, NgDailyData>;
    stations: string[];
    holidays?: string[];
};
type MachineGroup = {
    type: string;
    machines: MachineNgReport[];
    stations: string[];
    summaryData: Record<string, NgDailyData>;
    modelTypes: Set<string>;
    modelNames: Set<string>;
    processes: Set<string>;
    allStations: Set<string>;
    modelTypesArr?: string;
    modelNamesArr?: string;
    processesArr?: string;
    ng_mode?: string;
};
type RealtimeDailyPayload = {
    totalOutput?: number;
    ngQty?: number;
};
type RealtimePayload = {
    shiftDate?: string;
    machines?: Record<string, { daily?: RealtimeDailyPayload }>;
};
type RowDefinition = {
    label: string;
    key: string;
    isStation: boolean;
    isPercent: boolean;
    showZero: boolean;
};

export default function MachineNgPage() {
    return (
        <Suspense fallback={<LoadingSpinner message="Loading Report..." />}>
            <style>{`
                .hide-scrollbar::-webkit-scrollbar:horizontal {
                    height: 0px;
                    display: none;
                }
                .hide-scrollbar::-webkit-scrollbar {
                    width: 8px;
                }
                .hide-scrollbar::-webkit-scrollbar-thumb {
                    background: #ccc;
                    border-radius: 4px;
                }
            `}</style>
            <MachineNgReportPage />
        </Suspense>
    );
}

function MachineNgReportPage() {
    const [areas, setAreas] = useState<string[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(dayjs().format("YYYY-MM"));
    const [selectedArea, setSelectedArea] = useState("all");
    const [selectedType, setSelectedType] = useState("all");
    const [reportData, setReportData] = useState<MachineNgReport[]>([]);
    const [loading, setLoading] = useState(false);
    const [countdown, setCountdown] = useState(5 * 60);

    useEffect(() => {
        const init = async () => {
            const fetchedAreas = await fetchAreas();
            if (!fetchedAreas || fetchedAreas.length === 0) return;

            const localArea = localStorage.getItem("report_filter_area");
            const targetArea = localArea && localArea !== "all" && fetchedAreas.includes(localArea)
                ? localArea
                : fetchedAreas[0];

            setSelectedArea(targetArea);

            const fetchedTypes = await fetchTypes(targetArea);
            const localType = localStorage.getItem("report_filter_type");
            const targetType = localType && localType !== "all" && fetchedTypes.includes(localType)
                ? localType
                : (fetchedTypes.length > 0 ? fetchedTypes[0] : "all");

            setSelectedType(targetType);
            await fetchReport(dayjs().format("YYYY-MM"), targetArea, targetType);
        };
        init();
    }, []);

    useEffect(() => {
        const REFRESH_INTERVAL = 5 * 60;
        setCountdown(REFRESH_INTERVAL);

        const countdownId = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    fetchReportSilent(selectedMonth, selectedArea, selectedType);
                    return REFRESH_INTERVAL;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(countdownId);
    }, [selectedMonth, selectedArea, selectedType]);

    const handleRealtimeUpdate = useCallback((data: RealtimePayload) => {
        const isCurrentMonth = dayjs(selectedMonth).format("YYYY-MM") === dayjs().format("YYYY-MM");
        if (!isCurrentMonth) return;

        const shiftDate = data?.shiftDate;
        const socketMachines = data?.machines;
        if (!shiftDate || !socketMachines) return;

        setReportData(prev => {
            if (prev.length === 0) return prev;
            return prev.map(machine => {
                const socketData = socketMachines[machine.machine_name];
                if (!socketData?.daily) return machine;

                const isAuto = machine.oee_mode === "auto";
                if (!isAuto) return machine;

                const updatedDailyData = { ...machine.dailyData };
                const existing = updatedDailyData[shiftDate] || { stations: {} };
                const allQty = Number(existing.All || 0);
                const machineOutput = socketData.daily.totalOutput ?? (existing.Machine_Output !== "-" ? Number(existing.Machine_Output || 0) : 0);

                if (machine.ng_mode === "over_reject") {
                    const overReject = allQty;
                    const totalOutput = Math.max(0, machineOutput - overReject);
                    const overRejectPercent = machineOutput > 0 ? parseFloat(((overReject / machineOutput) * 100).toFixed(2)) : 0;
                    updatedDailyData[shiftDate] = {
                        ...existing,
                        has_production: existing.has_production ?? true,
                        Machine_Output: machineOutput,
                        Total_Output: totalOutput,
                        Over_Reject: overReject,
                        Over_Reject_Percent: overRejectPercent,
                        Visual_NG: null,
                    };
                } else {
                    const visualNg = socketData.daily.ngQty ?? 0;
                    const overReject = Math.max(0, allQty - visualNg);
                    const overRejectPercent = machineOutput > 0 ? parseFloat(((overReject / machineOutput) * 100).toFixed(2)) : 0;
                    updatedDailyData[shiftDate] = {
                        ...existing,
                        has_production: existing.has_production ?? true,
                        Machine_Output: machineOutput,
                        Total_Output: machineOutput,
                        Visual_NG: visualNg,
                        Over_Reject: overReject,
                        Over_Reject_Percent: overRejectPercent,
                    };
                }

                return { ...machine, dailyData: updatedDailyData };
            });
        });
    }, [selectedMonth]);

    const dashboardEvents = useMemo(() => [
        { event: "realtime_update", handler: handleRealtimeUpdate },
    ], [handleRealtimeUpdate]);
    const { socketConnected, serverTimeStr } = useDashboardSocket<RealtimePayload>({ events: dashboardEvents });

    // ==========================
    // 🔸 API Calls
    // ==========================
    const fetchAreas = async () => {
        try { const res = await axios.get<{ results: { machine_area: string }[] }>(`${config.apiServer}/api/machine/listArea`); const arr = res.data.results.map((r) => r.machine_area); setAreas(arr); return arr; } catch (e) { console.error(e); return []; }
    };
    const fetchTypes = async (area: string) => {
        try { if (area === "all" || !area) { setTypes([]); return []; } const res = await axios.get(`${config.apiServer}/api/machine/listType/${area}`); const arr = res.data.results; setTypes(arr); return arr; } catch (e) { console.error(e); return []; }
    };

    const fetchReport = async (month: string, area: string, type: string, showLoading: boolean = true) => {
        if (showLoading) setLoading(true);
        try {
            const res = await axios.get(`${config.apiServer}/api/report/machine-ng-report`, {
                params: { month, area, type }
            });
            setReportData(res.data.results || []);
        } catch (e) {
            console.error(e);
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    // Silent Refresh: Merges only dailyData into existing state — avoids full re-render blink
    const fetchReportSilent = async (month: string, area: string, type: string) => {
        try {
            const res = await axios.get(`${config.apiServer}/api/report/machine-ng-report`, {
                params: { month, area, type }
            });
            const fresh: MachineNgReport[] = res.data.results || [];
            const freshMap = new Map(fresh.map((m) => [m.machine_name, m]));
            setReportData(prev => prev.map(machine => {
                const updated = freshMap.get(machine.machine_name);
                if (!updated) return machine;
                return { ...machine, dailyData: updated.dailyData };
            }));
        } catch (e) {
            console.error("[Silent Refresh] failed:", e);
        }
    };

    // ==========================
    // 🔸 Handlers
    // ==========================
    const handleAreaChange = async (area: string) => {
        setSelectedArea(area);
        localStorage.setItem("report_filter_area", area);

        const fetchedTypes = await fetchTypes(area);
        const newType = fetchedTypes.length > 0 ? fetchedTypes[0] : "";

        setSelectedType(newType);
        localStorage.setItem("report_filter_type", newType);

        await fetchReport(selectedMonth, area, newType);
    };

    const handleTypeChange = async (type: string) => {
        setSelectedType(type);
        localStorage.setItem("report_filter_type", type);
        await fetchReport(selectedMonth, selectedArea, type);
    };

    const handleMonthChange = async (month: string) => {
        setSelectedMonth(month);
        await fetchReport(month, selectedArea, selectedType);
    };

    // ==========================
    // 🔸 Data Grouping (By Machine Type)
    // ==========================
    const isDayEmpty = (dailyData: Record<string, NgDailyData>, day: number, month: string): boolean => {
        const dateKey = `${month}-${String(day).padStart(2, '0')}`;
        const data = dailyData[dateKey];
        if (!data) return true;
        return !data.has_production;
    };

    const groupedReportData = useMemo(() => {
        const groups: MachineGroup[] = [];
        const typeMap = new Map<string, MachineGroup>();

        reportData.forEach(machine => {
            const type = machine.machine_type || "Unknown";
            if (!typeMap.has(type)) {
                const group: MachineGroup = { type, machines: [], stations: [], summaryData: {}, modelTypes: new Set(), modelNames: new Set(), processes: new Set(), allStations: new Set() };
                typeMap.set(type, group);
                groups.push(group);
            }
            const g = typeMap.get(type);
            if (!g) return;
            g.machines.push(machine);
            if (machine.model_info?.model_type && machine.model_info.model_type !== "-") g.modelTypes.add(machine.model_info.model_type);
            
            const names = (machine.model_info?.model_name || "").split(",").map((s: string) => s.trim()).filter((s: string) => s && s !== "-");
            names.forEach((n: string) => g.modelNames.add(n));
            
            if (machine.model_info?.process_name && machine.model_info.process_name !== "-") g.processes.add(machine.model_info.process_name);
            machine.stations.forEach((st: string) => g.allStations.add(st));
        });

        groups.forEach(g => {
            g.stations = Array.from(g.allStations);
            // Determine ng_mode from first machine in group (all same type)
            g.ng_mode = g.machines[0]?.ng_mode || "visual_ng";
            const summaryData: Record<string, NgDailyData> = {};

            for (let d = 1; d <= 31; d++) {
                const dateKey = `${selectedMonth}-${String(d).padStart(2, '0')}`;
                const dayData: NgDailyData = { has_production: false, stations: {} };

                let sumTotalOutput = 0, sumAll = 0, sumVisualNg = 0, sumOverReject = 0, sumMachineOutput = 0;
                
                g.stations.forEach((st: string) => dayData.stations[st] = 0);

                g.machines.forEach((m) => {
                    const data = m.dailyData[dateKey];
                    if (!data) return;
                    
                    if (!isDayEmpty(m.dailyData, d, selectedMonth)) {
                        dayData.has_production = true;
                    }

                    if (data.Machine_Output !== undefined && data.Machine_Output !== "-" && data.Machine_Output !== null) sumMachineOutput += Number(data.Machine_Output);
                    if (data.Total_Output !== undefined && data.Total_Output !== "-") sumTotalOutput += Number(data.Total_Output);
                    if (data.All !== undefined && data.All !== "-") sumAll += Number(data.All);
                    if (data.Visual_NG !== undefined && data.Visual_NG !== "-" && data.Visual_NG !== null) sumVisualNg += Number(data.Visual_NG);
                    if (data.Over_Reject !== undefined && data.Over_Reject !== "-") sumOverReject += Number(data.Over_Reject);

                    g.stations.forEach((st: string) => {
                        if (data.stations && data.stations[st] !== undefined) {
                            dayData.stations[st] += Number(data.stations[st] || 0);
                        }
                    });
                });

                if (dayData.has_production) {
                    dayData.Machine_Output = sumMachineOutput;
                    dayData.Total_Output = sumTotalOutput;
                    dayData.All = sumAll;
                    dayData.Visual_NG = g.ng_mode === "over_reject" ? null : sumVisualNg;
                    dayData.Over_Reject = sumOverReject;
                    // For over_reject (ABR): use Machine_Output as denominator
                    if (g.ng_mode === "over_reject") {
                        dayData.Over_Reject_Percent = sumMachineOutput > 0 ? parseFloat(((sumOverReject / sumMachineOutput) * 100).toFixed(2)) : 0;
                    } else {
                        dayData.Over_Reject_Percent = sumTotalOutput > 0 ? parseFloat(((sumOverReject / sumTotalOutput) * 100).toFixed(2)) : 0;
                    }
                } else {
                    dayData.Machine_Output = "-";
                    dayData.Total_Output = "-";
                    dayData.All = 0;
                    dayData.Visual_NG = "-";
                    dayData.Over_Reject = "-";
                    dayData.Over_Reject_Percent = "-";
                }

                summaryData[dateKey] = dayData;
            }
            g.summaryData = summaryData;
            g.modelTypesArr = Array.from(g.modelTypes).join(", ") || "-";
            g.modelNamesArr = Array.from(g.modelNames).join(", ") || "-";
            g.processesArr = Array.from(g.processes).join(", ") || "-";
        });
        return groups;
    }, [reportData, selectedMonth]);

    const handleExport = () => {
        if (!reportData || reportData.length === 0) return;

        const wb = XLSX.utils.book_new();
        const wsData: unknown[][] = [];
        const merges: XLSX.Range[] = [];

        // 0. Summary Rows (4 rows) - Topic in Col 1, Value in Col 2
        wsData.push(["Area", selectedArea]);
        wsData.push(["Machine Type", selectedType]);
        wsData.push(["Month", dayjs(selectedMonth).format("MMMM")]);
        wsData.push(["Year", dayjs(selectedMonth).format("YYYY")]);

        // 1. Header Row (Row Index 4)
        const daysInMonth = dayjs(selectedMonth).daysInMonth();
        const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

        const headerRow = [
            "Machine No", "Model Type", "Model Name", "Process", "Data",
            ...daysArray.map(d => `${d}-${dayjs(selectedMonth).format("MMM")}`),
            "Total"
        ];
        wsData.push(headerRow);

        // 2. Data Rows
        let currentRowIndex = 5; // Start after summary (4 rows) and header (1 row) -> Index 5

        groupedReportData.forEach((group) => {
            // Render specific machines in group
            group.machines.forEach((machine) => {
                const { machine_name, model_info, dailyData, stations } = machine;
                
                const mNgMode = machine.ng_mode || "visual_ng";
                const rows: RowDefinition[] = [];
                stations.forEach((st: string) => rows.push({ label: st, key: st, isStation: true, isPercent: false, showZero: false }));
                if (mNgMode === "over_reject") {
                    rows.push({ label: "Machine Output", key: "Machine_Output", isStation: false, isPercent: false, showZero: true });
                    rows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
                    rows.push({ label: "NG Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
                    rows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
                    rows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });
                } else {
                    rows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
                    rows.push({ label: "NG Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
                    rows.push({ label: "Visual NG", key: "Visual_NG", isStation: false, isPercent: false, showZero: true });
                    rows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
                    rows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });
                }

                const startRow = currentRowIndex;
                const endRow = startRow + rows.length - 1;

                for (let col = 0; col <= 3; col++) {
                    merges.push({ s: { r: startRow, c: col }, e: { r: endRow, c: col } });
                }

                rows.forEach((r) => {
                    const rowData: unknown[] = [
                        machine_name,
                        model_info?.model_type || "-",
                        model_info?.model_name || "-",
                        model_info?.process_name || "-",
                        r.label
                    ];

                    daysArray.forEach(day => {
                        const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
                        const dData = dailyData[dateKey];
                        let val = undefined;
                        
                        if (dData) {
                            if (r.isStation) val = dData.stations[r.key];
                            else val = dData[r.key as "Total_Output" | "All" | "Visual_NG" | "Over_Reject" | "Over_Reject_Percent"];
                        }

                        const isManualToday = machine.oee_mode !== "auto" && dateKey === dayjs.utc().format("YYYY-MM-DD");
                        const hideNgFields = isManualToday && ["Visual_NG", "Over_Reject", "Over_Reject_Percent"].includes(r.key);
                        const isFuture = dayjs(dateKey).isAfter(dayjs(), 'day');
                        const hasProduction = dData && dData.has_production;

                        let cellVal: CellValue = "";
                        
                        if (isFuture || !hasProduction) {
                             cellVal = "";
                        } else if (hideNgFields || val === "-") {
                             cellVal = "-";
                        } else if (val === 0 || val === "0.00") {
                             cellVal = r.showZero ? (r.isPercent ? "0%" : 0) : "";
                        } else if (val !== undefined && val !== null && val !== "") {
                             cellVal = r.isPercent ? `${Number(val).toFixed(2)}%` : parseFloat(Number(val).toFixed(2));
                        }
                        rowData.push(cellVal);
                    });

                    // Add Total Column
                    const totalVal = getRowTotal(dailyData, r.key, r.isStation);
                    rowData.push(renderCell(totalVal, r.isPercent, r.showZero));
                    wsData.push(rowData);
                    currentRowIndex++;
                });
            });

            // Render Group Summary Row
            const rows: RowDefinition[] = [];
            group.stations.forEach((st: string) => rows.push({ label: st, key: st, isStation: true, isPercent: false, showZero: false }));
            if (group.ng_mode === "over_reject") {
                rows.push({ label: "Machine Output", key: "Machine_Output", isStation: false, isPercent: false, showZero: true });
                rows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
                rows.push({ label: "NG Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
                rows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
                rows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });
            } else {
                rows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
                rows.push({ label: "NG Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
                rows.push({ label: "Visual NG", key: "Visual_NG", isStation: false, isPercent: false, showZero: true });
                rows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
                rows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });
            }

            const startRow = currentRowIndex;
            const endRow = startRow + rows.length - 1;
            for (let col = 0; col <= 3; col++) {
                merges.push({ s: { r: startRow, c: col }, e: { r: endRow, c: col } });
            }

            rows.forEach((r) => {
                const rowData: unknown[] = [
                    `${group.type}-ALL`,
                    group.modelTypesArr,
                    group.modelNamesArr,
                    group.processesArr,
                    r.label
                ];

                daysArray.forEach(day => {
                    const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
                    const dData = group.summaryData[dateKey];
                    let val = undefined;
                    
                    if (dData) {
                        if (r.isStation) val = dData.stations[r.key];
                        else val = dData[r.key as "Total_Output" | "All" | "Visual_NG" | "Over_Reject" | "Over_Reject_Percent"];
                    }

                    const isFuture = dayjs(dateKey).isAfter(dayjs(), 'day');
                    const hasProduction = dData && dData.has_production;

                    let cellVal: CellValue = "";
                    if (isFuture || !hasProduction) {
                         cellVal = "";
                    } else if (val === "-") {
                         cellVal = "-";
                    } else if (val === 0 || val === "0.00") {
                         cellVal = r.showZero ? (r.isPercent ? "0%" : 0) : "";
                    } else if (val !== undefined && val !== null && val !== "") {
                         cellVal = r.isPercent ? `${Number(val).toFixed(2)}%` : parseFloat(Number(val).toFixed(2));
                    }
                    rowData.push(cellVal);
                });

                const totalVal = getRowTotal(group.summaryData, r.key, r.isStation);
                rowData.push(renderCell(totalVal, r.isPercent, r.showZero));
                wsData.push(rowData);
                currentRowIndex++;
            });

        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!merges'] = merges; // Apply merges

        // 3. Apply Styles to All Cells
        const range = XLSX.utils.decode_range(ws['!ref']!);

        const borderStyle = {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } }
        };

        const centerStyle = {
            alignment: { vertical: "center", horizontal: "center" },
            border: borderStyle
        };

        const leftStyle = {
            alignment: { vertical: "center", horizontal: "left" },
            border: borderStyle
        };

        const headerStyle = {
            font: { bold: true },
            alignment: { vertical: "center", horizontal: "center" },
            border: borderStyle,
            fill: { fgColor: { rgb: "F8F9FA" } }
        };

        const summaryLabelStyle = {
            font: { bold: true, sz: 12 },
            alignment: { vertical: "center", horizontal: "left" }
        };

        const summaryValueStyle = {
            font: { sz: 12 },
            alignment: { vertical: "center", horizontal: "left" }
        };

        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[cellRef]) ws[cellRef] = { v: "", t: "s" }; // Ensure cell exists

                // Summary Rows (0-3)
                if (R < 4) {
                    if (C === 0) {
                        ws[cellRef].s = summaryLabelStyle;
                    } else if (C === 1) {
                        ws[cellRef].s = summaryValueStyle;
                    }
                }
                // Header Row (4)
                else if (R === 4) {
                    ws[cellRef].s = headerStyle;
                }
                // Data Label Column (Col 4)
                else if (C === 4) {
                    ws[cellRef].s = leftStyle;
                }
                // All other cells
                else {
                    if (typeof ws[cellRef].v === 'number') {
                        const isInteger = Number.isInteger(ws[cellRef].v);
                        ws[cellRef].s = {
                            ...centerStyle,
                            numFmt: isInteger ? "#,##0" : "#,##0.00"
                        };
                    } else {
                        ws[cellRef].s = centerStyle;
                    }
                }
            }
        }

        // Set Column Widths
        const wscols = [
            { wch: 15 }, // Machine
            { wch: 15 }, // Model Type
            { wch: 20 }, // Model Name
            { wch: 15 }, // Process
            { wch: 40 }, // Data Label
            ...daysArray.map(() => ({ wch: 8 })), // Days
            { wch: 10 } // Total
        ];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, "Machine NG Report");
        XLSX.writeFile(wb, `Machine_NG_Report_${selectedMonth}.xlsx`);
    };

    // ==========================
    // 🔸 Row Total Calculator
    // ==========================
    const getRowTotal = (dailyData: Record<string, NgDailyData>, key: string, isStation: boolean, ngMode: string = "visual_ng") => {
        let sumOutput = 0;
        let sumReject = 0;
        let sum = 0;

        daysArray.forEach(day => {
            const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
            const data = dailyData[dateKey];
            if (!data) return;

            // For Over_Reject_Percent denominator: ABR uses Machine_Output, others use Total_Output
            const outputField = ngMode === "over_reject" ? "Machine_Output" : "Total_Output";
            const outActual = data[outputField];
            if (outActual && !isNaN(Number(outActual))) sumOutput += Number(outActual);
            
            const overReject = data["Over_Reject"];
            if (overReject && !isNaN(Number(overReject))) sumReject += Number(overReject);

            const val = isStation ? (data.stations ? data.stations[key] : undefined) : data[key];
            if (val !== undefined && val !== null && val !== "" && val !== "-") {
                const num = Number(val);
                if (!isNaN(num)) sum += num;
            }
        });

        if (key === "Over_Reject_Percent") {
            return sumOutput > 0 ? (sumReject / sumOutput) * 100 : 0;
        }

        return sum > 0 ? sum : "-";
    };

    // ==========================
    // 🔸 Render Helpers
    // ==========================
    const daysInMonth = dayjs(selectedMonth).daysInMonth();
    const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Check if selected month is current month
    const isCurrentMonth = dayjs(selectedMonth).format("YYYY-MM") === dayjs().format("YYYY-MM");
    const currentDay = dayjs().date();

    // Helper: Check if a specific day is a future day (not yet reached)
    const isFutureDay = (day: number): boolean => {
        if (!isCurrentMonth) return false; // Past/future months: all days are valid
        return day > currentDay;
    };

    // Helper: Check if a specific day is a holiday for a machine
    const isHoliday = (machine: Pick<MachineNgReport, "holidays">, day: number): boolean => {
        const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
        return machine.holidays?.includes(dateKey) || false;
    };

    const renderCell = (val: CellValue, isPercent: boolean = false, showZero: boolean = false) => {
        if (val === undefined || val === null) return "\u00A0";
        if (typeof val === "string" && val === "-") return "-"; // Handle manual visual ng case
        if (val === 0 && !showZero) return "\u00A0";
        if (isPercent) return `${Number(val).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}%`;
        return Number(val).toLocaleString("en-US");
    };

    return (
        <div className="content">
            <div className="card mt-3">
                <div className="card-header d-flex align-items-center" style={{ background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)", borderBottom: "1px solid #e0e0e0", position: "sticky", top: 0, zIndex: 1020 }}>
                    <div className="d-flex align-items-center" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                        <i className="fas fa-exclamation-triangle me-2 text-danger"></i>
                        <span>Machine NG Report</span>
                    </div>
                    <div className="d-flex gap-3 ms-auto text-end">
                        {socketConnected && (
                            <div className="d-flex align-items-center">
                                <span className="badge bg-success d-flex align-items-center" style={{ fontSize: "0.75rem" }}>
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", display: "inline-block", marginRight: 4 }}></span>
                                    Live {serverTimeStr}
                                </span>
                            </div>
                        )}
                        <span className="fw-semibold me-2">Filter By:</span>
                        <div>
                            {/* <small className="fw-bold d-block mb-1">Area</small> */}
                            <select className="form-select form-select-sm" value={selectedArea} onChange={(e) => handleAreaChange(e.target.value)}>
                                {/* <option value="all">All Area</option> */}
                                {areas.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                        </div>
                        <div>
                            {/* <small className="fw-bold d-block mb-1">Machine Type</small> */}
                            <select className="form-select form-select-sm" value={selectedType} onChange={(e) => handleTypeChange(e.target.value)}>
                                {/* <option value="all">All Type</option> */}
                                {types.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            {/* <small className="fw-bold d-block mb-1">Month</small> */}
                            <input type="month" className="form-control form-control-sm" value={selectedMonth} onChange={(e) => handleMonthChange(e.target.value)} />
                        </div>
                        <div>
                            <button className="btn btn-success btn-sm" onClick={handleExport}>
                                <i className="fas fa-file-excel me-1"></i> Export Excel
                            </button>
                        </div>
                        <div className="d-flex align-items-center" style={{ fontSize: "0.85rem", color: "#666", minWidth: "120px" }}>
                            <i className="fas fa-sync-alt me-1" style={{ fontSize: "0.75rem" }}></i>
                            <span>Refresh: {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="card-body p-0">
                {loading ? (
                    <LoadingSpinner message="Loading NG Report..." />
                ) : (
                    // 🆕 Unified Sticky Table Layout
                    <div className="table-wrapper" style={{ overflowX: "auto", overflowY: "auto", height: "calc(100vh - 140px)", border: "1px solid #dee2e6", background: "white" }}>
                        <table className="table table-bordered table-sm text-center align-middle mb-0" style={{ fontSize: "0.8rem", width: "max-content", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
                            <thead className="table-light" style={{ position: "sticky", top: 0, zIndex: 100 }}>
                                <tr>
                                    {/* Sticky Left Headers */}
                                    <th style={{ position: "sticky", left: 0, top: 0, minWidth: "100px", width: "100px", maxWidth: "100px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000", textAlign: "center", verticalAlign: "middle", zIndex: 110 }}>Machine No</th>
                                    <th style={{ position: "sticky", left: "100px", top: 0, minWidth: "100px", width: "100px", maxWidth: "100px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000", zIndex: 110 }}>Model Type</th>
                                    <th style={{ position: "sticky", left: "200px", top: 0, minWidth: "120px", width: "120px", maxWidth: "120px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000", zIndex: 110 }}>Model Name</th>
                                    <th style={{ position: "sticky", left: "320px", top: 0, minWidth: "80px", width: "80px", maxWidth: "80px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000", zIndex: 110 }}>Process</th>
                                    <th style={{ position: "sticky", left: "400px", top: 0, minWidth: "200px", whiteSpace: "nowrap", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000", zIndex: 110, boxShadow: "2px 0 5px rgba(0,0,0,0.1)" }}>Data</th>
                                    
                                    {/* Scrollable Right Headers */}
                                    {daysArray.map(d => (
                                        <th key={d} style={{ minWidth: "60px", width: "60px", maxWidth: "60px", height: "40px", background: "#f8f9fa", borderBottom: "3px double #000", zIndex: 100 }}>{d}-{dayjs(selectedMonth).format("MMM")}</th>
                                    ))}
                                    <th style={{ minWidth: "80px", width: "80px", maxWidth: "80px", height: "40px", background: "#fff3cd", borderBottom: "3px double #000", borderLeft: "2px solid #ccc", zIndex: 100 }}>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groupedReportData.map((group, gIdx) => {
                                    const rows: { label: string; key: string; isStation: boolean; isPercent: boolean, showZero: boolean }[] = [];
                                    group.stations.forEach((st: string) => rows.push({ label: st, key: st, isStation: true, isPercent: false, showZero: false }));
                                    if (group.ng_mode === "over_reject") {
                                        rows.push({ label: "Machine Output", key: "Machine_Output", isStation: false, isPercent: false, showZero: true });
                                        rows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
                                        rows.push({ label: "NG Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
                                        rows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
                                        rows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });
                                    } else {
                                        rows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
                                        rows.push({ label: "NG Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
                                        rows.push({ label: "Visual NG", key: "Visual_NG", isStation: false, isPercent: false, showZero: true });
                                        rows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
                                        rows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });
                                    }

                                    return (
                                        <React.Fragment key={`group-${group.type}-${gIdx}`}>
                                            {/* Machines in Group */}
                                            {group.machines.map((machine) => {
                                                const { machine_name, model_info, dailyData, stations } = machine;
                                                const machineNgMode = machine.ng_mode || "visual_ng";
                                                const mRows: { label: string; key: string; isStation: boolean; isPercent: boolean, showZero: boolean }[] = [];
                                                stations.forEach((st: string) => mRows.push({ label: st, key: st, isStation: true, isPercent: false, showZero: false }));
                                                if (machineNgMode === "over_reject") {
                                                    mRows.push({ label: "Machine Output", key: "Machine_Output", isStation: false, isPercent: false, showZero: true });
                                                    mRows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
                                                    mRows.push({ label: "NG Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
                                                    mRows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
                                                    mRows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });
                                                } else {
                                                    mRows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
                                                    mRows.push({ label: "NG Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
                                                    mRows.push({ label: "Visual NG", key: "Visual_NG", isStation: false, isPercent: false, showZero: true });
                                                    mRows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
                                                    mRows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });
                                                }

                                                return mRows.map((row, rIdx) => {
                                                    const isLastRow = rIdx === mRows.length - 1;
                                                    const borderBottomStyle = isLastRow ? "2px solid #333" : "1px solid #dee2e6";
                                                    const rowStyle = { height: "30px", lineHeight: "30px" };

                                                    return (
                                                        <tr key={`${machine_name}-${rIdx}`} style={rowStyle}>
                                                            {/* Sticky Left Cells */}
                                                            {rIdx === 0 && (
                                                                <>
                                                                    <td rowSpan={mRows.length} style={{ position: "sticky", left: 0, zIndex: 50, background: "white", fontWeight: "bold", borderRight: "2px solid #000", borderBottom: "2px solid #333", verticalAlign: "middle", padding: "0 8px" }}>{machine_name}</td>
                                                                    <td rowSpan={mRows.length} style={{ position: "sticky", left: "100px", zIndex: 50, background: "white", borderRight: "2px solid #000", borderBottom: "2px solid #333", verticalAlign: "middle", padding: "0 8px" }}>{model_info.model_type}</td>
                                                                    <td rowSpan={mRows.length} style={{ position: "sticky", left: "200px", zIndex: 50, background: "white", borderRight: "2px solid #000", borderBottom: "2px solid #333", verticalAlign: "middle", padding: "0 8px", wordBreak: "break-word", fontSize: "0.75rem", lineHeight: "1.2" }}>{model_info.model_name}</td>
                                                                    <td rowSpan={mRows.length} style={{ position: "sticky", left: "320px", zIndex: 50, background: "white", borderRight: "2px solid #000", borderBottom: "2px solid #333", verticalAlign: "middle", padding: "0 8px" }}>{model_info.process_name}</td>
                                                                </>
                                                            )}
                                                            <td style={{ position: "sticky", left: "400px", zIndex: 50, textAlign: "left", paddingLeft: "10px", borderRight: "2px solid #000", borderBottom: borderBottomStyle, fontWeight: "500", background: "#fcfcfc", height: "30px", boxSizing: "border-box", padding: "0 10px", boxShadow: "2px 0 5px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}>{row.label}</td>

                                                            {/* Scrollable Right Cells */}
                                                            {daysArray.map(day => {
                                                                const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
                                                                const dData = dailyData[dateKey];
                                                                let val = undefined;
                                                                
                                                                if (dData) {
                                                                    if (row.isStation) val = dData.stations[row.key];
                                                                    else val = dData[row.key as "Machine_Output" | "Total_Output" | "All" | "Visual_NG" | "Over_Reject" | "Over_Reject_Percent"];
                                                                }

                                                                const dayEmpty = isDayEmpty(dailyData, day, selectedMonth);
                                                                const futureDay = isFutureDay(day);
                                                                const holiday = isHoliday(machine, day);

                                                                const cellStyle: React.CSSProperties = {
                                                                    borderBottom: borderBottomStyle,
                                                                    height: "30px",
                                                                    boxSizing: "border-box",
                                                                    padding: "0 4px",
                                                                    whiteSpace: "nowrap",
                                                                    ...(futureDay ? {} : holiday ? { backgroundColor: "#ffcccc" } : dayEmpty ? { backgroundColor: "#ffcccc" } : {})
                                                                };

                                                                const isManualToday = machine.oee_mode !== "auto" && dateKey === dayjs.utc().format("YYYY-MM-DD");
                                                                const hideNgFields = isManualToday && ["Visual_NG", "Over_Reject", "Over_Reject_Percent"].includes(row.key);
                                                                const hasProduction = dData && dData.has_production;

                                                                let cellContent: string | React.ReactNode;
                                                                if (futureDay) {
                                                                    cellContent = "\u00A0";
                                                                } else if (!hasProduction) {
                                                                    cellContent = "-";
                                                                } else if (hideNgFields || val === "-") {
                                                                    cellContent = "-";
                                                                } else if (val === 0 || val === "0.00") {
                                                                    cellContent = row.showZero ? (row.isPercent ? "0%" : "0") : "-";
                                                                } else if (val !== undefined && val !== null && val !== "") {
                                                                    cellContent = renderCell(val, row.isPercent, row.showZero);
                                                                } else {
                                                                    cellContent = "-";
                                                                }

                                                                return (
                                                                    <td key={`${machine_name}-${row.key}-${day}`} style={cellStyle}>
                                                                        {cellContent}
                                                                    </td>
                                                                );
                                                            })}
                                                            <td style={{ borderBottom: borderBottomStyle, height: "30px", boxSizing: "border-box", padding: "0 4px", background: "#fff3cd", fontWeight: "bold", borderLeft: "2px solid #ccc", whiteSpace: "nowrap" }}>
                                                                {renderCell(getRowTotal(dailyData, row.key, row.isStation, machineNgMode), row.isPercent, row.showZero)}
                                                            </td>
                                                        </tr>
                                                    );
                                                });
                                            })}

                                            {/* Group Summary Row */}
                                            {rows.map((row, rIdx) => {
                                                const isLastRow = rIdx === rows.length - 1;
                                                const borderBottomStyle = isLastRow ? "3px double #000" : "1px solid #ffd966"; 
                                                const rowStyle = { height: "30px", lineHeight: "30px" };

                                                return (
                                                    <tr key={`summary-${group.type}-${row.key}`} style={rowStyle}>
                                                        {rIdx === 0 && (
                                                            <>
                                                                <td rowSpan={rows.length} style={{ position: "sticky", left: 0, zIndex: 50, background: "#fff2cc", fontWeight: "bold", borderRight: "2px solid #000", borderBottom: "3px double #000", verticalAlign: "middle", padding: "0 8px" }}>{group.type}-ALL</td>
                                                                <td rowSpan={rows.length} style={{ position: "sticky", left: "100px", zIndex: 50, background: "#fff2cc", borderRight: "2px solid #000", borderBottom: "3px double #000", verticalAlign: "middle", padding: "0 8px" }}>{group.modelTypesArr}</td>
                                                                <td rowSpan={rows.length} style={{ position: "sticky", left: "200px", zIndex: 50, background: "#fff2cc", borderRight: "2px solid #000", borderBottom: "3px double #000", verticalAlign: "middle", padding: "0 8px", wordBreak: "break-word", fontSize: "0.75rem", lineHeight: "1.2" }}>{group.modelNamesArr}</td>
                                                                <td rowSpan={rows.length} style={{ position: "sticky", left: "320px", zIndex: 50, background: "#fff2cc", borderRight: "2px solid #000", borderBottom: "3px double #000", verticalAlign: "middle", padding: "0 8px", fontSize: "0.75rem", lineHeight: "1.2" }}>{group.processesArr}</td>
                                                            </>
                                                        )}
                                                        <td style={{ position: "sticky", left: "400px", zIndex: 50, textAlign: "left", paddingLeft: "10px", borderRight: "2px solid #000", borderBottom: borderBottomStyle, fontWeight: "bold", background: "#fff2cc", color: "#b98300", height: "30px", boxSizing: "border-box", padding: "0 10px", boxShadow: "2px 0 5px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}>{row.label}</td>

                                                        {daysArray.map(day => {
                                                            const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
                                                            const dData = group.summaryData[dateKey];
                                                            let val = undefined;
                                                            
                                                            if (dData) {
                                                                if (row.isStation) val = dData.stations[row.key];
                                                                else val = dData[row.key as "Machine_Output" | "Total_Output" | "All" | "Visual_NG" | "Over_Reject" | "Over_Reject_Percent"];
                                                            }

                                                            const futureDay = isFutureDay(day);
                                                            const hasProduction = dData && dData.has_production;

                                                            let cellContent: string | React.ReactNode;
                                                            if (futureDay) {
                                                                cellContent = "\u00A0";
                                                            } else if (!hasProduction) {
                                                                cellContent = "-";
                                                            } else if (val === "-") {
                                                                cellContent = "-";
                                                            } else if (val === 0 || val === "0.00") {
                                                                cellContent = row.showZero ? (row.isPercent ? "0%" : "0") : "-";
                                                            } else if (val !== undefined && val !== null && val !== "") {
                                                                cellContent = renderCell(val, row.isPercent, row.showZero);
                                                            } else {
                                                                cellContent = "-";
                                                            }

                                                            const cellStyle: React.CSSProperties = {
                                                                borderBottom: borderBottomStyle,
                                                                height: "30px",
                                                                boxSizing: "border-box",
                                                                padding: "0 4px",
                                                                background: "#fff9e6",
                                                                color: "#b98300",
                                                                fontWeight: "bold",
                                                                whiteSpace: "nowrap"
                                                            };
                                                            return (
                                                                <td key={`summary-${group.type}-${row.key}-${day}`} style={cellStyle}>
                                                                    {cellContent}
                                                                </td>
                                                            );
                                                        })}
                                                        <td style={{ borderBottom: borderBottomStyle, height: "30px", boxSizing: "border-box", padding: "0 4px", background: "#ffeeba", color: "#b98300", fontWeight: "bold", borderLeft: "2px solid #ccc", whiteSpace: "nowrap" }}>
                                                            {renderCell(getRowTotal(group.summaryData, row.key, row.isStation, group.ng_mode), row.isPercent, row.showZero)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })}
                                {groupedReportData.length === 0 && (
                                    <tr><td colSpan={daysArray.length + 6} className="text-center p-4 text-muted" style={{ height: "100px" }}>No Data</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

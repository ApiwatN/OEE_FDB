"use client";
import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import * as XLSX from "xlsx-js-style";
import { io as socketIO } from "socket.io-client";
import config from "@/app/config";

export default function MachineNgPage() {
    return (
        <Suspense fallback={<div>Loading Report...</div>}>
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
    const searchParams = useSearchParams();
    const leftTableRef = useRef<HTMLDivElement>(null);
    const rightTableRef = useRef<HTMLDivElement>(null);
    const horizontalScrollRef = useRef<HTMLDivElement>(null);

    // ==========================
    // 🔹 State & Filters
    // ==========================
    const [areas, setAreas] = useState<string[]>([]);
    const [types, setTypes] = useState<string[]>([]);

    // Default Month: Current Month
    const [selectedMonth, setSelectedMonth] = useState(dayjs().format("YYYY-MM"));

    const [selectedArea, setSelectedArea] = useState("all");
    const [selectedType, setSelectedType] = useState("all");

    const [reportData, setReportData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [countdown, setCountdown] = useState(5 * 60); // 5 minutes in seconds
    const [serverTimeStr, setServerTimeStr] = useState("");
    const [socketConnected, setSocketConnected] = useState(false);

    // 🆕 Scrollbar width sync
    const [tableScrollWidth, setTableScrollWidth] = useState<number | string>("100%");
    const [leftTableWidth, setLeftTableWidth] = useState<number | string>("550px");
    
    useEffect(() => {
        const updateWidth = () => {
            if (rightTableRef.current) {
                setTableScrollWidth(rightTableRef.current.scrollWidth);
            }
            if (leftTableRef.current) {
                setLeftTableWidth(`${leftTableRef.current.offsetWidth}px`);
            }
        };
        const timer = setTimeout(updateWidth, 100);
        window.addEventListener("resize", updateWidth);
        return () => {
            clearTimeout(timer);
            window.removeEventListener("resize", updateWidth);
        };
    }, [reportData, selectedMonth]);

    // ==========================
    // 🔸 Init
    // ==========================
    useEffect(() => {
        const init = async () => {
            await fetchAreas();

            // Load Filters from LocalStorage
            const localArea = localStorage.getItem("report_filter_area");
            const localType = localStorage.getItem("report_filter_type");

            const targetArea = localArea && localArea !== "all" ? localArea : "all";
            const targetType = localType && localType !== "all" ? localType : "all";

            setSelectedArea(targetArea);
            setSelectedType(targetType);

            if (targetArea !== "all") {
                await fetchTypes(targetArea);
            }

            // Fetch Report
            await fetchReport(selectedMonth, targetArea, targetType);
        };
        init();
    }, []);

    // ==========================
    // 🔸 Auto Refresh (every 5 minutes) with Countdown
    // ==========================
    useEffect(() => {
        const REFRESH_INTERVAL = 5 * 60; // 5 minutes in seconds
        setCountdown(REFRESH_INTERVAL); // Reset countdown when filters change

        // Countdown timer (every 1 second)
        const countdownId = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    // Time to refresh — silent merge to avoid blink
                    console.log("[Auto Refresh] Silent merge refresh...");
                    fetchReportSilent(selectedMonth, selectedArea, selectedType);
                    return REFRESH_INTERVAL; // Reset countdown
                }
                return prev - 1;
            });
        }, 1000);

        // Cleanup interval on unmount
        return () => clearInterval(countdownId);
    }, [selectedMonth, selectedArea, selectedType]);

    // ==========================
    // 🔸 Socket.IO Real-time (output, eff, ct, availability, performance)
    // ==========================
    useEffect(() => {
        const socket = socketIO(config.apiServer, { transports: ["websocket", "polling"] });

        socket.on("connect", () => {
            setSocketConnected(true);
            // 🏠 Join dashboard room (ดูทุกเครื่อง)
            socket.emit("joinRoom", "dashboard");
        });
        socket.on("disconnect", () => setSocketConnected(false));

        // Clock
        socket.on("server_time", (isoStr: string) => {
            const t = new Date(isoStr);
            setServerTimeStr(t.toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Bangkok" }));
        });

        // Fast production update ทุก 2 วินาที — Output, Eff, CT
        // We might not need this for NG report, but it's good to keep structure similar if we needed it

        // Slow status update ทุก 5 นาที — Availability, Performance, Quality, OEE
        socket.on("realtime_update", (data: any) => {
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
                    if (!isAuto) return machine; // Only update Auto mode

                    const updatedDailyData = { ...machine.dailyData };
                    const existing = updatedDailyData[shiftDate] || {};
                    
                    const visualNg = socketData.daily.ngQty ?? 0;
                    const allQty = existing.All || 0;
                    
                    // Update Total Output from realtime socket
                    const totalOutput = socketData.daily.totalOutput ?? (existing.Total_Output !== "-" ? existing.Total_Output : 0);
                    
                    const overReject = Math.max(0, allQty - visualNg);
                    const overRejectPercent = totalOutput > 0 ? parseFloat(((overReject / totalOutput) * 100).toFixed(2)) : 0;

                    updatedDailyData[shiftDate] = {
                        ...existing,
                        has_production: existing.has_production ?? true,
                        Total_Output: totalOutput,
                        Visual_NG: visualNg,
                        Over_Reject: overReject,
                        Over_Reject_Percent: overRejectPercent
                    };

                    return { ...machine, dailyData: updatedDailyData };
                });
            });
        });

        return () => {
            socket.off("server_time");
            socket.off("realtime_update");
            socket.disconnect();
        };
    }, [selectedMonth]);

    // ==========================
    // 🔸 API Calls
    // ==========================
    const fetchAreas = async () => {
        try { const res = await axios.get(`${config.apiServer}/api/machine/listArea`); setAreas(res.data.results.map((r: any) => r.machine_area)); } catch (e) { console.error(e); }
    };
    const fetchTypes = async (area: string) => {
        try { if (area === "all" || !area) { setTypes([]); return; } const res = await axios.get(`${config.apiServer}/api/machine/listType/${area}`); setTypes(res.data.results); } catch (e) { console.error(e); }
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
            const fresh: any[] = res.data.results || [];
            const freshMap = new Map(fresh.map((m: any) => [m.machine_name, m]));
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
        setSelectedType("all");
        localStorage.setItem("report_filter_area", area);
        localStorage.setItem("report_filter_type", "all");

        await fetchTypes(area);
        await fetchReport(selectedMonth, area, "all");
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

    const handleExport = () => {
        if (!reportData || reportData.length === 0) return;

        const wb = XLSX.utils.book_new();
        const wsData: any[][] = [];
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

        reportData.forEach((machine) => {
            const { machine_name, model_info, dailyData, stations } = machine;
            
            // Generate dynamic rows based on stations + standard fields
            const rows: { label: string; key: string; isStation: boolean; isPercent: boolean, showZero: boolean }[] = [];
            stations.forEach((st: string) => rows.push({ label: st, key: st, isStation: true, isPercent: false, showZero: false }));
            rows.push({ label: "Total Output", key: "Total_Output", isStation: false, isPercent: false, showZero: true });
            rows.push({ label: "Total (All Station)", key: "All", isStation: false, isPercent: false, showZero: false });
            rows.push({ label: "Visual NG", key: "Visual_NG", isStation: false, isPercent: false, showZero: true });
            rows.push({ label: "Over Reject", key: "Over_Reject", isStation: false, isPercent: false, showZero: true });
            rows.push({ label: "Over Reject %", key: "Over_Reject_Percent", isStation: false, isPercent: true, showZero: true });

            // Merge Info Columns for this Machine Block
            const startRow = currentRowIndex;
            const endRow = startRow + rows.length - 1;

            // Merge Cols 0, 1, 2, 3 (Machine, Model Type, Model Name, Process)
            for (let col = 0; col <= 3; col++) {
                merges.push({ s: { r: startRow, c: col }, e: { r: endRow, c: col } });
            }

            rows.forEach((r) => {
                const rowData: any[] = [
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

                    let cellVal: any = "";
                    
                    if (isFuture) {
                         cellVal = "";
                    } else if (!hasProduction) {
                         cellVal = "";
                    } else if (hideNgFields) {
                         cellVal = "-";
                    } else if (val === "-") {
                         cellVal = "-";
                    } else if (val === 0 || val === "0.00") {
                         cellVal = r.showZero ? (r.isPercent ? "0%" : 0) : "";
                    } else if (val !== undefined && val !== null && val !== "") {
                        if (r.isPercent) {
                            cellVal = `${val}%`;
                        } else {
                            cellVal = val;
                        }
                    }

                    rowData.push(cellVal);
                });

                // Add Total Column to Export
                const totalVal = getRowTotal(dailyData, r.key, r.isStation);
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
                            numFmt: isInteger ? "#,##0" : "#,##0.##"
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
    const getRowTotal = (dailyData: any, key: string, isStation: boolean) => {
        let sumOutput = 0;
        let sumReject = 0;
        let sum = 0;

        daysArray.forEach(day => {
            const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
            const data = dailyData[dateKey];
            if (!data) return;

            // Calculate overall parts for Over Reject %
            const outActual = data["Total_Output"];
            if (outActual && !isNaN(Number(outActual))) sumOutput += Number(outActual);
            
            const overReject = data["Over_Reject"];
            if (overReject && !isNaN(Number(overReject))) sumReject += Number(overReject);

            let val = isStation ? (data.stations ? data.stations[key] : undefined) : data[key];
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
    const isHoliday = (machine: any, day: number): boolean => {
        const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
        return machine.holidays?.includes(dateKey) || false;
    };

    // Helper: Check if a specific day has NO data 
    const isDayEmpty = (dailyData: Record<string, any>, day: number): boolean => {
        const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
        const data = dailyData[dateKey];
        if (!data) return true;
        // ✅ Bug 1 Fix: use has_production flag set by backend
        return !data.has_production;
    };

    const renderCell = (val: any, isPercent: boolean = false, showZero: boolean = false) => {
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
                                <option value="all">All Area</option>
                                {areas.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                        </div>
                        <div>
                            {/* <small className="fw-bold d-block mb-1">Machine Type</small> */}
                            <select className="form-select form-select-sm" value={selectedType} onChange={(e) => handleTypeChange(e.target.value)}>
                                <option value="all">All Type</option>
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
                    <div className="text-center p-5"><div className="spinner-border text-primary"></div></div>
                ) : (
                    // 🆕 Split Table Layout - Outer wrapper handles vertical scroll
                    <div className="table-outer-wrapper" style={{ overflow: "hidden", border: "1px solid #dee2e6", height: "calc(100vh - 140px)", display: "flex", flexDirection: "column" }}>
                        <div className="table-wrapper" style={{ display: "grid", gridTemplateColumns: "auto 1fr", flex: 1, overflow: "hidden" }}>

                            {/* 🔹 Fixed Left Table */}
                            <div ref={leftTableRef} className="fixed-table" style={{ overflowY: "hidden", overflowX: "hidden", background: "white", zIndex: 2, boxShadow: "2px 0 5px rgba(0,0,0,0.1)", height: "100%" }} onWheel={(e) => {
                                if (rightTableRef.current) {
                                    rightTableRef.current.scrollTop += e.deltaY;
                                }
                            }}>
                                <table className="table table-bordered table-sm text-center align-middle mb-0" style={{ fontSize: "0.8rem", width: "max-content", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
                                    <thead className="table-light" style={{ position: "sticky", top: 0, zIndex: 10 }}>
                                        <tr>
                                            <th style={{ minWidth: "100px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000", textAlign: "center", verticalAlign: "middle" }}>Machine No</th>
                                            <th style={{ minWidth: "100px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000" }}>Model Type</th>
                                            <th style={{ minWidth: "120px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000" }}>Model Name</th>
                                            <th style={{ minWidth: "80px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000" }}>Process</th>
                                            <th style={{ minWidth: "150px", height: "40px", background: "#f8f9fa", borderRight: "2px solid #000", borderBottom: "3px double #000" }}>Data</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                            {reportData.map((machine, idx) => {
                                            const { machine_name, model_info, stations } = machine;
                                            
                                            // Generate dynamic rows based on stations + standard fields
                                            const rows = [];
                                            stations.forEach((st: string) => rows.push({ label: st, key: st }));
                                            rows.push({ label: "Total Output" });
                                            rows.push({ label: "Total (All Station)" });
                                            rows.push({ label: "Visual NG" });
                                            rows.push({ label: "Over Reject" });
                                            rows.push({ label: "Over Reject %" });

                                            return rows.map((row, rIdx) => {
                                                const isLastRow = rIdx === rows.length - 1;
                                                const borderBottomStyle = isLastRow ? "2px solid #333" : "1px solid #dee2e6";
                                                const rowStyle = { height: "30px", lineHeight: "30px" };

                                                return (
                                                    <tr key={`${machine_name}-${rIdx}`} style={rowStyle}>
                                                        {rIdx === 0 && (
                                                            <>
                                                                <td rowSpan={rows.length} style={{ background: "white", fontWeight: "bold", borderRight: "2px solid #000", borderBottom: "2px solid #333", verticalAlign: "middle", padding: "0 8px" }}>{machine_name}</td>
                                                                <td rowSpan={rows.length} style={{ background: "white", borderRight: "2px solid #000", borderBottom: "2px solid #333", verticalAlign: "middle", padding: "0 8px" }}>{model_info.model_type}</td>
                                                                <td rowSpan={rows.length} style={{ background: "white", borderRight: "2px solid #000", borderBottom: "2px solid #333", verticalAlign: "middle", padding: "0 8px", wordBreak: "break-word", fontSize: "0.75rem", lineHeight: "1.2" }}>{model_info.model_name}</td>
                                                                <td rowSpan={rows.length} style={{ background: "white", borderRight: "2px solid #000", borderBottom: "2px solid #333", verticalAlign: "middle", padding: "0 8px" }}>{model_info.process_name}</td>
                                                            </>
                                                        )}
                                                        <td style={{ textAlign: "left", paddingLeft: "10px", borderRight: "2px solid #000", borderBottom: borderBottomStyle, fontWeight: "500", background: "#fcfcfc", height: "30px", boxSizing: "border-box", padding: "0 10px" }}>{row.label}</td>
                                                    </tr>
                                                );
                                            });
                                        })}
                                        {reportData.length === 0 && (
                                            <tr><td colSpan={5} className="text-center p-4 text-muted" style={{ height: "100px" }}>No Data</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* 🔹 Scrollable Right Table */}
                            <div ref={rightTableRef} className="scrollable-table hide-scrollbar" style={{ overflowX: "auto", overflowY: "scroll", height: "100%" }} onScroll={() => {
                                if (leftTableRef.current && rightTableRef.current) {
                                    leftTableRef.current.scrollTop = rightTableRef.current.scrollTop;
                                }
                                if (horizontalScrollRef.current && rightTableRef.current) {
                                    if (horizontalScrollRef.current.scrollLeft !== rightTableRef.current.scrollLeft) {
                                        horizontalScrollRef.current.scrollLeft = rightTableRef.current.scrollLeft;
                                    }
                                }
                            }}>
                                <table className="table table-bordered table-sm text-center align-middle mb-0" style={{ fontSize: "0.8rem", width: "max-content", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
                                    <thead className="table-light" style={{ position: "sticky", top: 0, zIndex: 10 }}>
                                        <tr>
                                            {daysArray.map(d => (
                                                <th key={d} style={{ minWidth: "60px", height: "40px", background: "#f8f9fa", borderBottom: "3px double #000", position: "sticky", top: 0, zIndex: 10 }}>{d}-{dayjs(selectedMonth).format("MMM")}</th>
                                            ))}
                                            <th style={{ minWidth: "80px", height: "40px", background: "#fff3cd", borderBottom: "3px double #000", position: "sticky", top: 0, borderLeft: "2px solid #ccc", zIndex: 10 }}>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reportData.map((machine, idx) => {
                                            const { machine_name, dailyData, stations } = machine;
                                            
                                            const rows = [];
                                            stations.forEach((st: string) => rows.push({ key: st, isStation: true, isPercent: false, showZero: false }));
                                            rows.push({ key: "Total_Output", isPercent: false, showZero: true, isStation: false });
                                            rows.push({ key: "All", isPercent: false, showZero: false, isStation: false });
                                            rows.push({ key: "Visual_NG", isPercent: false, showZero: true, isStation: false });
                                            rows.push({ key: "Over_Reject", isPercent: false, showZero: true, isStation: false });
                                            rows.push({ key: "Over_Reject_Percent", isPercent: true, showZero: true, isStation: false });

                                            return rows.map((row, rIdx) => {
                                                const isLastRow = rIdx === rows.length - 1;
                                                const borderBottomStyle = isLastRow ? "2px solid #333" : "1px solid #dee2e6";
                                                const rowStyle = { height: "30px", lineHeight: "30px" };

                                                return (
                                                    <tr key={`${machine_name}-${row.key}`} style={rowStyle}>
                                                        {daysArray.map(day => {
                                                            const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
                                                            const dData = dailyData[dateKey];
                                                            
                                                            let val = undefined;
                                                            if (dData) {
                                                                if (row.isStation) val = dData.stations[row.key];
                                                                else val = dData[row.key as "Total_Output" | "All" | "Visual_NG" | "Over_Reject" | "Over_Reject_Percent"];
                                                            }

                                                            const dayEmpty = isDayEmpty(dailyData, day);
                                                            const futureDay = isFutureDay(day);
                                                            const holiday = isHoliday(machine, day);

                                                            // Determine cell background
                                                            const cellStyle: React.CSSProperties = {
                                                                borderBottom: borderBottomStyle,
                                                                height: "30px",
                                                                boxSizing: "border-box",
                                                                padding: "0 4px",
                                                                ...(futureDay
                                                                    ? {}
                                                                    : holiday
                                                                        ? { backgroundColor: "#ffcccc" }  // Holiday: light red
                                                                        : dayEmpty
                                                                            ? { backgroundColor: "#ffcccc" }  // No data: red
                                                                            : {})
                                                            };

                                                            // Manual mode + วัน UTC ปัจจุบัน → ซ่อน Visual NG / Over Reject
                                                            const isManualToday = machine.oee_mode !== "auto"
                                                                && dateKey === dayjs.utc().format("YYYY-MM-DD");
                                                            const hideNgFields = isManualToday
                                                                && ["Visual_NG", "Over_Reject", "Over_Reject_Percent"].includes(row.key);

                                                            // Determine cell content
                                                            let cellContent: string;
                                                            if (futureDay) {
                                                                cellContent = "\u00A0";
                                                            } else if (hideNgFields) {
                                                                cellContent = "-";
                                                            } else if (holiday) {
                                                                // Holiday: render normally, but replace blank with "-" (not applicable)
                                                                const rendered = renderCell(val, row.isPercent, row.showZero);
                                                                cellContent = rendered === "\u00A0" ? "-" : rendered;
                                                            } else if (dayEmpty) {
                                                                cellContent = "\u00A0";
                                                            } else {
                                                                cellContent = renderCell(val, row.isPercent, row.showZero);
                                                            }

                                                            return (
                                                                <td key={day} style={cellStyle}>
                                                                    {cellContent}
                                                                </td>
                                                            );
                                                        })}
                                                        {/* Total Cell */}
                                                        <td style={{ borderBottom: borderBottomStyle, height: "30px", boxSizing: "border-box", padding: "0 4px", background: "#fff3cd", borderLeft: "2px solid #ccc", fontWeight: "bold" }}>
                                                            {renderCell(getRowTotal(dailyData, row.key, row.isStation || false), row.isPercent, row.showZero)}
                                                        </td>
                                                    </tr>
                                                );
                                            });
                                        })}
                                        {reportData.length === 0 && (
                                            <tr><td colSpan={daysArray.length} className="text-center p-4 text-muted" style={{ height: "100px" }}>No Data</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        {/* 🔹 Horizontal Scrollbar at Bottom */}
                        <div ref={horizontalScrollRef} className="horizontal-scroll-wrapper" style={{ overflowX: "auto", overflowY: "hidden", marginLeft: "auto", width: `calc(100% - ${leftTableWidth})` }} onScroll={() => {
                            if (rightTableRef.current && horizontalScrollRef.current) {
                                if (rightTableRef.current.scrollLeft !== horizontalScrollRef.current.scrollLeft) {
                                    rightTableRef.current.scrollLeft = horizontalScrollRef.current.scrollLeft;
                                }
                            }
                        }}>
                            <div style={{ width: tableScrollWidth, height: "1px" }}></div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

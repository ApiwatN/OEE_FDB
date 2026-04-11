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

export default function Page() {
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
            <MachineReportPage />
        </Suspense>
    );
}

function MachineReportPage() {
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
    
    useEffect(() => {
        const updateWidth = () => {
            if (rightTableRef.current) {
                setTableScrollWidth(rightTableRef.current.scrollWidth);
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
        // ✅ Fix #5: Delta merge — only update machines included in payload
        socket.on("realtime_output", (data: any) => {
            const isCurrentMonth = dayjs(selectedMonth).format("YYYY-MM") === dayjs().format("YYYY-MM");
            if (!isCurrentMonth) return;

            const shiftDate = data?.shiftDate;
            const socketMachines = data?.machines;
            if (!shiftDate || !socketMachines) return;

            setReportData(prev => {
                if (prev.length === 0) return prev;
                return prev.map(machine => {
                    const socketData = socketMachines[machine.machine_name];
                    if (!socketData?.daily) return machine; // Not in delta → keep as-is

                    const updatedDailyData = { ...machine.daily_data };
                    const existing = updatedDailyData[shiftDate] || {};
                    updatedDailyData[shiftDate] = {
                        ...existing,
                        output_actual: socketData.daily.totalOutput,
                        eff_actual: socketData.daily.overallEfficiency,
                        cycle_actual: socketData.daily.avgCycleTime,
                    };

                    return { ...machine, daily_data: updatedDailyData };
                });
            });
        });

        // Slow status update ทุก 5 นาที — Availability, Performance, Quality, OEE (จาก MCStatus)
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
                    const updatedDailyData = { ...machine.daily_data };
                    const existing = updatedDailyData[shiftDate] || {};
                    updatedDailyData[shiftDate] = {
                        ...existing,
                        availability: socketData.daily.availability,
                        performance: socketData.daily.performance,
                        // Auto mode: อัปเดต NG/Quality/OEE realtime
                        ...(isAuto ? {
                            ng_qty: socketData.daily.ngQty ?? 0,
                            quality: socketData.daily.quality,
                            oee: socketData.daily.oee,
                        } : {}),
                    };

                    return { ...machine, daily_data: updatedDailyData };
                });
            });
        });

        return () => {
            socket.off("realtime_update");
            socket.off("realtime_output");
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
            const res = await axios.get(`${config.apiServer}/api/report/machine-report`, {
                params: { month, area, type }
            });
            setReportData(res.data.results || []);
        } catch (e) {
            console.error(e);
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    // Silent Refresh: Merges only daily_data into existing state — avoids full re-render blink
    const fetchReportSilent = async (month: string, area: string, type: string) => {
        try {
            const res = await axios.get(`${config.apiServer}/api/report/machine-report`, {
                params: { month, area, type }
            });
            const fresh: any[] = res.data.results || [];
            const freshMap = new Map(fresh.map((m: any) => [m.machine_name, m]));
            setReportData(prev => prev.map(machine => {
                const updated = freshMap.get(machine.machine_name);
                if (!updated) return machine;
                return { ...machine, daily_data: updated.daily_data };
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
            const { machine_name, model_info, daily_data } = machine;
            const rows = [
                { label: "Output (Target)", key: "output_target", isPercent: false },
                { label: "Output", key: "output_actual", isPercent: false },
                { label: "Efficiency (Target)", key: "eff_target", isPercent: true },
                { label: "Efficiency", key: "eff_actual", isPercent: true },
                { label: "Cycle time (Target)", key: "cycle_target", isPercent: false },
                { label: "Cycle time", key: "cycle_actual", isPercent: false },
                { label: "NG Qty", key: "ng_qty", isPercent: false },
                { label: "Availability", key: "availability", isPercent: true },
                { label: "Performance", key: "performance", isPercent: true },
                { label: "Quality", key: "quality", isPercent: true },
                { label: "OEE", key: "oee", isPercent: true },
            ];

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
                    const val = daily_data[dateKey]?.[r.key];

                    let cellVal: any = "";
                    if (val !== undefined && val !== null && val !== 0) {
                        if (r.isPercent) {
                            cellVal = `${val}%`;
                        } else {
                            cellVal = val;
                        }
                    }
                    rowData.push(cellVal);
                });

                // Add Total Column to Export
                const totalVal = getRowTotal(daily_data, r.key);
                rowData.push(renderCell(totalVal, r.isPercent, r.key === 'ng_qty' ? true : false));

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
            { wch: 20 }, // Data Label
            ...daysArray.map(() => ({ wch: 8 })), // Days
            { wch: 10 } // Total
        ];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, "Machine Report");
        XLSX.writeFile(wb, `Machine_Report_${selectedMonth}.xlsx`);
    };

    // ==========================
    // 🔸 Row Total Calculator
    // ==========================
    const getRowTotal = (daily_data: any, key: string) => {
        let sum = 0;
        let count = 0;
        let latestTarget = 0;

        daysArray.forEach(day => {
            const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
            const data = daily_data[dateKey];
            if (!data) return;
            const val = data[key];
            
            if (val !== undefined && val !== null && val !== "" && val !== "-") {
                const num = Number(val);
                if (!isNaN(num)) {
                    if (key.includes("target")) {
                        if (num > 0) latestTarget = num;
                    } else {
                        sum += num;
                        if (data.has_production || num > 0) {
                            count++;
                        }
                    }
                }
            }
        });

        if (key.includes("target")) {
            return latestTarget > 0 ? latestTarget : "-";
        }
        if (["output_actual", "ng_qty"].includes(key)) {
            return sum > 0 ? sum : "-";
        }
        if (count > 0) {
            return sum / count;
        }
        return "-";
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

    // Helper: Check if a specific day has NO data (output_actual, eff_actual, cycle_actual are all empty/zero)
    const isDayEmpty = (dailyData: Record<string, any>, day: number): boolean => {
        const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
        const data = dailyData[dateKey];
        if (!data) return true;

        const outputActual = data.output_actual;
        const effActual = data.eff_actual;
        const cycleActual = data.cycle_actual;

        const isEmpty = (val: any) => val === undefined || val === null || val === 0 || val === '';

        return isEmpty(outputActual) && isEmpty(effActual) && isEmpty(cycleActual);
    };

    const renderCell = (val: any, isPercent: boolean = false, showZero: boolean = false) => {
        if (val === undefined || val === null) return "\u00A0";
        if (val === 0 && !showZero) return "\u00A0";
        if (isPercent) return `${Number(val).toLocaleString("en-US")}%`;
        return Number(val).toLocaleString("en-US");
    };

    return (
        <div className="content">
            <div className="card mt-3">
                <div className="card-header d-flex align-items-center" style={{ background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)", borderBottom: "1px solid #e0e0e0", position: "sticky", top: 0, zIndex: 1020 }}>
                    <div className="d-flex align-items-center" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                        <i className="fas fa-chart-line me-2 text-primary"></i>
                        <span>Machine Monthly Report</span>
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
                                            const { machine_name, model_info } = machine;
                                            const rows = [
                                                { label: "Output (Target)" }, { label: "Output" },
                                                { label: "Efficiency (Target)" }, { label: "Efficiency" },
                                                { label: "Cycle time (Target)" }, { label: "Cycle time" },
                                                { label: "NG Qty" }, { label: "Availability" },
                                                { label: "Performance" }, { label: "Quality" },
                                                { label: "OEE" }
                                            ];

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
                                            <th style={{ minWidth: "80px", height: "40px", background: "#fff3cd", borderBottom: "3px double #000", position: "sticky", top: 0, borderLeft: "2px solid #ccc", zIndex: 11, right: 0 }}>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reportData.map((machine, idx) => {
                                            const { machine_name, daily_data } = machine;
                                            const rows = [
                                                { key: "output_target", isPercent: false, showZero: false },
                                                { key: "output_actual", isPercent: false, showZero: false },
                                                { key: "eff_target", isPercent: true, showZero: false },
                                                { key: "eff_actual", isPercent: true, showZero: false },
                                                { key: "cycle_target", isPercent: false, showZero: false },
                                                { key: "cycle_actual", isPercent: false, showZero: false },
                                                { key: "ng_qty", isPercent: false, showZero: true },
                                                { key: "availability", isPercent: true, showZero: false },
                                                { key: "performance", isPercent: true, showZero: false },
                                                { key: "quality", isPercent: true, showZero: false },
                                                { key: "oee", isPercent: true, showZero: false },
                                            ];

                                            return rows.map((row, rIdx) => {
                                                const isLastRow = rIdx === rows.length - 1;
                                                const borderBottomStyle = isLastRow ? "2px solid #333" : "1px solid #dee2e6";
                                                const rowStyle = { height: "30px", lineHeight: "30px" };

                                                return (
                                                    <tr key={`${machine_name}-${row.key}`} style={rowStyle}>
                                                        {daysArray.map(day => {
                                                            const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
                                                            const data = daily_data[dateKey];
                                                            const val = data ? data[row.key] : undefined;
                                                            const dayEmpty = isDayEmpty(daily_data, day);
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

                                                            // Manual mode + วัน UTC ปัจจุบัน → ซ่อน NG/Quality/OEE
                                                            const isManualToday = machine.oee_mode !== "auto"
                                                                && dateKey === dayjs.utc().format("YYYY-MM-DD");
                                                            const hideOeeFields = isManualToday
                                                                && ["ng_qty", "quality", "oee"].includes(row.key);

                                                            // Determine cell content
                                                            let cellContent: string;
                                                            if (futureDay) {
                                                                cellContent = "\u00A0";
                                                            } else if (hideOeeFields) {
                                                                cellContent = "-";
                                                            } else if (holiday) {
                                                                // Holiday: only show output_actual if it has a value
                                                                if (row.key === "output_actual" && val && val > 0) {
                                                                    cellContent = renderCell(val, row.isPercent);
                                                                } else {
                                                                    cellContent = "\u00A0";
                                                                }
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
                                                        <td style={{ borderBottom: borderBottomStyle, height: "30px", boxSizing: "border-box", padding: "0 4px", background: "#fff3cd", borderLeft: "2px solid #ccc", fontWeight: "bold", position: "sticky", right: 0, zIndex: 1 }}>
                                                            {renderCell(getRowTotal(daily_data, row.key), row.isPercent, row.key === 'ng_qty' ? true : false)}
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
                        <div ref={horizontalScrollRef} className="horizontal-scroll-wrapper" style={{ overflowX: "auto", overflowY: "hidden", marginLeft: "auto", width: "calc(100% - 550px)" }} onScroll={() => {
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

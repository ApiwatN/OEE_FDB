"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import config from "@/app/config";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    BarController,
    LineElement,
    LineController,
    PointElement,
    Title,
    Tooltip,
    Legend,
    ChartOptions,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import ChartDataLabels from 'chartjs-plugin-datalabels';
import dayjs from "dayjs";

// Register Chart.js components
ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    BarController,
    LineElement,
    LineController,
    PointElement,
    Title,
    Tooltip,
    Legend,
    ChartDataLabels
);

interface OverallMachineCardProps {
    machineName: string;
    date: string;
    scaleFactor?: number;  // Optional, defaults to 1.0

    refreshTrigger?: number; // Optional, to trigger auto-refresh
    realtimeData?: any; // New prop for socket data
    activeView?: "output" | "status"; // Toggle between Output and MC Status
    mcStatusRefreshTrigger?: number; // Trigger MC Status re-fetch from parent
}

// MC Status color mapping (same as machine_working)
const MC_STATUS_COLORS: Record<string, { color: string; label: string }> = {
    Run_Time: { color: "#2ca02c", label: "Run Time" },
    Plan_Stop: { color: "#aec7e8", label: "Plan Stop" },
    Break_Time: { color: "#ffbb78", label: "Break Time" },
    MM_Repair: { color: "#d62728", label: "MM Repair" },
    MM_Check_Master: { color: "#ff7f0e", label: "MM Check Master" },
    MM_Preventive: { color: "#e377c2", label: "MM Preventive" },
    Setter_Adjust: { color: "#9467bd", label: "Setter Adjust" },
    Setter_Check_Master: { color: "#8c564b", label: "Setter Check Master" },
    Setter_Preventive: { color: "#c49c94", label: "Setter Preventive" },
    QC_Quality: { color: "#1f77b4", label: "QC Quality" },
    QC_Check_Master: { color: "#17becf", label: "QC Check Master" },
    Prod_Cleaning: { color: "#bcbd22", label: "Prod Cleaning" },
    Prod_Check_Master: { color: "#98df8a", label: "Prod Check Master" },
    Wait_Part: { color: "#ff9896", label: "Wait Part" },
    MC_Stop: { color: "#7f7f7f", label: "Machine Stop" },
    MC_Alarm: { color: "#c62828", label: "MC Alarm" },
    Cut_Lot: { color: "#dbdb8d", label: "Cut Lot" },
    Signal_Lost: { color: "#2f2f2f", label: "Signal Lost" },
};

export default function OverallMachineCard({ machineName, date, scaleFactor = 1.0, refreshTrigger = 0, realtimeData, activeView = "output", mcStatusRefreshTrigger = 0 }: OverallMachineCardProps) {
    // ================= State Management =================
    const [clientTime, setClientTime] = useState<string>("");
    const [tableData, setTableData] = useState({
        model: "-",
        achieve: 0,
        oee: 0,
        oeeDate: "-",
        operatorName: "-",
        operatorCode: "-",
        operatorPic: "",
        outputActual: 0,
        outputTarget: 0,
        ctActual: 0,
        ctTarget: 0,
        effActual: 0,
        effTarget: 0,
    });

    const [graph1Data, setGraph1Data] = useState<any>(null); // Output Graph
    const [graph2Data, setGraph2Data] = useState<any>(null); // CT & Eff Graph

    // MC Status state
    const [mcStatusData, setMcStatusData] = useState<any[]>([]);
    const mcStatusCanvasRef = useRef<HTMLCanvasElement>(null);
    const mcSegmentsRef = useRef<{ startMin: number; endMin: number; status: string; startTime: string; endTime: string }[]>([]);
    const [mcTooltip, setMcTooltip] = useState<{ visible: boolean; x: number; y: number; status: string; startTime: string; endTime: string; duration: string } | null>(null);
    const [downtimeChartData, setDowntimeChartData] = useState<any>(null);
    const [downtimeDurationMap, setDowntimeDurationMap] = useState<Record<string, number>>({});

    // Multi-Model Support
    const [modelsList, setModelsList] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>("");

    // ✅ Calculate scaled dimensions
    const s = scaleFactor; // Shorthand
    const fontSize = {
        base: `${0.8 * s}rem`,      // Base font (was 0.8rem)
        small: `${0.6 * s}rem`,     // Small text (was 0.6rem)
        tiny: `${0.5 * s}rem`,      // Tiny text (was 0.5rem)
        large: `${1.1 * s}rem`,     // Large text (was 1.1rem)
    };
    const spacing = {
        cardPadding: `${8 * s}px`,
        cellPadding: `${4 * s}px`,
        graphHeight: `${80 * s}px`,
    };

    // Blink toggle for current-hour bar (toggles every 500ms)
    const [blinkOn, setBlinkOn] = useState(true);

    // ================= Effects =================

    // Clock Timer + Blink toggle
    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            const todayStr = dayjs().format("YYYY-MM-DD");

            if (date === todayStr) {
                setClientTime(now.toLocaleTimeString("en-GB", { hour12: false }));
            } else {
                setClientTime(""); // Hide time if not today
            }
        }, 1000);

        // Blink interval for current-hour bar (only when viewing today)
        const blinkInterval = setInterval(() => {
            const todayStr = dayjs().format("YYYY-MM-DD");
            if (date === todayStr) {
                setBlinkOn(prev => !prev);
            }
        }, 700);

        return () => {
            clearInterval(interval);
            clearInterval(blinkInterval);
        };
    }, [date]);

    // REAL-TIME DATA HANDLING
    // REAL-TIME DATA HANDLING
    useEffect(() => {
        // Relaxed date check + Debug log
        const isToday = date === dayjs().format("YYYY-MM-DD");
        if (!realtimeData || !isToday) {
            // if (realtimeData && !isToday) console.warn("Skipping RT update due to date mismatch:", date);
            return;
        }

        const { daily, currentHour } = realtimeData;
        const { hourly } = daily;
        const serverCurrentHourStr = currentHour ? currentHour.hour : null;

        // 1. Update Table Data
        setTableData(prev => ({
            ...prev,
            outputActual: daily.totalOutput,
            outputTarget: daily.accumTarget,
            achieve: daily.achieve,
            ctActual: daily.avgCycleTime,
            effActual: daily.overallEfficiency,
            // ✅ อัปเดต OEE เฉพาะเมื่อ > 0 (Auto mode) — Manual ได้ 0 จะไม่ทับค่าเดิม
            ...(daily.oee > 0 ? { oee: daily.oee } : {}),
        }));

        // Helper to replicate filter logic using SERVER TIME
        const filterFutureDataInternal = (dataArray: number[], labels: any[], currentHourStr: string | null) => {
            if (!labels || !currentHourStr) return dataArray;

            // Parse server hour (e.g. "16")
            const currentHourInt = parseInt(currentHourStr);
            const currentIndex = labels.findIndex((h: string) => parseInt(h) === currentHourInt);

            if (currentIndex === -1) return dataArray;
            return dataArray.map((val, index) => index > currentIndex ? null : val);
        };

        // 2. Update Graph 1
        setGraph1Data((prev: any) => {
            if (!prev) return prev;
            const newDatasets = [...prev.datasets];
            // Dataset 0: Output Actual (Bar)
            if (newDatasets[0]) newDatasets[0] = { ...newDatasets[0], data: filterFutureDataInternal(hourly.output, prev.labels, serverCurrentHourStr) };
            // Dataset 2: Output Accum (Line)
            if (newDatasets[2]) newDatasets[2] = { ...newDatasets[2], data: filterFutureDataInternal(hourly.outputAccum, prev.labels, serverCurrentHourStr) };
            return { ...prev, datasets: newDatasets };
        });

        // 3. Update Graph 2
        setGraph2Data((prev: any) => {
            if (!prev) return prev;
            const newDatasets = [...prev.datasets];
            // Dataset 0: CT Actual (Bar)
            if (newDatasets[0]) newDatasets[0] = { ...newDatasets[0], data: filterFutureDataInternal(hourly.cycleTime, prev.labels, serverCurrentHourStr) };
            // Dataset 2: Eff Actual (Line)
            if (newDatasets[2]) newDatasets[2] = { ...newDatasets[2], data: filterFutureDataInternal(hourly.efficiency, prev.labels, serverCurrentHourStr) };
            return { ...prev, datasets: newDatasets };
        });

    }, [realtimeData, date]);

    // Fetch Data
    // Fetch Data
    useEffect(() => {
        fetchAllData();
    }, [machineName, date]); // Removed refreshTrigger to prevent socket-induced polling

    const fetchAllData = async () => {
        try {
            const timestamp = Date.now();

            // ✅ Check if viewing "Today" first (to determine which API to call)
            const todayStr = dayjs().format("YYYY-MM-DD");
            const isToday = date === todayStr;

            // ✅ 1. Fetch models list first
            const resModels = await axios.get(`${config.apiServer}/api/oee/getModelsByDate`, {
                params: { machine_name: machineName, date: date, t: timestamp }
            });
            const models = resModels.data.results.map((m: any) => m.model_name);

            // ✅ 2. Determine target model
            const targetModel = selectedModel || (models.length > 0 ? models[0] : '');
            const modelParam = targetModel ? `&model_name=${targetModel}` : '';

            // ✅ 3. Update state
            setModelsList(models);
            if (!selectedModel && models.length > 0) {
                setSelectedModel(models[0]);
            }

            // ✅ 4. Call ALL APIs in parallel (including cross-day operator)
            const [resOEE, resTable, resGraph1, resGraph2, resOperator, resCrossDay] = await Promise.all([
                axios.get(`${config.apiServer}/api/oee/getLastOEE?machine_name=${machineName}&date=${date}${modelParam}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getDataTable?machine_name=${machineName}&date=${date}${modelParam}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getGraph1?machine_name=${machineName}&date=${date}${modelParam}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getGraph2?machine_name=${machineName}&date=${date}${modelParam}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/historyWorking/getHistoryByDate?machine_name=${machineName}&date=${date}&t=${timestamp}`),
                // ✅ Fetch cross-day operator in parallel (conditional API based on date)
                isToday
                    ? axios.get(`${config.apiServer}/api/historyWorking/getOperatorIdWorking/${machineName}?t=${timestamp}`).catch(() => ({ data: { results: null } }))
                    : axios.get(`${config.apiServer}/api/historyWorking/getActiveCrossDayOperator?machine_name=${machineName}&date=${date}&t=${timestamp}`).catch(() => ({ data: { results: null } }))
            ]);

            // ✅ Extract cross-day operator from parallel result
            const activeCrossDayOp = resCrossDay.data?.results || null;

            // --- 1. Process Operator ---
            const historyList = resOperator.data?.results || [];
            let currentOpCode = "-";
            let currentOpName = "-";
            let opPicUrl = "";

            // Find active operator (end_time is null) OR last operator
            const activeOp = historyList.find((h: any) => h.end_time === null);
            const lastOp = historyList.length > 0 ? historyList[historyList.length - 1] : null;

            // ✅ Priority: Cross-Day Active -> Today's Active -> Today's Last
            const displayOp = activeCrossDayOp || activeOp || lastOp;

            if (displayOp) {
                currentOpCode = displayOp.emp_no || "-";
                // ✅ Handle both flat (active) and nested (history) structures
                currentOpName = displayOp.operator_name || (displayOp.tbm_operator ? displayOp.tbm_operator.operator_name : "-");

                const picPath = displayOp.picture_path || (displayOp.tbm_operator ? displayOp.tbm_operator.picture_path : "");
                // Construct URL directly
                opPicUrl = picPath ? `${config.apiServer}/image/${picPath}` : "";
            }

            // --- 2. Process OEE & Table Data ---
            const oeeData = resOEE.data; // Note: machine_working uses resOEE.data directly, not .results for oee_value
            const tableDataRaw = resTable.data; // machine_working uses resTable.data directly

            // Update Table State with correct property names (matching machine_working)
            setTableData({
                model: tableDataRaw.model || "-",
                achieve: tableDataRaw.Achieve || 0, // Note: Capital A
                oee: oeeData.oee_value || 0,
                oeeDate: oeeData.date ? dayjs(oeeData.date).format("DD/MM/YYYY") : "-",
                operatorName: currentOpName,
                operatorCode: currentOpCode,
                operatorPic: opPicUrl,
                outputActual: tableDataRaw.outputActual || 0,
                outputTarget: tableDataRaw.outputTarget || 0,
                ctActual: tableDataRaw.cycleTimeActual || 0,
                ctTarget: tableDataRaw.cycleTimeTarget || 0,
                effActual: tableDataRaw.efficiencyActual || 0,
                effTarget: tableDataRaw.efficiencyTarget || 0,
            });



            // Helper for filtering future data (Moved to scope for re-use)
            const filterFutureData = (dataArray: number[], hoursArray: any[]) => {
                const todayStr = dayjs().format("YYYY-MM-DD");
                if (date !== todayStr) return dataArray; // Show all data if not today

                const currentHour = new Date().getHours();
                // Find index of current hour (e.g., "08:00" -> index 1)
                // Assume hoursArray are strings "07:00", "08:00" etc.
                const currentIndex = hoursArray.findIndex((h: string) => parseInt(h) === currentHour);

                if (currentIndex === -1) return dataArray; // Safety check or outside hours

                return dataArray.map((val, index) => {
                    return index > currentIndex ? null : val;
                });
            };

            // --- 3. Process Graph 1 (Output Monitor) ---
            const g1 = resGraph1.data;
            if (g1) {
                setGraph1Data({
                    labels: g1.hours,
                    datasets: [
                        {
                            type: "bar",
                            label: "Output Actual",
                            data: filterFutureData(g1.outputActual, g1.hours),
                            backgroundColor: "#00b050",
                            yAxisID: "y_qty",
                            order: 4
                        },
                        {
                            type: "line",
                            label: "Output Target",
                            data: g1.outputTarget,
                            borderColor: "#385723",
                            borderWidth: 3,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            yAxisID: "y_qty",
                            order: 3,
                            datalabels: {
                                display: true,
                                align: 'left',
                                anchor: 'center',
                                backgroundColor: '#385723',
                                color: 'white',
                                borderRadius: 4,
                                font: { weight: 'bold', size: 10 },
                                padding: 4,
                                formatter: (value: any, context: any) => context.dataIndex === 0 ? `Target: ${value}` : null
                            }
                        },
                        {
                            type: "line",
                            label: "Output Accum",
                            data: filterFutureData(g1.outputActualAccum, g1.hours),
                            borderColor: "#c00000",
                            backgroundColor: "#c00000",
                            borderWidth: 2,
                            pointRadius: 3,
                            yAxisID: "y_accum",
                            order: 1
                        },
                        {
                            type: "line",
                            label: "Output Target Accum",
                            data: g1.outputTargetAccum,
                            borderColor: "#f062b0ff",
                            borderWidth: 3,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            yAxisID: "y_accum",
                            order: 2
                        }
                    ]
                });
            }

            // --- 4. Process Graph 2 (CT & Eff Monitor) ---
            const g2 = resGraph2.data;
            if (g2) {
                setGraph2Data({
                    labels: g2.hours,
                    datasets: [
                        {
                            type: "bar",
                            label: "Cycle Time Actual",
                            data: g2.cycleTimeActual,
                            backgroundColor: "#5b9bd5",
                            yAxisID: "y_ct",
                            order: 4
                        },
                        {
                            type: "line",
                            label: "Cycle Time Target",
                            data: g2.cycleTimeTarget,
                            borderColor: "#203864",
                            borderWidth: 3,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            yAxisID: "y_ct",
                            order: 1,
                            datalabels: {
                                display: true,
                                align: 'left',
                                anchor: 'center',
                                backgroundColor: '#385723',
                                color: 'white',
                                borderRadius: 4,
                                font: { weight: 'bold', size: 10 },
                                padding: 4,
                                formatter: (value: any, context: any) => context.dataIndex === 0 ? `Target: ${value}` : null
                            }
                        },
                        {
                            type: "line",
                            label: "Availability Actual",
                            data: filterFutureData(g2.efficiencyActual, g2.hours),
                            borderColor: "#02630fff",
                            backgroundColor: "#02630fff",
                            borderWidth: 2,
                            pointRadius: 3,
                            yAxisID: "y_eff",
                            order: 3
                        },
                        {
                            type: "line",
                            label: "Availability Target",
                            data: g2.efficiencyTarget,
                            borderColor: "#ff6600ff",
                            borderWidth: 3,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            yAxisID: "y_eff",
                            order: 2,
                            datalabels: {
                                display: true,
                                align: 'right',
                                anchor: 'center',
                                backgroundColor: '#385723',
                                color: 'white',
                                borderRadius: 4,
                                font: { weight: 'bold', size: 10 },
                                padding: 4,
                                formatter: (value: any, context: any) => {
                                    const dataArray = context.chart.data.datasets[context.datasetIndex].data;
                                    if (context.dataIndex === dataArray.length - 1) {
                                        return `Target: ${value}`;
                                    }
                                    return null;
                                }
                            }
                        }
                    ]
                });
            }

        } catch (error: any) {
            console.error("Fetch Error:", error);
        }
    };

    // ================= MC Status Logic =================

    const fetchMcStatus = useCallback(async () => {
        if (!machineName || !date) return;
        try {
            const res = await axios.get(`${config.apiServer}/api/mcstatus/timeline`, {
                params: { machine_name: machineName, date }
            });
            setMcStatusData(res.data.results || []);
        } catch (e) {
            console.error("MC Status fetch error:", e);
        }
    }, [machineName, date]);

    // Fetch on view switch & when parent triggers refresh
    useEffect(() => {
        if (activeView !== "status") return;
        fetchMcStatus();
    }, [activeView, fetchMcStatus, mcStatusRefreshTrigger]);

    // Draw canvas when data changes
    useEffect(() => {
        if (activeView !== "status") return;
        const canvas = mcStatusCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        const W = rect.width;
        const H = rect.height;
        ctx.clearRect(0, 0, W, H);

        const labelAreaW = 40;
        const chartX = labelAreaW;
        const chartW = W - labelAreaW - 6;
        const shiftRowY = 4;
        const shiftRowH = 16;
        const barY = shiftRowY + shiftRowH + 2;
        const barH = 28;
        const totalMinutes = 1440;
        const mShiftEnd = 720;

        // Helper: datetime → minutes on timeline (UTC ตรงๆ)
        // Prisma แปลง TH local → UTC ให้แล้ว: TH 07:00 = UTC 00:00Z = นาทีที่ 0
        const toMinSince0700 = (dtStr: string): number => {
            const d = new Date(dtStr);
            return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
        };

        const minToTimeStr = (min: number): string => {
            let h = Math.floor(min / 60) + 7;
            if (h >= 24) h -= 24;
            const m = Math.floor(min % 60);
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        // Shift Row
        ctx.fillStyle = "#f8f9fa";
        ctx.fillRect(chartX, shiftRowY, chartW, shiftRowH);
        ctx.strokeStyle = "#dee2e6";
        ctx.strokeRect(chartX, shiftRowY, chartW, shiftRowH);

        const mEndX = chartX + (mShiftEnd / totalMinutes) * chartW;
        ctx.fillStyle = "#333";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("M Shift", chartX + (mEndX - chartX) / 2, shiftRowY + shiftRowH / 2);
        ctx.fillText("N Shift", mEndX + (chartX + chartW - mEndX) / 2, shiftRowY + shiftRowH / 2);

        // Divider
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mEndX, shiftRowY);
        ctx.lineTo(mEndX, barY + barH);
        ctx.stroke();
        ctx.lineWidth = 1;

        // Left labels
        ctx.fillStyle = "#555";
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("Shift", labelAreaW - 4, shiftRowY + shiftRowH / 2);
        ctx.fillText("Status", labelAreaW - 4, barY + barH / 2);

        // Build segments
        const segments: { startMin: number; endMin: number; status: string; startTime: string; endTime: string }[] = [];
        if (mcStatusData.length > 0) {
            for (let i = 0; i < mcStatusData.length; i++) {
                const startMin = toMinSince0700(mcStatusData[i].datetime);
                let endMin: number;
                let endTimeLabel: string;
                if (i + 1 < mcStatusData.length) {
                    endMin = toMinSince0700(mcStatusData[i + 1].datetime);
                    endTimeLabel = minToTimeStr(endMin);
                } else {
                    const todayStr = dayjs().format("YYYY-MM-DD");
                    if (date === todayStr) {
                        const now = new Date();
                        endMin = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
                    } else {
                        endMin = totalMinutes;
                    }
                    endTimeLabel = minToTimeStr(endMin);
                }
                if (endMin <= startMin) endMin += totalMinutes;
                segments.push({
                    startMin, endMin: Math.min(endMin, totalMinutes),
                    status: mcStatusData[i].mc_status,
                    startTime: minToTimeStr(startMin), endTime: endTimeLabel,
                });
            }
        }
        mcSegmentsRef.current = segments;

        // Draw status bar
        ctx.fillStyle = "#e9ecef";
        ctx.fillRect(chartX, barY, chartW, barH);
        for (const seg of segments) {
            const x1 = chartX + (seg.startMin / totalMinutes) * chartW;
            const x2 = chartX + (seg.endMin / totalMinutes) * chartW;
            ctx.fillStyle = MC_STATUS_COLORS[seg.status]?.color || "#ccc";
            ctx.fillRect(x1, barY, x2 - x1, barH);
        }
        ctx.strokeStyle = "#dee2e6";
        ctx.strokeRect(chartX, barY, chartW, barH);

        // --- Draw hour tick marks (matching machine_working) ---
        ctx.strokeStyle = "#aaa";
        ctx.fillStyle = "#666";
        ctx.font = "8px sans-serif";
        ctx.textAlign = "center";
        const hourLabels = ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06"];
        for (let i = 0; i <= 24; i++) {
            const x = chartX + (i * 60 / totalMinutes) * chartW;
            ctx.beginPath();
            ctx.moveTo(x, barY + barH);
            ctx.lineTo(x, barY + barH + 4);
            ctx.stroke();
            if (i < 24) {
                ctx.fillText(hourLabels[i], x + (60 / totalMinutes * chartW) / 2, barY + barH + 12);
            }
        }

    }, [activeView, mcStatusData, date]);

    // ================= Downtime Breakdown Chart =================
    useEffect(() => {
        const segments = mcSegmentsRef.current;
        if (!segments || segments.length === 0) { setDowntimeChartData(null); return; }

        const durationMap: Record<string, number> = {};
        let totalElapsed = 0;
        for (const seg of segments) {
            const dur = Math.max(seg.endMin - seg.startMin, 0);
            durationMap[seg.status] = (durationMap[seg.status] || 0) + dur;
            totalElapsed += dur;
        }
        if (totalElapsed === 0) { setDowntimeChartData(null); return; }

        const DOWNTIME_KEYS = [
            "Plan_Stop", "Break_Time",
            "MM_Repair", "MM_Check_Master", "MM_Preventive",
            "Setter_Adjust", "Setter_Check_Master", "Setter_Preventive",
            "QC_Quality", "QC_Check_Master",
            "Prod_Cleaning", "Prod_Check_Master",
            "Wait_Part", "MC_Stop", "MC_Alarm", "Cut_Lot", "Signal_Lost",
        ];

        const labels: string[] = [];
        const values: number[] = [];
        const colors: string[] = [];
        for (const key of DOWNTIME_KEYS) {
            labels.push(MC_STATUS_COLORS[key]?.label || key);
            values.push(parseFloat((((durationMap[key] || 0) / totalElapsed) * 100).toFixed(1)));
            colors.push(MC_STATUS_COLORS[key]?.color || "#ccc");
        }

        // เก็บ durationMap ใน state (Chart.js จะ strip custom props ออกจาก data)
        const durMap: Record<string, number> = {};
        for (const key of DOWNTIME_KEYS) {
            durMap[MC_STATUS_COLORS[key]?.label || key] = durationMap[key] || 0;
        }
        setDowntimeDurationMap(durMap);

        setDowntimeChartData({
            labels,
            datasets: [{
                label: "Downtime %",
                data: values,
                backgroundColor: colors,
                borderRadius: 3,
            }],
        });
    }, [mcStatusData]);

    // Canvas mouse handlers for tooltip
    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = mcStatusCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const labelAreaW = 40;
        const chartX = labelAreaW;
        const chartW = rect.width - labelAreaW - 6;
        const totalMinutes = 1440;
        const barY = 22;
        const barH = 28;

        if (x < chartX || x > chartX + chartW || e.clientY - rect.top < barY || e.clientY - rect.top > barY + barH) {
            setMcTooltip(null);
            return;
        }

        const minAtMouse = ((x - chartX) / chartW) * totalMinutes;
        const seg = mcSegmentsRef.current.find(s => minAtMouse >= s.startMin && minAtMouse < s.endMin);
        if (seg) {
            const durMin = seg.endMin - seg.startMin;
            const hrs = Math.floor(durMin / 60);
            const mins = Math.floor(durMin % 60);
            setMcTooltip({
                visible: true, x: e.clientX - rect.left, y: barY - 6,
                status: seg.status, startTime: seg.startTime, endTime: seg.endTime,
                duration: hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`,
            });
        } else {
            setMcTooltip(null);
        }
    };

    const handleCanvasMouseLeave = () => setMcTooltip(null);

    // ================= Chart Options =================

    const legendFontSize = Math.max(7, Math.round(10 * scaleFactor));
    const legendBoxWidth = Math.max(8, Math.round(15 * scaleFactor));
    const legendPadding = Math.max(4, Math.round(10 * scaleFactor));

    const optionsGraph1: ChartOptions<"bar" | "line"> = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    usePointStyle: false,
                    boxWidth: legendBoxWidth,
                    padding: legendPadding,
                    font: { size: legendFontSize }
                }
            },
            title: { display: false },
            datalabels: { display: false }
        },
        scales: {
            x: { grid: { display: false } },
            y_qty: {
                type: 'linear',
                display: true,
                position: 'left',
                title: { display: true, text: 'Output [pcs]', color: '#00b050' },
                beginAtZero: true,
            },
            y_accum: {
                type: 'linear',
                display: true,
                position: 'right',
                title: { display: true, text: 'Accum [pcs]', color: '#c00000' },
                beginAtZero: true,
                grid: { drawOnChartArea: false }
            }
        }
    };

    const optionsGraph2: ChartOptions<"bar" | "line"> = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    usePointStyle: false,
                    boxWidth: legendBoxWidth,
                    padding: legendPadding,
                    font: { size: legendFontSize }
                }
            },
            title: { display: false },
            datalabels: { display: false }
        },
        scales: {
            x: { grid: { display: false } },
            y_ct: {
                type: 'linear',
                display: true,
                position: 'left',
                title: { display: true, text: 'CT [sec]', color: '#5b9bd5' },
                beginAtZero: true,
            },
            y_eff: {
                type: 'linear',
                display: true,
                position: 'right',
                title: { display: true, text: 'Eff [%]', color: '#ed7d31' },
                min: 0,
                max: 120,
                grid: { drawOnChartArea: false }
            },
        }
    };

    // === Blinking current-hour bar: compute modified graph1Data at render time ===
    const renderGraph1Data = useMemo(() => {
        if (!graph1Data) return null;
        const todayStr = dayjs().format("YYYY-MM-DD");
        if (date !== todayStr) return graph1Data; // No blinking if not today

        const labels = graph1Data.labels || [];
        const currentHour = new Date().getHours();
        const currentIndex = labels.findIndex((h: string) => parseInt(h) === currentHour);
        if (currentIndex === -1) return graph1Data;

        const newDatasets = graph1Data.datasets.map((ds: any, dsIdx: number) => {
            if (dsIdx !== 0) return ds; // Only modify the Output Actual bar (index 0)
            return {
                ...ds,
                backgroundColor: labels.map((_: any, i: number) =>
                    i === currentIndex ? (blinkOn ? "#00b050" : "#80ff80") : "#00b050"
                ),
            };
        });
        return { ...graph1Data, datasets: newDatasets };
    }, [graph1Data, blinkOn, date]);

    // === Blinking current-hour bar for Graph 2 (CT bar) ===
    const renderGraph2Data = useMemo(() => {
        if (!graph2Data) return null;
        const todayStr = dayjs().format("YYYY-MM-DD");
        if (date !== todayStr) return graph2Data; // No blinking if not today

        const labels = graph2Data.labels || [];
        const currentHour = new Date().getHours();
        const currentIndex = labels.findIndex((h: string) => parseInt(h) === currentHour);
        if (currentIndex === -1) return graph2Data;

        const newDatasets = graph2Data.datasets.map((ds: any, dsIdx: number) => {
            if (dsIdx !== 0) return ds; // Only modify the CT Actual bar (index 0)
            return {
                ...ds,
                backgroundColor: labels.map((_: any, i: number) =>
                    i === currentIndex ? (blinkOn ? "#5b9bd5" : "#b0d4f1") : "#5b9bd5"
                ),
            };
        });
        return { ...graph2Data, datasets: newDatasets };
    }, [graph2Data, blinkOn, date]);

    // ================= RENDER =================

    return (
        <div className="card shadow-sm h-100 d-flex flex-column" style={{ minHeight: 0, overflow: "hidden" }}>
            <div className="card-header py-1 px-2 d-flex justify-content-center align-items-center bg-primary text-white" style={{ flexShrink: 0 }}>
                <span className="fw-bold" style={{ fontSize: fontSize.base }}>{machineName}</span>
            </div>
            <div className="card-body p-1 d-flex flex-column" style={{ overflow: "hidden", minHeight: 0, flex: 1 }}>
                {/* --- TABLE HEADER — แสดงเสมอทั้ง Output และ MC Status --- */}
                <div className="table-responsive mb-1" style={{ flexShrink: 0 }}>
                    <table className="table table-bordered align-middle text-center m-0" style={{ fontSize: fontSize.tiny }}>
                        <thead className="table-primary">
                            <tr>
                                <th className="p-0" style={{ width: "12%", verticalAlign: "middle" }}>Date</th>
                                <th className="p-0" style={{ width: "15%", verticalAlign: "middle" }}>MC Name</th>
                                <th className="p-0" style={{ width: "15%", verticalAlign: "middle" }}>Model</th>
                                <th className="p-0" style={{ width: "15%", verticalAlign: "middle" }}>Achieve</th>
                                <th className="p-0" style={{ width: "18%", verticalAlign: "middle" }}>OEE</th>
                                <th className="p-0" style={{ width: "25%", verticalAlign: "middle" }}>Operator</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td rowSpan={2} className="p-0 fw-bold bg-white">
                                    <div style={{ fontSize: fontSize.small }}>{dayjs(date).format("DD/MM/YYYY")}</div>
                                    <div className="text-primary" style={{ fontSize: fontSize.tiny }}>{clientTime}</div>
                                </td>
                                <td className="p-0 fw-bold text-primary">{machineName}</td>
                                <td className="p-0">
                                    {modelsList.length > 1 ? (
                                        <select
                                            className="form-select form-select-sm d-inline-block w-auto"
                                            style={{ fontSize: "0.6rem", padding: "1px 4px", height: "auto" }}
                                            value={selectedModel}
                                            onChange={(e) => {
                                                setSelectedModel(e.target.value);
                                                fetchAllData();
                                            }}
                                        >
                                            {modelsList.map(model => (
                                                <option key={model} value={model}>{model}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span>{tableData.model}</span>
                                    )}
                                </td>
                                <td className="p-0">
                                    <span className={`fw-bold ${tableData.achieve >= 100 ? "text-success" : "text-danger"}`}>
                                        {tableData.achieve.toFixed(1)}%
                                    </span>
                                </td>
                                <td rowSpan={4} className="p-0 align-middle bg-white">
                                    <div className="d-flex flex-column justify-content-center h-100">
                                        <div className={`fw-bold ${tableData.oee >= 85 ? "text-success" : "text-danger"}`} style={{ fontSize: fontSize.large }}>
                                            {tableData.oee.toFixed(1)}%
                                        </div>
                                        <div className="text-muted" style={{ fontSize: fontSize.tiny }}>
                                            {tableData.oeeDate}
                                        </div>
                                    </div>
                                </td>
                                <td rowSpan={4} className="p-0 align-middle bg-white">
                                    <div className="d-flex flex-column align-items-center justify-content-center h-100 p-1">
                                        <img
                                            src={tableData.operatorPic || "/dist/img/avg.png"}
                                            alt="Op"
                                            className="rounded border mb-1"
                                            style={{ width: "30px", height: "30px", objectFit: "cover" }}
                                            onError={(e) => { (e.target as HTMLImageElement).src = "/dist/img/avg.png" }}
                                        />
                                        <div className="fw-bold text-dark" style={{ fontSize: "0.6rem", lineHeight: 1 }}>{tableData.operatorCode}</div>
                                        <div className="text-muted text-truncate w-100" style={{ fontSize: "0.5rem" }}>{tableData.operatorName}</div>
                                    </div>
                                </td>
                            </tr>
                            <tr className="bg-light text-secondary fw-bold">
                                <td className="p-0">Output</td>
                                <td className="p-0">Cycle Time</td>
                                <td className="p-0">Availability</td>
                            </tr>
                            <tr>
                                <td className="p-0 fw-bold bg-light text-secondary">Actual</td>
                                <td className="p-0 fw-bold text-dark">
                                    {tableData.outputActual.toLocaleString()}
                                </td>
                                <td className={`p-0 fw-bold ${tableData.ctActual > tableData.ctTarget ? "text-danger" : "text-success"}`}>
                                    {tableData.ctActual.toFixed(2)}
                                </td>
                                <td className={`p-0 fw-bold ${tableData.effActual < tableData.effTarget ? "text-danger" : "text-success"}`}>
                                    {tableData.effActual.toFixed(2)}%
                                </td>
                            </tr>
                            <tr>
                                <td className="p-0 fw-bold bg-light text-secondary">Target</td>
                                <td className="p-0 text-muted">
                                    {tableData.outputTarget.toLocaleString()}
                                </td>
                                <td className="p-0 text-muted">
                                    {tableData.ctTarget.toFixed(2)}
                                </td>
                                <td className="p-0 text-muted">
                                    {tableData.effTarget.toFixed(2)}%
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* --- CONTENT AREA — toggle เฉพาะส่วนนี้ --- */}
                {activeView === "output" ? (
                    /* --- GRAPH SECTION --- */
                    <div className="d-flex flex-row flex-grow-1" style={{ minHeight: 0, gap: "4px" }}>
                        <div className="flex-fill position-relative w-50" style={{ minHeight: 0 }}>
                            {renderGraph1Data ? (
                                <Chart type="bar" data={renderGraph1Data} options={optionsGraph1} />
                            ) : (
                                <div className="d-flex align-items-center justify-content-center h-100 text-muted small">Loading...</div>
                            )}
                        </div>
                        <div className="flex-fill position-relative w-50" style={{ minHeight: 0 }}>
                            {renderGraph2Data ? (
                                <Chart type="bar" data={renderGraph2Data} options={optionsGraph2} />
                            ) : (
                                <div className="d-flex align-items-center justify-content-center h-100 text-muted small">Loading...</div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* --- MC STATUS VIEW: Canvas Timeline --- */
                    <div className="d-flex flex-column flex-grow-1 p-1">
                        <div className="text-center mb-1">
                            <span className="fw-bold" style={{ fontSize: "0.7rem" }}>Machine Status Timeline</span>
                        </div>
                        {mcStatusData.length === 0 ? (
                            <div className="d-flex align-items-center justify-content-center flex-grow-1 text-muted">
                                <div className="text-center">
                                    <i className="fas fa-info-circle fs-4 mb-1"></i>
                                    <div style={{ fontSize: "0.8rem" }}>No Status Data</div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="position-relative" style={{ flexShrink: 0 }}>
                                    <canvas
                                        ref={mcStatusCanvasRef}
                                        style={{ width: "100%", height: "70px", display: "block", cursor: "crosshair" }}
                                        onMouseMove={handleCanvasMouseMove}
                                        onMouseLeave={handleCanvasMouseLeave}
                                    />
                                    {mcTooltip && mcTooltip.visible && (
                                        <div
                                            className="position-absolute bg-dark text-white rounded shadow px-2 py-1"
                                            style={{
                                                left: mcTooltip.x,
                                                top: mcTooltip.y,
                                                transform: "translateX(-50%) translateY(-100%)",
                                                pointerEvents: "none",
                                                zIndex: 100,
                                                fontSize: "0.7rem",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            <div className="d-flex align-items-center gap-1">
                                                <div style={{
                                                    width: 8, height: 8,
                                                    backgroundColor: MC_STATUS_COLORS[mcTooltip.status]?.color || "#ccc",
                                                    borderRadius: 2,
                                                }}></div>
                                                <strong>{MC_STATUS_COLORS[mcTooltip.status]?.label || mcTooltip.status}</strong>
                                            </div>
                                            <div>{mcTooltip.startTime} → {mcTooltip.endTime} ({mcTooltip.duration})</div>
                                        </div>
                                    )}
                                </div>

                                {/* Compact Downtime Breakdown Chart — flex-grow */}
                                {downtimeChartData && (
                                    <div className="mt-0" style={{ flex: 1, minHeight: "60px", maxHeight: "150px" }}>
                                        <div className="text-center fw-bold" style={{ fontSize: Math.max(7, Math.round(9 * scaleFactor)) + "px", color: "#333", marginBottom: 1 }}>Downtime (%)</div>
                                        <Chart type="bar" data={downtimeChartData} options={{
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            animation: false,
                                            plugins: {
                                                legend: { display: false },
                                                title: { display: false },
                                                tooltip: {
                                                    callbacks: {
                                                        label: (ctx: any) => {
                                                            const pct = ctx.parsed.y || 0;
                                                            const statusLabel = ctx.label || "";
                                                            const mins = downtimeDurationMap[statusLabel] || 0;
                                                            const hh = Math.floor(mins / 60);
                                                            const mm = Math.floor(mins % 60);
                                                            const ss = Math.round((mins % 1) * 60);
                                                            return `${pct}% — ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
                                                        }
                                                    }
                                                },
                                                datalabels: {
                                                    display: true,
                                                    anchor: "end",
                                                    align: "top",
                                                    offset: 1,
                                                    color: "#333",
                                                    font: { weight: "bold", size: Math.max(7, Math.round(9 * scaleFactor)) },
                                                    formatter: (val: number) => val > 0 ? `${val}%` : null,
                                                },
                                            },
                                            layout: { padding: { top: 20 } },
                                            scales: {
                                                x: { grid: { display: false }, ticks: { font: { size: Math.max(6, Math.round(8 * scaleFactor)) }, maxRotation: 45, minRotation: 0 } },
                                                y: { beginAtZero: true, ticks: { callback: (val: any) => `${val}%`, font: { size: Math.max(6, Math.round(8 * scaleFactor)) } }, grid: { color: "#eee" } },
                                            },
                                        } as any} />
                                    </div>
                                )}

                                {/* Compact Legend — at the bottom */}
                                <div className="d-flex flex-wrap gap-1 mt-1 pt-1 border-top" style={{ fontSize: "0.55rem", flexShrink: 0 }}>
                                    {Object.entries(MC_STATUS_COLORS).map(([key, val]) => (
                                        <div key={key} className="d-flex align-items-center gap-1">
                                            <div style={{ width: 8, height: 8, backgroundColor: val.color, borderRadius: 1, border: "1px solid #ccc" }}></div>
                                            <span>{val.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

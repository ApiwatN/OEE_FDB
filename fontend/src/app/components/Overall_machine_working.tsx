"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import config from "@/app/config";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
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
    LineElement,
    PointElement,
    Title,
    Tooltip,
    Legend,
    ChartDataLabels
);

interface OverallMachineCardProps {
    machineName: string;
    date: string;
}

export default function OverallMachineCard({ machineName, date }: OverallMachineCardProps) {
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

    // ================= Effects =================

    // Clock Timer
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
        return () => clearInterval(interval);
    }, [date]);

    // Fetch Data
    useEffect(() => {
        fetchAllData();
    }, [machineName, date]);

    const fetchAllData = async () => {
        try {
            const timestamp = Date.now();

            // Call APIs in parallel (matching machine_working/page.tsx)
            const [resOEE, resTable, resGraph1, resGraph2, resOperator] = await Promise.all([
                axios.get(`${config.apiServer}/api/oee/getLastOEE?machine_name=${machineName}&date=${date}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getDataTable?machine_name=${machineName}&date=${date}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getGraph1?machine_name=${machineName}&date=${date}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getGraph2?machine_name=${machineName}&date=${date}&t=${timestamp}`),
                // ✅ Change to getHistoryByDate to match machine_working logic
                axios.get(`${config.apiServer}/api/historyWorking/getHistoryByDate?machine_name=${machineName}&date=${date}&t=${timestamp}`)
            ]);

            // ✅ Check if viewing "Today"
            const todayStr = dayjs().format("YYYY-MM-DD");
            const isToday = date === todayStr;

            let activeCrossDayOp = null;

            // ✅ Fetch cross-day operator for ANY date (not just today)
            // This handles the case where an operator started working on a previous day
            // and hasn't logged out yet (or logged out after the selected date)
            try {
                if (isToday) {
                    // For today: use getOperatorIdWorking (real-time active operator)
                    const resActive = await axios.get(`${config.apiServer}/api/historyWorking/getOperatorIdWorking/${machineName}?t=${timestamp}`);
                    if (resActive.data && resActive.data.results) {
                        activeCrossDayOp = resActive.data.results;
                    }
                } else {
                    // For historical dates: use getActiveCrossDayOperator
                    const resCrossDay = await axios.get(`${config.apiServer}/api/historyWorking/getActiveCrossDayOperator?machine_name=${machineName}&date=${date}&t=${timestamp}`);
                    if (resCrossDay.data && resCrossDay.data.results) {
                        activeCrossDayOp = resCrossDay.data.results;
                    }
                }
            } catch (e) {
                console.error("Error fetching cross-day operator:", e);
            }

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

            // Helper for filtering future data
            const filterFutureData = (dataArray: number[], hoursArray: string[]) => {
                const todayStr = dayjs().format("YYYY-MM-DD");
                if (date !== todayStr) return dataArray; // Show all data if not today

                const currentHour = new Date().getHours();
                // Find index of current hour (e.g., "08:00" -> index 1)
                const currentIndex = hoursArray.findIndex((h: string) => parseInt(h) === currentHour);

                if (currentIndex === -1) return dataArray; // Safety check or outside hours

                return dataArray.map((val, index) => {
                    // If index > current index -> Future -> null
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
                            label: "Efficiency Actual",
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
                            label: "Efficiency Target",
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

    // ================= Chart Options =================

    const optionsGraph1: ChartOptions<"bar" | "line"> = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    usePointStyle: false,
                    boxWidth: 15,
                    padding: 10,
                    font: { size: 10 }
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
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    usePointStyle: false,
                    boxWidth: 15,
                    padding: 10,
                    font: { size: 10 }
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

    return (
        <div className="card shadow-sm h-100 d-flex flex-column" style={{ minHeight: "300px" }}>
            <div className="card-header py-1 px-2 d-flex justify-content-between align-items-center bg-primary text-white">
                <span className="fw-bold" style={{ fontSize: "0.9rem" }}>{machineName}</span>
                <span style={{ fontSize: "0.8rem" }}>{clientTime}</span>
            </div>
            <div className="card-body p-1 d-flex flex-column" style={{ overflow: "hidden" }}>
                {/* --- EXACT TABLE MATCH --- */}
                <div className="table-responsive mb-1" style={{ flexShrink: 0 }}>
                    <table className="table table-bordered align-middle text-center m-0" style={{ fontSize: "0.55rem" }}>
                        <thead className="table-primary">
                            <tr>
                                <th className="p-0" style={{ width: "12%" }}>Date</th>
                                <th className="p-0" style={{ width: "15%" }}>MC Name</th>
                                <th className="p-0" style={{ width: "15%" }}>Model</th>
                                <th className="p-0" style={{ width: "15%" }}>Achieve</th>
                                <th className="p-0" style={{ width: "18%" }}>OEE</th>
                                <th className="p-0" style={{ width: "25%" }}>Operator</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Row 1: Values & Spans */}
                            <tr>
                                {/* Date/Time (RowSpan 2) */}
                                <td rowSpan={2} className="p-0 fw-bold bg-white">
                                    <div>{dayjs(date).format("DD/MM/YYYY")}</div>
                                    <div className="text-primary" style={{ fontSize: "0.7rem" }}>{clientTime}</div>
                                </td>
                                {/* MC Name */}
                                <td className="p-0 fw-bold text-primary">{machineName}</td>
                                {/* Model */}
                                <td className="p-0">{tableData.model}</td>
                                {/* Achieve */}
                                <td className="p-0">
                                    <span className={`fw-bold ${tableData.achieve >= 100 ? "text-success" : "text-danger"}`}>
                                        {tableData.achieve.toFixed(1)}%
                                    </span>
                                </td>
                                {/* OEE (RowSpan 4) */}
                                <td rowSpan={4} className="p-0 align-middle bg-white">
                                    <div className="d-flex flex-column justify-content-center h-100">
                                        <div className={`fw-bold ${tableData.oee >= 85 ? "text-success" : "text-danger"}`} style={{ fontSize: "1.1rem" }}>
                                            {tableData.oee.toFixed(1)}%
                                        </div>
                                        <div className="text-muted" style={{ fontSize: "0.6rem" }}>
                                            {tableData.oeeDate}
                                        </div>
                                    </div>
                                </td>
                                {/* Operator (RowSpan 4) */}
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
                            {/* Row 2: Headers for Details */}
                            <tr className="bg-light text-secondary fw-bold">
                                {/* Col 1 is spanned */}
                                <td className="p-0">Output</td>
                                <td className="p-0">Cycle Time</td>
                                <td className="p-0">Efficiency</td>
                            </tr>
                            {/* Row 3: Actual */}
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
                            {/* Row 4: Target */}
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

                {/* --- GRAPH SECTION --- */}
                <div className="d-flex flex-row flex-grow-1" style={{ minHeight: 0, gap: "4px" }}>
                    <div className="flex-fill position-relative w-50" style={{ minHeight: 0 }}>
                        {graph1Data ? (
                            <Chart type="bar" data={graph1Data} options={optionsGraph1} />
                        ) : (
                            <div className="d-flex align-items-center justify-content-center h-100 text-muted small">Loading...</div>
                        )}
                    </div>
                    <div className="flex-fill position-relative w-50" style={{ minHeight: 0 }}>
                        {graph2Data ? (
                            <Chart type="bar" data={graph2Data} options={optionsGraph2} />
                        ) : (
                            <div className="d-flex align-items-center justify-content-center h-100 text-muted small">Loading...</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

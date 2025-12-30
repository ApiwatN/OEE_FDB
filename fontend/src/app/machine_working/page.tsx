"use client";

import { Suspense, useEffect, useState } from "react";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    Legend,
    Tooltip,
    ChartOptions,
    BarController,
    LineController
} from "chart.js";
import { Chart } from "react-chartjs-2";
import ChartDataLabels from "chartjs-plugin-datalabels";
import Swal from "sweetalert2";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import dayjs from "dayjs";
import config from "@/app/config";

// ✅ Register ChartJS components
ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Legend, Tooltip, ChartDataLabels, BarController, LineController)

export default function Page() {
    return (
        <Suspense fallback={<div className="p-4 text-center">Loading Machine Working...</div>}>
            <MachineWorkingInner />
        </Suspense>
    );
}

function MachineWorkingInner() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // ================= State Management =================

    // 1. Basic Info & Timer
    const [machineName, setMachineName] = useState("");
    const [clientTime, setClientTime] = useState<string>("");
    const [countdown, setCountdown] = useState(300); // 5 minutes
    const [refreshTime] = useState(300);
    const [currentDateStr, setCurrentDateStr] = useState(""); // YYYY-MM-DD
    const [blink, setBlink] = useState(true);
    // 2. Table Data State
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
        operators: [] as any[], // ✅ Store list of operators
    });

    // 3. History / Logout State
    const [historyId, setHistoryId] = useState<number | null>(null);
    const [canLogout, setCanLogout] = useState(false);

    // 4. Graph Data State
    const [graph1Data, setGraph1Data] = useState<any>(null); // Output Graph
    const [graph2Data, setGraph2Data] = useState<any>(null); // CT & Eff Graph

    // ================= Effects =================
    useEffect(() => {
        const interval = setInterval(() => {
            setBlink(prev => !prev);
        }, 600); // ความเร็วการกระพริบ (ms)
        return () => clearInterval(interval);
    }, []);
    // ✅ Effect สำหรับอัปเดตสีกราฟให้กระพริบ
    useEffect(() => {
        const currentHour = new Date().getHours();
        const todayStr = new Date().toISOString().split("T")[0];

        // ✅ ถ้าไม่ใช่วันนี้ ไม่ต้องกระพริบ (แสดงสีปกติ)
        if (currentDateStr !== todayStr) {
            return;
        }

        // --- Update Graph 1 (Output) ---
        setGraph1Data((prev: any) => {
            if (!prev) return null;

            // สร้าง Array สีใหม่
            const newColors = prev.labels.map((h: string) => {
                // ถ้าเป็นชั่วโมงปัจจุบัน ให้สลับสีตาม blink
                if (parseInt(h) === currentHour) {
                    return blink ? "#00b050" : "#00b05080"; // สีเขียวปกติ สลับกับ สีเขียวจางๆ (Hex Alpha)
                }
                return "#00b050"; // สีปกติสำหรับแท่งอื่น
            });

            // อัปเดตเฉพาะ dataset ของ Bar (Output Actual)
            const newDatasets = prev.datasets.map((ds: any) => {
                if (ds.label === "Output Actual") {
                    return { ...ds, backgroundColor: newColors };
                }
                return ds;
            });

            return { ...prev, datasets: newDatasets };
        });

        // --- Update Graph 2 (Cycle Time) ---
        setGraph2Data((prev: any) => {
            if (!prev) return null;

            // สร้าง Array สีใหม่
            const newColors = prev.labels.map((h: string) => {
                if (parseInt(h) === currentHour) {
                    return blink ? "#5b9bd5" : "#5b9bd580"; // สีฟ้าปกติ สลับกับ สีฟ้าจางๆ
                }
                return "#5b9bd5";
            });

            // อัปเดตเฉพาะ dataset ของ Bar (Cycle Time Actual)
            const newDatasets = prev.datasets.map((ds: any) => {
                if (ds.label === "Cycle Time Actual") {
                    return { ...ds, backgroundColor: newColors };
                }
                return ds;
            });

            return { ...prev, datasets: newDatasets };
        });

    }, [blink]); // ทำงานเมื่อ blink เปลี่ยนค่า


    useEffect(() => {
        // 1. Initialize Machine Name & Date
        const localMachine = localStorage.getItem("machineNameLocal");
        const localDate = localStorage.getItem("machineDateLocal"); // ✅ ดึงค่าจาก LocalStorage

        const paramMachine = searchParams.get("machine_name");
        const targetMachine = paramMachine || localMachine || "";

        if (!targetMachine) {
            Swal.fire({
                icon: "error",
                title: "Machine Not Found",
                text: "Please select a machine again.",
            }).then(() => {
                router.push("/oee_production/machine_area");
            });
            return;
        }

        setMachineName(targetMachine);

        // ✅ Logic: ใช้วันที่จาก LocalStorage ถ้ามี, ถ้าไม่มีใช้วันที่ปัจจุบัน
        let targetDateStr = "";

        // ✅ Logic: Always use current UTC date for monitoring
        //targetDateStr = new Date().toISOString().split("T")[0];
        targetDateStr = searchParams.get("date") || localDate || new Date().toISOString().split("T")[0];

        // setCurrentDateStr(targetDateStr);
        // ✅ Logic: ถ้าเข้ามาแบบ Scan (date=current) -> แสดงเวลาปกติ
        // ถ้าเข้ามาแบบ History (date!=current) -> ซ่อนเวลา
        // (Moved logic to Render phase)

        setCurrentDateStr(targetDateStr);

        // 2. Initial Fetch (ส่งวันที่ที่ถูกต้องไป)
        fetchAllData(targetMachine, targetDateStr);

        // 3. Clock Timer (Always run, visibility handled in render)
        const clockInterval = setInterval(() => {
            setClientTime(new Date().toLocaleTimeString("en-GB", { hour12: false }));
        }, 1000);

        return () => clearInterval(clockInterval);
    }, []);

    // Countdown & Auto Refresh
    useEffect(() => {
        console.log("machineName: " + machineName)
        console.log("currentDateStr: " + currentDateStr)
        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    if (machineName && currentDateStr) {
                        fetchAllData(machineName, currentDateStr);
                    }
                    return refreshTime;
                }
                return prev - 1;
            });
        }, 1000);
        console.log("Test")
        return () => clearInterval(timer);
    }, [machineName, currentDateStr, refreshTime]);

    // ================= Data Fetching =================

    const fetchAllData = async (machine: string, date: string) => {
        try {
            // เรียก API พร้อมกัน 5 ตัวเพื่อความเร็ว
            const timestamp = Date.now();

            // เรียก API พร้อมกัน 5 ตัว (เพิ่ม &t=${timestamp} ต่อท้าย)
            const [resOEE, resTable, resGraph1, resGraph2, resOperator] = await Promise.all([
                axios.get(`${config.apiServer}/api/oee/getLastOEE?machine_name=${machine}&date=${date}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getDataTable?machine_name=${machine}&date=${date}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getGraph1?machine_name=${machine}&date=${date}&t=${timestamp}`),
                axios.get(`${config.apiServer}/api/oee/getGraph2?machine_name=${machine}&date=${date}&t=${timestamp}`),
                // ✅ เปลี่ยนเป็นดึงประวัติทั้งหมดของวันนั้น
                axios.get(`${config.apiServer}/api/historyWorking/getHistoryByDate?machine_name=${machine}&date=${date}&t=${timestamp}`)
            ]);

            // ✅ Check if viewing "Today"
            const todayStr = dayjs().format("YYYY-MM-DD");
            const isToday = date === todayStr;

            let activeCrossDayOp = null;

            // ✅ If today, fetch active operator (who might have started yesterday)
            if (isToday) {
                try {
                    const resActive = await axios.get(`${config.apiServer}/api/historyWorking/getOperatorIdWorking/${machine}?t=${timestamp}`);
                    if (resActive.data && resActive.data.results) {
                        activeCrossDayOp = resActive.data.results;
                    }
                } catch (e) {
                    console.error("Error fetching active operator:", e);
                }
            }

            // --- 1. Process Operator & Logout Check ---
            const historyList = resOperator.data.results || [];

            // ✅ Combine activeCrossDayOp with historyList
            let finalOperatorList = [...historyList];
            if (activeCrossDayOp) {
                // Check for duplicates just in case
                const exists = finalOperatorList.find((h: any) => h.id === activeCrossDayOp.id);
                if (!exists) {
                    finalOperatorList.push(activeCrossDayOp);
                }
            }

            let currentOpCode = "-";
            let currentOpName = "-";
            let currentOpPic = "";
            let currentHistoryId = null;

            // หาคนล่าสุดที่ยังทำงานอยู่ (end_time is null) หรือคนสุดท้ายใน list
            const activeOp = finalOperatorList.find((h: any) => h.end_time === null);
            const lastOp = finalOperatorList.length > 0 ? finalOperatorList[finalOperatorList.length - 1] : null;

            // ✅ Priority: Cross-Day Active -> Today's Active -> Today's Last
            const displayOp = activeCrossDayOp || activeOp || lastOp;

            if (displayOp) {
                currentOpCode = displayOp.emp_no;
                // Handle both flattened (activeCrossDayOp) and nested (historyList) structures
                currentOpName = displayOp.operator_name || (displayOp.tbm_operator ? displayOp.tbm_operator.operator_name : "-");
                currentOpPic = displayOp.picture_path || (displayOp.tbm_operator ? displayOp.tbm_operator.picture_path : "");
                // Use ID from the displayed operator (whether cross-day or today's active)
                currentHistoryId = (activeCrossDayOp || activeOp) ? displayOp.id : null;
            }

            setHistoryId(currentHistoryId);

            // Check Logout Permission
            const localOperatorCode = localStorage.getItem("operatorLocal");
            if (activeOp && localOperatorCode && localOperatorCode === activeOp.emp_no) {
                setCanLogout(true);
            } else {
                setCanLogout(false);
            }

            // --- 2. Process OEE & Table Data ---
            const oeeData = resOEE.data;
            const tableDataRaw = resTable.data;

            setTableData({
                model: tableDataRaw.model || "-",
                achieve: tableDataRaw.Achieve || 0,
                oee: oeeData.oee_value || 0,
                oeeDate: oeeData.date ? dayjs(oeeData.date).format("DD/MM/YYYY") : "-",
                operatorCode: currentOpCode,
                operatorName: currentOpName,
                operatorPic: currentOpPic ? `${config.apiServer}/image/${currentOpPic}` : "", // Fix logic to use logic from component if possible, or just path
                operators: displayOp ? [displayOp] : [], // ✅ Show ONLY the display operator (Active/Last)
                outputActual: tableDataRaw.outputActual || 0,
                outputTarget: tableDataRaw.outputTarget || 0,
                ctActual: tableDataRaw.cycleTimeActual || 0,
                ctTarget: tableDataRaw.cycleTimeTarget || 0,
                effActual: tableDataRaw.efficiencyActual || 0,
                effTarget: tableDataRaw.efficiencyTarget || 0,
            });
            const now = new Date();
            // เช็คว่าเป็น "วันนี้" หรือไม่ (เทียบวันที่จาก param กับวันที่ปัจจุบัน)
            // หมายเหตุ: ใช้ new Date().toISOString().split('T')[0] เพื่อให้ได้ YYYY-MM-DD

            const currentHour = now.getHours();

            // ฟังก์ชันช่วย map ข้อมูล: ถ้าเป็น index ในอนาคตของวันนี้ ให้ return null
            const filterFutureData = (dataArray: any[], hoursArray: string[]) => {
                if (!isToday) return dataArray; // ถ้าดูย้อนหลัง ให้แสดงทั้งหมด

                // หา index ของชั่วโมงปัจจุบันใน array labels (เช่น "08:00" -> index 1)
                const currentIndex = hoursArray.findIndex((h: string) => parseInt(h) === currentHour);

                if (currentIndex === -1) return dataArray; // กันพลาด

                return dataArray.map((val, index) => {
                    // ถ้า index มากกว่าปัจจุบัน = อนาคต -> ให้เป็น null
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
                            data: g1.outputActual, // รายชั่วโมง
                            backgroundColor: "#00b050", // Green
                            yAxisID: "y_qty",
                            order: 4,
                            datalabels: {
                                display: true,        // บังคับให้แสดง (Override ค่า global)
                                align: 'end',         // จัดตำแหน่งให้อยู่ด้านบนแท่ง
                                anchor: 'start',        // ยึดจุดอ้างอิงที่ส่วนท้ายของแท่ง
                                color: 'white',       // สีตัวอักษร
                                font: {
                                    weight: 'bold'    // ตัวหนา
                                },
                                // ✅ Logic: ถ้าค่า > 0 ให้แสดงค่า, ถ้าไม่ ให้ return null (ไม่แสดง)
                                formatter: (value: any) => {
                                    return value > 0 ? value : null;
                                }
                            }
                        },
                        {
                            type: "line",
                            label: "Output Target",
                            data: g1.outputTarget, // รายชั่วโมง
                            borderColor: "#385723", // Dark Green
                            borderWidth: 5,
                            borderDash: [5, 5], // เส้นประ
                            pointRadius: 0,
                            yAxisID: "y_qty",
                            order: 3,
                            datalabels: {
                                display: true,
                                align: 'left',      // ✅ แนะนำ 'right' หรือ 'end' เพื่อให้ข้อความไม่ตกขอบซ้าย (มันจะอยู่ขวาของจุดที่ 0)
                                anchor: 'center',    // ยึดที่จุดกึ่งกลาง
                                backgroundColor: '#385723',
                                color: 'white',
                                borderRadius: 4,
                                font: { weight: 'bold', size: 10 },
                                padding: 4,
                                formatter: (value: any, context: any) => {
                                    // ✅ Logic ใหม่: เช็คว่าเป็น index ที่ 0 (ซ้ายสุด) หรือไม่
                                    if (context.dataIndex === 0) {
                                        return `Target: ${value}`;
                                    }
                                    return null; // จุดอื่นไม่แสดง
                                }
                            }
                        },
                        {
                            type: "line",
                            label: "Output Accum",
                            // ✅ แก้ไขตรงนี้: เรียกใช้ filterFutureData
                            data: filterFutureData(g1.outputActualAccum, g1.hours),
                            // data: g1.outputActualAccum,
                            borderColor: "#c00000",
                            backgroundColor: "#c00000",
                            borderWidth: 3,
                            pointRadius: 4,
                            yAxisID: "y_accum",
                            order: 1
                        },
                        {
                            type: "line",
                            label: "Output Target Accum",
                            data: g1.outputTargetAccum, // สะสม
                            borderColor: "#f062b0ff", // Pink
                            borderWidth: 5,
                            borderDash: [5, 5], // เส้นประ
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
                            backgroundColor: "#5b9bd5", // Blue
                            yAxisID: "y_ct",
                            order: 4
                        },
                        {
                            type: "line",
                            label: "Cycle Time Target",
                            data: g2.cycleTimeTarget,
                            borderColor: "#203864", // Dark Blue
                            borderWidth: 5,
                            borderDash: [5, 5], // เส้นประ
                            pointRadius: 0,
                            yAxisID: "y_ct",
                            order: 1,
                            datalabels: {
                                display: true,
                                align: 'left',      // ✅ แนะนำ 'right' หรือ 'end' เพื่อให้ข้อความไม่ตกขอบซ้าย (มันจะอยู่ขวาของจุดที่ 0)
                                anchor: 'center',    // ยึดที่จุดกึ่งกลาง
                                backgroundColor: '#385723',
                                color: 'white',
                                borderRadius: 4,
                                font: { weight: 'bold', size: 10 },
                                padding: 4,
                                formatter: (value: any, context: any) => {
                                    // ✅ Logic ใหม่: เช็คว่าเป็น index ที่ 0 (ซ้ายสุด) หรือไม่
                                    if (context.dataIndex === 0) {
                                        return `Target: ${value}`;
                                    }
                                    return null; // จุดอื่นไม่แสดง
                                }
                            }
                        },
                        {
                            type: "line",
                            label: "Efficiency Actual",
                            // ✅ แก้ไขตรงนี้: เรียกใช้ filterFutureData
                            data: filterFutureData(g2.efficiencyActual, g2.hours),
                            // data: g2.efficiencyActual,
                            borderColor: "#02630fff",
                            backgroundColor: "#02630fff",
                            borderWidth: 3,
                            pointRadius: 4,
                            yAxisID: "y_eff",
                            order: 3
                        },
                        {
                            type: "line",
                            label: "Efficiency Target",
                            data: g2.efficiencyTarget,
                            borderColor: "#ff6600ff", // Dark Orange
                            borderWidth: 5,
                            borderDash: [5, 5], // เส้นประ
                            pointRadius: 0,
                            yAxisID: "y_eff",
                            order: 2,
                            datalabels: {
                                display: true,
                                align: 'right',     // จัดตำแหน่งให้อยู่ขวา
                                anchor: 'center',
                                backgroundColor: '#385723', // พื้นหลังสีเดียวกับเส้น
                                color: 'white',     // ตัวหนังสือสีขาว
                                borderRadius: 4,
                                font: { weight: 'bold', size: 10 },
                                padding: 4,
                                // ✅ Logic: ให้แสดงค่าเฉพาะจุดข้อมูลตัวสุดท้ายของ array เพื่อไม่ให้เลขซ้ำๆ เต็มกราฟ
                                formatter: (value: any, context: any) => {
                                    const dataArray = context.chart.data.datasets[context.datasetIndex].data;
                                    // เช็คว่าเป็น index สุดท้ายของ array หรือไม่
                                    if (context.dataIndex === dataArray.length - 1) {
                                        return `Target: ${value}`; // แสดงคำว่า Target: 100
                                    }
                                    return null; // จุดอื่นไม่ต้องแสดง
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

    // ================= Handlers =================

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        if (!newDate) return;

        setCurrentDateStr(newDate);

        // Update LocalStorage
        localStorage.setItem("machineDateLocal", newDate);

        // Update URL
        const params = new URLSearchParams(searchParams.toString());
        params.set("date", newDate);
        router.replace(`?${params.toString()}`);

        // Fetch new data
        if (machineName) {
            fetchAllData(machineName, newDate);
        }
    };

    const handleLogout = async () => {
        if (!historyId) return;

        const result = await Swal.fire({
            title: "Sign out?",
            text: `ต้องการลงชื่อออก: ${tableData.operatorCode}?`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            confirmButtonText: "Logout",
            cancelButtonText: "Cancel",
        });

        if (result.isConfirmed) {
            try {
                await axios.put(`${config.apiServer}/api/historyWorking/updateEndTime/${historyId}`);

                localStorage.removeItem("operatorLocal");
                localStorage.removeItem("machineDateLocal");
                localStorage.removeItem("machineNameLocal");

                Swal.fire({
                    icon: "success",
                    title: "Logged out",
                    timer: 1000,
                    showConfirmButton: false
                }).then(() => {
                    router.push("/oee_production/machine_area");
                });

            } catch (e: any) {
                Swal.fire("Error", e.message, "error");
            }
        }
    };

    // ================= Chart Options =================

    // ================= Chart Options (Updated) =================

    // [Graph 1] Output Monitor Options (Dual Axis)
    const optionsGraph1: ChartOptions<"bar" | "line"> = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    usePointStyle: false, // ✅ เปลี่ยนเป็น false เพื่อให้ Bar เป็นกล่อง และ Line เป็นเส้น
                    boxWidth: 25,         // ✅ ปรับความกว้างเพื่อให้เห็นเส้นชัดขึ้น (โดยเฉพาะเส้นประ)
                    padding: 15,          // ระยะห่างระหว่างรายการ
                    font: {
                        size: 12
                    }
                }
            },
            title: { display: false },

            datalabels: { display: false }
        },
        scales: {
            x: { grid: { display: false } },
            // แกนซ้าย: Qty/hour
            y_qty: {
                type: 'linear',
                display: true,
                position: 'left',
                title: { display: true, text: 'Output Actual [pcs/hour]', color: '#00b050' },
                beginAtZero: true,
            },
            // แกนขวา: Accum
            y_accum: {
                type: 'linear',
                display: true,
                position: 'right',
                title: { display: true, text: 'Output Accum [pcs]', color: '#c00000' },
                beginAtZero: true,
                grid: { drawOnChartArea: false }
            }
        }
    };

    // [Graph 2] CT & Efficiency Monitor Options
    const optionsGraph2: ChartOptions<"bar" | "line"> = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    usePointStyle: false, // ✅ เปลี่ยนเป็น false: Bar=สี่เหลี่ยม, Line=เส้น
                    boxWidth: 25,         // ✅ ปรับความกว้างให้เห็นเส้นประชัดเจน
                    padding: 15
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
                title: { display: true, text: 'Cycle time [sec]', color: '#5b9bd5' },
                beginAtZero: true,
            },
            y_eff: {
                type: 'linear',
                display: true,
                position: 'right',
                title: { display: true, text: 'Efficiency [%]', color: '#ed7d31' },
                min: 0,
                max: 120,
                grid: { drawOnChartArea: false }
            },
        }
    };

    // ================= Render =================

    return (
        <div className="container-fluid min-vh-100 d-flex flex-column bg-light overflow-auto">
            <div className="row flex-grow-1 p-3">
                <div className="col-12 d-flex flex-column">

                    {/* --- TABLE SECTION --- */}
                    <div className="card shadow-sm border border-dark mb-3">
                        <div className="card-body p-0">
                            <div className="table-responsive">
                                <table className="table table-bordered align-middle text-center fs-5 m-0">
                                    <thead className="table-primary">
                                        <tr>
                                            <th style={{ width: "12%" }}>Date</th>
                                            <th style={{ width: "15%" }}>MC Name</th>
                                            <th style={{ width: "15%" }}>Model</th>
                                            <th style={{ width: "15%" }}>Achieve</th>
                                            <th style={{ width: "15%" }}>OEE (Last)</th>
                                            <th style={{ width: "18%" }}>Operator</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            {/* Date / Time */}
                                            <td rowSpan={2} className="fw-semibold">
                                                {/* ✅ Logic: If History Mode (has 'date' param), ALWAYS show Date Picker. */}
                                                {searchParams.get("date") ? (
                                                    <input
                                                        type="date"
                                                        className="form-control text-center fw-bold mx-auto"
                                                        style={{ maxWidth: "160px", cursor: "pointer" }}
                                                        value={currentDateStr}
                                                        onChange={handleDateChange}
                                                    />
                                                ) : (
                                                    <div>{dayjs(currentDateStr || new Date()).format("DD/MM/YYYY")}</div>
                                                )}

                                                {/* ✅ Logic: Show Time ONLY if it is Today */}
                                                {currentDateStr === new Date().toISOString().split("T")[0] && (
                                                    <div className="text-primary fw-bold fs-4">{clientTime}</div>
                                                )}
                                            </td>
                                            {/* Machine Info */}
                                            <td className="fw-bold text-primary">{machineName}</td>
                                            <td>{tableData.model}</td>
                                            {/* Achieve */}
                                            <td>
                                                <span className={`fw-bold ${tableData.achieve >= 100 ? "text-success" : "text-danger"}`}>
                                                    {tableData.achieve.toFixed(2)} %
                                                </span>
                                            </td>
                                            {/* OEE Gauge Value */}
                                            <td rowSpan={4} className="align-middle">
                                                <div className={`fs-1 fw-bold ${tableData.oee >= 85 ? "text-success" : "text-danger"}`}>
                                                    {tableData.oee.toFixed(2)} %
                                                </div>
                                                <small className="text-muted">Update: {tableData.oeeDate}</small>
                                            </td>
                                            {/* Operator Image & Name */}
                                            <td rowSpan={4} className="p-1 align-middle" style={{ verticalAlign: 'middle' }}>
                                                <div className="d-flex flex-column align-items-center justify-content-center h-100 w-100">
                                                    {tableData.operators && tableData.operators.length > 0 ? (
                                                        tableData.operators.map((op: any, index: number) => (
                                                            <div key={index} className="d-flex flex-column align-items-center w-100 p-2">
                                                                <img
                                                                    src={op.picture_path ? `${config.apiServer}/image/${op.picture_path}` : (op.tbm_operator?.picture_path ? `${config.apiServer}/image/${op.tbm_operator.picture_path}` : "/dist/img/avg.png")}
                                                                    alt="Operator"
                                                                    className="rounded border border-secondary bg-white mb-2"
                                                                    style={{ width: "80px", height: "80px", objectFit: "cover" }}
                                                                    onError={(e) => { (e.target as HTMLImageElement).src = "/dist/img/avg.png" }}
                                                                />
                                                                <div className="fw-bold text-dark fs-5">
                                                                    {op.emp_no}
                                                                </div>
                                                                <div className="text-muted" style={{ fontSize: "0.9rem" }}>
                                                                    {op.operator_name || op.tbm_operator?.operator_name || "-"}
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="text-muted mt-4">No Operator</div>
                                                    )}

                                                    {canLogout && (
                                                        <button
                                                            onClick={handleLogout}
                                                            className="btn btn-danger btn-sm mt-1 px-3 fw-bold shadow-sm w-auto"
                                                        >
                                                            <i className="fa-solid fa-right-from-bracket me-1"></i> Logout
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        {/* Row 2: Headers for Details */}
                                        <tr className="table-light fw-bold text-secondary" style={{ fontSize: "0.9rem" }}>
                                            <td>Output</td>
                                            <td>Cycle Time</td>
                                            <td>Efficiency</td>
                                        </tr>
                                        {/* Row 3: Actual Data */}
                                        <tr>
                                            <td className="fw-bold bg-light">Actual</td>

                                            {/* Output (ปกติ) */}
                                            <td className="fw-bold fs-5 text-dark">
                                                {tableData.outputActual.toLocaleString()} <small className="fs-6 fw-normal">pcs</small>
                                            </td>

                                            {/* ✅ แก้ไข Cycle Time: ถ้าเวลาจริง "มากกว่า" เป้าหมาย (ช้า) = สีแดง, ถ้าน้อยกว่าหรือเท่ากับ (เร็ว) = สีเขียว */}
                                            <td className={`fw-bold fs-5 ${tableData.ctActual > tableData.ctTarget ? "text-danger" : "text-success"}`}>
                                                {tableData.ctActual.toFixed(2)} <small className="fs-6 fw-normal">sec</small>
                                            </td>

                                            {/* ✅ แก้ไข Efficiency: ถ้าประสิทธิภาพจริง "น้อยกว่า" เป้าหมาย (แย่) = สีแดง, ถ้ามากกว่าหรือเท่ากับ (ดี) = สีเขียว */}
                                            <td className={`fw-bold fs-5 ${tableData.effActual < tableData.effTarget ? "text-danger" : "text-success"}`}>
                                                {tableData.effActual.toFixed(2)} <small className="fs-6 fw-normal">%</small>
                                            </td>
                                        </tr>
                                        {/* Row 4: Target Data */}
                                        <tr>
                                            <td className="fw-bold bg-light text-secondary">Target</td>
                                            <td className="text-muted">{tableData.outputTarget.toLocaleString()} pcs</td>
                                            <td className="text-muted">{tableData.ctTarget.toFixed(2)} sec</td>
                                            <td className="text-muted">{tableData.effTarget.toFixed(2)} %</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* --- GRAPH SECTION (Split 2 Columns) --- */}
                    <div className="row g-3 flex-grow-1">
                        {/* Graph 1: Output */}
                        <div className="col-md-6 d-flex">
                            <div className="card w-100 shadow-sm border border-dark position-relative">
                                {/* ✅ ชื่อกราฟ 1 */}
                                <div className="card-header bg-white fw-bold text-center py-1 fs-5">Output Monitor</div>
                                <div className="card-body p-2 position-relative">
                                    {graph1Data ? (
                                        <Chart type="bar" data={graph1Data} options={optionsGraph1} />
                                    ) : (
                                        <div className="d-flex align-items-center justify-content-center h-100 text-muted">Loading Graph 1...</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Graph 2: CT & Eff */}
                        <div className="col-md-6 d-flex">
                            <div className="card w-100 shadow-sm border border-dark position-relative">
                                {/* Refresh Timer */}
                                <div
                                    className="position-absolute d-flex align-items-center px-2 py-1 rounded bg-light border"
                                    style={{ top: "10px", right: "10px", zIndex: 10, fontSize: "0.8rem" }}
                                >
                                    <i className="fas fa-sync-alt me-2 text-primary"></i>
                                    <span className="fw-bold text-dark">
                                        {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
                                    </span>
                                </div>

                                {/* ✅ ชื่อกราฟ 2 */}
                                <div className="card-header bg-white fw-bold text-center py-1 fs-5">Cycle Time & Efficiency Monitor</div>
                                <div className="card-body p-2">
                                    {graph2Data ? (
                                        <Chart type="bar" data={graph2Data} options={optionsGraph2} />
                                    ) : (
                                        <div className="d-flex align-items-center justify-content-center h-100 text-muted">Loading Graph 2...</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Custom Styles for Table Borders */}
            <style jsx>{`
                .table-bordered td, .table-bordered th {
                    border: 1px solid #dee2e6 !important;
                }
                .table-bordered thead th {
                    border-bottom-width: 2px;
                }
            `}</style>
        </div>
    );
}
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import config from "@/app/config";
import OverallMachineCard from "../components/Overall_machine_working";
import Swal from "sweetalert2";
import { getSocket } from "@/app/lib/socketManager";
import type { Socket } from "socket.io-client";

import { Suspense } from "react";

function OverallMachineContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const area = searchParams.get("area");
    const type = searchParams.get("type");
    const date = searchParams.get("date");

    const [machines, setMachines] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [serverTimeStr, setServerTimeStr] = useState("");
    const [socketRef, setSocketRef] = useState<Socket | null>(null);
    const [realtimeData, setRealtimeData] = useState<any>(null);
    const [activeView, setActiveViewState] = useState<"output" | "status">(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("overallMachineActiveView");
            if (saved === "output" || saved === "status") return saved;
        }
        return "output";
    });

    // Wrapper: save to localStorage on every toggle
    const setActiveView = (view: "output" | "status") => {
        setActiveViewState(view);
        localStorage.setItem("overallMachineActiveView", view);
    };

    // Clear localStorage when leaving the page
    useEffect(() => {
        return () => {
            localStorage.removeItem("overallMachineActiveView");
        };
    }, []);

    // Unified countdown timer + MC Status refresh trigger
    const [countdown, setCountdown] = useState(300);
    const [mcStatusRefreshTrigger, setMcStatusRefreshTrigger] = useState(0);
    useEffect(() => {
        if (activeView !== "status") {
            setCountdown(300);
            return;
        }
        setCountdown(300);
        const tickId = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    // Trigger refresh in all cards
                    setMcStatusRefreshTrigger(t => t + 1);
                    return 300;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(tickId);
    }, [activeView]);

    const formatCountdown = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    };

    // Pagination state
    const ITEMS_PER_PAGE = 6;
    const [currentPage, setCurrentPage] = useState(1);

    // คำนวณ pagination
    const totalPages = Math.max(1, Math.ceil(machines.length / ITEMS_PER_PAGE));
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const displayedMachines = machines.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    useEffect(() => {
        if (!area || !type || !date) {
            Swal.fire({
                title: "Missing Parameters",
                text: "Please select area, type and date from the previous page.",
                icon: "warning",
            }).then(() => {
                router.push("/oee_production/machine_area");
            });
            return;
        }

        fetchMachines();

        // Socket.IO connection
        const socket = getSocket();

        // 🏠 Join dashboard room (ดูทุกเครื่อง)
        socket.emit("joinRoom", "dashboard");

        // Server time
        socket.on("server_time", (isoStr: string) => {
            const serverTime = new Date(isoStr);
            setServerTimeStr(serverTime.toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Bangkok" }));
        });
        setSocketRef(socket);

        return () => {
            socket.emit("leaveRoom", "dashboard");
            socket.off("server_time");
        };
    }, [area, type, date]);

    // Socket.IO: Fast production update ทุก 2 วินาที (full production data)
    useEffect(() => {
        if (!socketRef) return;

        const fastHandler = (data: any) => {
            // Store full production data (Output, CT, Eff, Target, Achieve)
            setRealtimeData((prev: any) => {
                // First time: store directly
                if (!prev) return data;
                // Merge: keep MCStatus fields from slow loop, overwrite production data
                const merged = { ...data };
                if (prev.machines && data.machines) {
                    const mergedMachines = { ...data.machines };
                    for (const [name, machineData] of Object.entries(mergedMachines)) {
                        const prevMachine = prev.machines?.[name];
                        if (prevMachine?.daily?.availability !== undefined) {
                            // Keep MCStatus fields from previous slow loop data
                            (machineData as any).daily = {
                                ...(machineData as any).daily,
                                availability: prevMachine.daily.availability,
                                performance: prevMachine.daily.performance,
                                quality: prevMachine.daily.quality,
                                oee: prevMachine.daily.oee,
                            };
                        }
                    }
                    merged.machines = mergedMachines;
                }
                return merged;
            });

            // Date rollover check
            const serverDate = data.shiftDate;
            if (serverDate && date && date !== serverDate) {
                const todayWhenLoaded = date;
                if (todayWhenLoaded === new Date().toISOString().split("T")[0]) {
                    console.log(`Date Rollover: ${date} -> ${serverDate}`);
                    router.replace(`/overall_machine_working?area=${area}&type=${type}&date=${serverDate}`);
                }
            }
        };

        socketRef.on("realtime_output", fastHandler);
        return () => { socketRef.off("realtime_output", fastHandler); };
    }, [socketRef, area, type, date, router]);

    // Socket.IO: Slow status update ทุก 5 นาที (เฉพาะ Availability, Performance, Quality, OEE)
    useEffect(() => {
        if (!socketRef) return;

        const statusHandler = (data: any) => {
            setRealtimeData((prev: any) => {
                if (!prev) return prev;
                const merged = { ...prev };
                if (data.machines && prev.machines) {
                    const mergedMachines = { ...prev.machines };
                    for (const [name, statusData] of Object.entries(data.machines)) {
                        if (mergedMachines[name]) {
                            mergedMachines[name] = {
                                ...mergedMachines[name],
                                daily: {
                                    ...mergedMachines[name].daily,
                                    ...(statusData as any).daily,
                                },
                            };
                        }
                    }
                    merged.machines = mergedMachines;
                }
                return merged;
            });
        };

        socketRef.on("realtime_update", statusHandler);
        return () => { socketRef.off("realtime_update", statusHandler); };
    }, [socketRef]);

    const fetchMachines = async () => {
        try {
            const res = await axios.get(`${config.apiServer}/api/machine/listMachines/${area}/${type}`);
            if (res.data && res.data.results) {
                setMachines(res.data.results);
            }
        } catch (error: any) {
            console.error("Error fetching machines:", error);
        } finally {
            setLoading(false);
        }
    };

    // Reset to page 1 when type/area changes
    useEffect(() => {
        setCurrentPage(1);
    }, [type, area]);

    // Clamp currentPage if machines list shrinks
    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [totalPages, currentPage]);

    // Calculate grid dimensions based on displayed machines on THIS page (max 6)
    const viewCount = displayedMachines.length;
    let gridStyle: React.CSSProperties = {
        display: "grid",
        gap: "8px",
        flex: 1,
        minHeight: 0,
    };
    let scaleFactor = 1.0;

    if (viewCount === 1) {
        // 1 เครื่อง: เต็มจอ
        gridStyle.gridTemplateColumns = "1fr";
        gridStyle.gridTemplateRows = "1fr";
        scaleFactor = 1.0;
    } else if (viewCount === 2) {
        // 2 เครื่อง: ซ้าย-ขวา
        gridStyle.gridTemplateColumns = "1fr 1fr";
        gridStyle.gridTemplateRows = "1fr";
        scaleFactor = 1.0;
    } else if (viewCount <= 4) {
        // 3-4 เครื่อง: 2×2
        gridStyle.gridTemplateColumns = "repeat(2, 1fr)";
        gridStyle.gridTemplateRows = "repeat(2, 1fr)";
        scaleFactor = 0.9;
    } else {
        // 5-6 เครื่อง: 3×2 (max per page)
        gridStyle.gridTemplateColumns = "repeat(3, 1fr)";
        gridStyle.gridTemplateRows = "repeat(2, 1fr)";
        scaleFactor = 0.85;
    }

    return (
        <div className="container-fluid p-2 d-flex flex-column" style={{ backgroundColor: "#f4f6f9", height: "100vh", overflow: "hidden" }}>
            <div className="d-flex align-items-center justify-content-between mb-2" style={{ height: "50px", flexShrink: 0 }}>
                <div>
                    <h4 className="d-inline-block fw-bold text-dark m-0">
                        Overall: <span className="text-primary">{type}</span>
                    </h4>
                </div>
                <div className="fs-6 text-muted d-flex align-items-center gap-3">
                    <div className="d-flex align-items-center gap-2">
                        <span className="fw-bold">Date:</span>
                        <input
                            type="date"
                            className="form-control form-control-sm border-primary fw-bold text-primary"
                            style={{ width: "140px" }}
                            value={date || ""}
                            onChange={(e) => {
                                const newDate = e.target.value;
                                if (newDate) {
                                    router.replace(`/overall_machine_working?area=${area}&type=${type}&date=${newDate}`);
                                }
                            }}
                        />
                    </div>
                    <span>Area: <span className="fw-bold text-dark">{area}</span></span>
                    {/* Toggle: Output / MC Status */}
                    <div className="btn-group btn-group-sm" role="group">
                        <button
                            className={`btn ${activeView === "output" ? "btn-primary" : "btn-outline-primary"} fw-bold px-3`}
                            onClick={() => setActiveView("output")}
                        >
                            <i className="fas fa-chart-bar me-1"></i>Output
                        </button>
                        <button
                            className={`btn ${activeView === "status" ? "btn-primary" : "btn-outline-primary"} fw-bold px-3`}
                            onClick={() => setActiveView("status")}
                        >
                            <i className="fas fa-cogs me-1"></i>MC Status
                        </button>
                    </div>
                    {activeView === "status" ? (
                        <span className="badge bg-warning text-dark">
                            <i className="fas fa-sync-alt me-1"></i>{formatCountdown(countdown)}
                        </span>
                    ) : (
                        <span className="badge bg-success">📡 Real-time</span>
                    )}
                    {serverTimeStr && <span className="badge bg-info text-dark">{serverTimeStr}</span>}
                    <button
                        className="btn btn-sm btn-outline-secondary me-3"
                        onClick={() => {
                            localStorage.removeItem("overallMachineActiveView");
                            router.back();
                        }}
                    >
                        <i className="fas fa-arrow-left me-2"></i> Back
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="d-flex justify-content-center align-items-center flex-grow-1">
                    <div className="spinner-border text-primary" role="status" style={{ width: "3rem", height: "3rem" }}>
                        <span className="visually-hidden">Loading...</span>
                    </div>
                </div>
            ) : (
                <>
                    <div style={gridStyle}>
                        {displayedMachines.length > 0 ? (
                            displayedMachines.map((machine) => (
                                <div key={machine.id} style={{ minWidth: 0, minHeight: 0 }}>
                                    <OverallMachineCard
                                        machineName={machine.machine_name}
                                        date={date || ""}
                                        refreshTrigger={refreshTrigger}
                                        realtimeData={realtimeData && realtimeData.machines ? realtimeData.machines[machine.machine_name] : null}
                                        activeView={activeView}
                                        mcStatusRefreshTrigger={mcStatusRefreshTrigger}
                                        scaleFactor={scaleFactor}
                                    />
                                </div>
                            ))
                        ) : (
                            <div className="d-flex justify-content-center align-items-center w-100 h-100" style={{ gridColumn: `1 / -1` }}>
                                <h4 className="text-muted">No machines found for this type.</h4>
                            </div>
                        )}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="d-flex justify-content-center align-items-center gap-3 py-1" style={{ flexShrink: 0 }}>
                            <button
                                className="btn btn-sm btn-outline-primary fw-bold px-3"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(p => p - 1)}
                            >
                                <i className="fas fa-chevron-left me-1"></i> Prev
                            </button>
                            <span className="fw-bold text-secondary" style={{ fontSize: "0.85rem" }}>
                                Page {currentPage} / {totalPages}
                                <span className="text-muted ms-2">({machines.length} machines)</span>
                            </span>
                            <button
                                className="btn btn-sm btn-outline-primary fw-bold px-3"
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(p => p + 1)}
                            >
                                Next <i className="fas fa-chevron-right ms-1"></i>
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default function OverallMachineWorkingPage() {
    return (
        <Suspense fallback={
            <div className="d-flex justify-content-center align-items-center vh-100">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
            </div>
        }>
            <OverallMachineContent />
        </Suspense>
    );
}

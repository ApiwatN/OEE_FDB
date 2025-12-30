"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import axios from "axios";
import config from "@/app/config";
import OverallMachineCard from "../components/Overall_machine_working";
import Swal from "sweetalert2";

import { Suspense } from "react";

function OverallMachineContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const area = searchParams.get("area");
    const type = searchParams.get("type");
    const date = searchParams.get("date");

    const [machines, setMachines] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshCountdown, setRefreshCountdown] = useState(300);

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
    }, [area, type, date]);

    // Auto-refresh logic
    useEffect(() => {
        const timer = setInterval(() => {
            setRefreshCountdown((prev) => {
                if (prev <= 1) {
                    fetchMachines();
                    return 300;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [area, type]);

    const fetchMachines = async () => {
        try {
            // Don't set loading to true on background refresh to avoid flickering
            // setLoading(true); 
            const res = await axios.get(`${config.apiServer}/api/machine/listMachines/${area}/${type}`);
            if (res.data && res.data.results) {
                setMachines(res.data.results);
            }
        } catch (error: any) {
            console.error("Error fetching machines:", error);
            // Silent error on auto-refresh
        } finally {
            setLoading(false);
        }
    };

    // Calculate grid dimensions
    const count = machines.length;
    let cols = 1;
    let rows = 1;

    if (count > 0) {
        // Simple heuristic: try to keep aspect ratio reasonable
        // Full HD is 16:9.
        cols = Math.ceil(Math.sqrt(count));

        // Adjustment for specific counts to better fit wide screen
        if (count === 2) cols = 2;
        if (count === 6) cols = 3;
        if (count === 8) cols = 4; // 4x2

        rows = Math.ceil(count / cols);
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
                    <span>Refresh in:<span className="fw-bold text-dark"></span></span>
                    <span className="badge bg-warning text-dark" style={{ width: "40px" }}>{refreshCountdown}</span>
                    <span>sec<span className="fw-bold text-dark"></span></span>
                    <button
                        className="btn btn-sm btn-outline-secondary me-3"
                        onClick={() => router.back()}
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
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${cols}, 1fr)`,
                        gridTemplateRows: `repeat(${rows}, 1fr)`,
                        gap: "8px",
                        flexGrow: 1,
                        minHeight: 0 // Important for flex child scrolling/sizing
                    }}
                >
                    {machines.length > 0 ? (
                        machines.map((machine) => (
                            <div key={machine.id} style={{ minWidth: 0, minHeight: 0 }}>
                                <OverallMachineCard
                                    machineName={machine.machine_name}
                                    date={date || ""}
                                />
                            </div>
                        ))
                    ) : (
                        <div className="d-flex justify-content-center align-items-center w-100 h-100" style={{ gridColumn: `1 / -1` }}>
                            <h4 className="text-muted">No machines found for this type.</h4>
                        </div>
                    )}
                </div>
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

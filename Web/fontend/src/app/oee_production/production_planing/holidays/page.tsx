"use client";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Swal from "sweetalert2";
import axios from "axios";
import dayjs from "dayjs";
import config from "@/app/config";
import LoadingSpinner from "@/app/components/LoadingSpinner";

export default function Page() {
    return (
        <Suspense fallback={<LoadingSpinner message="Loading..." />}>
            <HolidayCalendarPage />
        </Suspense>
    );
}

function HolidayCalendarPage() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const machineName = searchParams.get("machine") || "";
    const area = searchParams.get("area") || "";
    const type = searchParams.get("type") || "";

    const [currentMonth, setCurrentMonth] = useState(dayjs().month());
    const [currentYear, setCurrentYear] = useState(dayjs().year());
    const [holidays, setHolidays] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    // Copy panel
    const [allMachines, setAllMachines] = useState<any[]>([]);
    const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
    const [copyStartDate, setCopyStartDate] = useState("");
    const [copyEndDate, setCopyEndDate] = useState("");
    const [copying, setCopying] = useState(false);

    useEffect(() => {
        if (machineName) {
            fetchHolidays();
            fetchAllMachines();
        }
    }, [machineName, currentMonth, currentYear]);

    useEffect(() => {
        const start = dayjs().year(currentYear).month(currentMonth).startOf("month").format("YYYY-MM-DD");
        const end = dayjs().year(currentYear).month(currentMonth).endOf("month").format("YYYY-MM-DD");
        setCopyStartDate(start);
        setCopyEndDate(end);
    }, [currentMonth, currentYear]);

    const fetchHolidays = async () => {
        setLoading(true);
        try {
            const r = await axios.get(`${config.apiServer}/api/holiday/list/${machineName}?year=${currentYear}&month=${currentMonth + 1}`);
            setHolidays(r.data.results.map((h: any) => h.date));
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const fetchAllMachines = async () => {
        try {
            if (area && type && type !== "all") {
                const r = await axios.get(`${config.apiServer}/api/machine/listMachines/${area}/${type}`);
                setAllMachines((r.data.results || []).filter((m: any) => m.machine_name !== machineName));
            } else if (area && area !== "all") {
                const r = await axios.get(`${config.apiServer}/api/machine/listMachines/${area}/all`);
                setAllMachines((r.data.results || []).filter((m: any) => m.machine_name !== machineName));
            }
        } catch (e) { console.error(e); }
    };

    const handleToggle = async (dateStr: string) => {
        try {
            const r = await axios.post(`${config.apiServer}/api/holiday/toggle`, {
                machine_name: machineName,
                date: dateStr,
            });
            if (r.data.action === "added") {
                setHolidays(prev => [...prev, dateStr]);
            } else {
                setHolidays(prev => prev.filter(d => d !== dateStr));
            }
        } catch (e) {
            console.error(e);
            Swal.fire("Error", "Could not update holiday", "error");
        }
    };

    const handleCopy = async () => {
        if (selectedTargets.size === 0) {
            Swal.fire("Warning", "Please select at least 1 target machine", "warning");
            return;
        }
        const confirm = await Swal.fire({
            title: "Confirm Copy Holidays?",
            html: `From <b>${machineName}</b> to <b>${selectedTargets.size}</b> machine(s)<br/>Period: ${copyStartDate} to ${copyEndDate}`,
            icon: "question",
            showCancelButton: true,
            confirmButtonText: "Copy",
            cancelButtonText: "Cancel",
        });
        if (!confirm.isConfirmed) return;

        setCopying(true);
        try {
            const r = await axios.post(`${config.apiServer}/api/holiday/copy`, {
                from_machine: machineName,
                to_machines: Array.from(selectedTargets),
                start_date: copyStartDate,
                end_date: copyEndDate,
            });
            Swal.fire({ icon: "success", title: "Copy Successful", text: r.data.message, showConfirmButton: false, timer: 2000 });
            setSelectedTargets(new Set());
        } catch (e) {
            console.error(e);
            Swal.fire("Error", "Copy Failed", "error");
        }
        setCopying(false);
    };

    const toggleTarget = (name: string) => {
        setSelectedTargets(prev => {
            const next = new Set(prev);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
        });
    };

    const selectAllTargets = () => {
        if (selectedTargets.size === allMachines.length) setSelectedTargets(new Set());
        else setSelectedTargets(new Set(allMachines.map(m => m.machine_name)));
    };

    // ── Calendar Grid ──
    const firstDay = dayjs().year(currentYear).month(currentMonth).startOf("month");
    const daysInMonth = firstDay.daysInMonth();
    const startDayOfWeek = (firstDay.day() + 6) % 7;

    const calendarCells: (string | null)[] = [];
    for (let i = 0; i < startDayOfWeek; i++) calendarCells.push(null);
    for (let d = 1; d <= daysInMonth; d++) calendarCells.push(firstDay.date(d).format("YYYY-MM-DD"));
    while (calendarCells.length % 7 !== 0) calendarCells.push(null);

    const prevMonth = () => {
        if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
        else setCurrentMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
        else setCurrentMonth(m => m + 1);
    };

    const monthName = dayjs().year(currentYear).month(currentMonth).format("MMMM YYYY");
    const today = dayjs().format("YYYY-MM-DD");

    return (
        <div className="card mt-3">
            {/* Header — same style as machine_area */}
            <div
                className="card-header position-relative fs-2 text-dark"
                style={{
                    background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)",
                    borderBottom: "1px solid #e0e0e0",
                    fontWeight: 600,
                    fontSize: "1.8rem",
                }}
            >
                <div className="d-flex align-items-center gap-2">
                    <i className="fa fa-calendar fs-4 text-danger"></i>
                    <span>Holiday Calendar — {machineName}</span>
                </div>

                <div className="position-absolute top-50 end-0 translate-middle-y me-3">
                    <button className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1"
                        onClick={() => router.push(`/oee_production/production_planing?area=${area}&type=${type}&machine_name=${machineName}`)}>
                        <i className="fa fa-arrow-left"></i> Back to Planning
                    </button>
                </div>
            </div>

            <div className="card-body">
                <div className="row g-4">
                    {/* ── Left: Calendar ── */}
                    <div className="col-lg-7">
                        <div className="rounded-3 shadow-sm" style={{ background: "linear-gradient(90deg, #f8f9fa, #fff)", border: "1px solid #e0e0e0" }}>
                            {/* Month Navigation */}
                            <div className="d-flex align-items-center justify-content-between px-3 py-2" style={{ borderBottom: "1px solid #e0e0e0" }}>
                                <button className="btn btn-outline-secondary btn-sm" onClick={prevMonth}>
                                    <i className="fa fa-chevron-left"></i>
                                </button>
                                <span className="fw-bold" style={{ fontSize: "1.2rem" }}>{monthName}</span>
                                <button className="btn btn-outline-secondary btn-sm" onClick={nextMonth}>
                                    <i className="fa fa-chevron-right"></i>
                                </button>
                            </div>

                            <div className="p-3">
                                {loading ? (
                                    <LoadingSpinner />
                                ) : (
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px" }}>
                                        {/* Day headers */}
                                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                                            <div key={d} className="text-center fw-bold" style={{
                                                padding: "6px", fontSize: "0.8rem",
                                                color: d === "Sat" || d === "Sun" ? "#d32f2f" : "#666",
                                            }}>
                                                {d}
                                            </div>
                                        ))}

                                        {/* Calendar Cells */}
                                        {calendarCells.map((dateStr, idx) => {
                                            if (!dateStr) return <div key={`e-${idx}`}></div>;
                                            const isHoliday = holidays.includes(dateStr);
                                            const isToday = dateStr === today;
                                            const dayNum = dayjs(dateStr).date();
                                            const isPast = dayjs(dateStr).isBefore(dayjs(), "day");

                                            return (
                                                <div key={dateStr}
                                                    onClick={() => handleToggle(dateStr)}
                                                    style={{
                                                        padding: "8px 4px",
                                                        textAlign: "center",
                                                        borderRadius: "6px",
                                                        cursor: "pointer",
                                                        fontWeight: isToday ? 800 : 600,
                                                        fontSize: "0.9rem",
                                                        transition: "all 0.15s ease",
                                                        background: isHoliday
                                                            ? "#ef5350"
                                                            : isToday
                                                                ? "#e3f2fd"
                                                                : "transparent",
                                                        color: isHoliday ? "#fff" : isPast ? "#bbb" : isToday ? "#1565c0" : "#333",
                                                        border: isToday && !isHoliday ? "2px solid #1565c0" : "1px solid transparent",
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        if (!isHoliday) (e.target as HTMLElement).style.background = "#f5f5f5";
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        if (!isHoliday && !isToday) (e.target as HTMLElement).style.background = "transparent";
                                                        else if (isToday && !isHoliday) (e.target as HTMLElement).style.background = "#e3f2fd";
                                                    }}
                                                >
                                                    {dayNum}
                                                    {isHoliday && <div style={{ fontSize: "0.5rem", marginTop: "-2px" }}>Holiday</div>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Legend */}
                                <div className="d-flex gap-3 mt-3 pt-2" style={{ borderTop: "1px solid #eee", fontSize: "0.8rem" }}>
                                    <span className="d-flex align-items-center gap-1">
                                        <span style={{ width: "14px", height: "14px", background: "#ef5350", borderRadius: "3px", display: "inline-block" }}></span>
                                        Holiday
                                    </span>
                                    <span className="d-flex align-items-center gap-1">
                                        <span style={{ width: "14px", height: "14px", background: "#e3f2fd", border: "2px solid #1565c0", borderRadius: "3px", display: "inline-block" }}></span>
                                        Today
                                    </span>
                                    <span className="text-muted">Click date to Add/Remove holiday</span>
                                </div>

                                <div className="mt-2 text-muted" style={{ fontSize: "0.85rem" }}>
                                    Holidays this month: <strong className="text-danger">{holidays.length}</strong> day(s)
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Right: Copy Panel ── */}
                    <div className="col-lg-5">
                        <div className="rounded-3 shadow-sm" style={{ background: "linear-gradient(90deg, #f8f9fa, #fff)", border: "1px solid #e0e0e0" }}>
                            <div className="px-3 py-2 fw-bold" style={{ borderBottom: "1px solid #e0e0e0", fontSize: "0.95rem" }}>
                                <i className="fa fa-copy me-2 text-primary"></i>Copy Holidays to other machines
                            </div>
                            <div className="p-3">
                                <div className="mb-3">
                                    <label className="form-label fw-semibold mb-1" style={{ fontSize: "0.85rem" }}>Source Machine:</label>
                                    <div className="fw-bold text-primary">{machineName}</div>
                                </div>

                                <div className="mb-3">
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <label className="form-label fw-semibold mb-0" style={{ fontSize: "0.85rem" }}>Select Target Machines:</label>
                                        <button className="btn btn-link btn-sm p-0" style={{ fontSize: "0.75rem" }} onClick={selectAllTargets}>
                                            {selectedTargets.size === allMachines.length ? "Deselect All" : "Select All"}
                                        </button>
                                    </div>

                                    {allMachines.length === 0 ? (
                                        <div className="text-muted" style={{ fontSize: "0.8rem" }}>No other machines found in same area/type</div>
                                    ) : (
                                        <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid #eee", borderRadius: "6px", padding: "8px" }}>
                                            {allMachines.map(m => (
                                                <div key={m.machine_name} className="form-check mb-1">
                                                    <input type="checkbox" className="form-check-input"
                                                        id={`chk-${m.machine_name}`}
                                                        checked={selectedTargets.has(m.machine_name)}
                                                        onChange={() => toggleTarget(m.machine_name)} />
                                                    <label className="form-check-label" htmlFor={`chk-${m.machine_name}`} style={{ fontSize: "0.85rem" }}>
                                                        {m.machine_name}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="row g-2 mb-3">
                                    <div className="col-6">
                                        <label className="form-label fw-semibold mb-1" style={{ fontSize: "0.8rem" }}>From Date</label>
                                        <input type="date" className="form-control form-control-sm"
                                            value={copyStartDate} onChange={e => setCopyStartDate(e.target.value)} />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label fw-semibold mb-1" style={{ fontSize: "0.8rem" }}>To Date</label>
                                        <input type="date" className="form-control form-control-sm"
                                            value={copyEndDate} onChange={e => setCopyEndDate(e.target.value)} />
                                    </div>
                                </div>

                                <button className="btn btn-primary w-100"
                                    disabled={copying || selectedTargets.size === 0}
                                    onClick={handleCopy}>
                                    {copying ? (
                                        <><i className="fa fa-spinner fa-spin me-2"></i>Copying...</>
                                    ) : (
                                        <><i className="fa fa-copy me-2"></i>Copy Holidays ({selectedTargets.size} machines)</>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* ── Holiday List ── */}
                        {holidays.length > 0 && (
                            <div className="mt-3 rounded-3 shadow-sm" style={{ background: "linear-gradient(90deg, #f8f9fa, #fff)", border: "1px solid #e0e0e0" }}>
                                <div className="px-3 py-2 fw-bold" style={{ borderBottom: "1px solid #e0e0e0", fontSize: "0.9rem", color: "#c62828" }}>
                                    <i className="fa fa-list me-2"></i>Holidays this month
                                </div>
                                <div className="px-3 py-2">
                                    <div className="d-flex flex-wrap gap-2">
                                        {holidays.sort().map(d => (
                                            <span key={d} className="badge d-flex align-items-center gap-1"
                                                style={{ background: "#ffcdd2", color: "#c62828", fontSize: "0.8rem", padding: "6px 10px", cursor: "pointer", borderRadius: "6px" }}
                                                onClick={() => handleToggle(d)}>
                                                {dayjs(d).format("DD MMM")}
                                                <i className="fa fa-times ms-1" style={{ fontSize: "0.65rem" }}></i>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

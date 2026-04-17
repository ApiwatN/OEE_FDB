"use client";
import { Suspense } from "react";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import config from "@/app/config";
import MyModal from "../components/MyModal";
import { getSocket } from "@/app/lib/socketManager";
import LoadingSpinner from "@/app/components/LoadingSpinner";

export default function Page() {
    return (
        <Suspense fallback={<LoadingSpinner message="Loading..." />}>
            <UpdateOeePage />
        </Suspense>
    );
}

function UpdateOeePage() {
    // ── Filter ──
    const [areas, setAreas] = useState<string[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [selectedArea, setSelectedArea] = useState(() => {
        if (typeof window !== "undefined") return localStorage.getItem("updateOee_area") || "all";
        return "all";
    });
    const [selectedType, setSelectedType] = useState(() => {
        if (typeof window !== "undefined") return localStorage.getItem("updateOee_type") || "all";
        return "all";
    });

    // ── Data ──
    const [machines, setMachines] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // ุุ Manual NG Modal (Multi-Day) ุุ
    const [editMachine, setEditMachine] = useState("");
    const [editYear, setEditYear] = useState(dayjs().year());
    const [editMonth, setEditMonth] = useState(dayjs().month() + 1); // 1-12
    const [history, setHistory] = useState<any[]>([]);
    const [ngEdits, setNgEdits] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    // Batch Multi-Machine states
    const [batchDate, setBatchDate] = useState(() => dayjs().subtract(1, "day").format("YYYY-MM-DD"));
    const [batchMachines, setBatchMachines] = useState<any[]>([]);
    const [batchNgEdits, setBatchNgEdits] = useState<Record<string, string>>({});
    const [batchSaving, setBatchSaving] = useState(false);

    useEffect(() => {
        fetchAreas();
    }, []);

    // โหลด types เมื่อมี area ที่บันทึกไว้
    useEffect(() => {
        if (selectedArea !== "all") fetchTypes(selectedArea);
    }, []); // eslint-disable-line

    useEffect(() => {
        if (selectedArea !== "all") fetchData();
        else setMachines([]);
    }, [selectedArea, selectedType]);

    // ── Socket.IO: Auto machines realtime update ──
    useEffect(() => {
        const socket = getSocket();
        const handler = (data: any) => {
            if (!data?.machines) return;
            setMachines(prev => prev.map(m => {
                if (m.oee_mode !== "auto") return m; // manual → ไม่ update
                const rt = data.machines[m.machine_name];
                if (!rt?.daily) return m;
                return {
                    ...m,
                    ng_qty: rt.daily.ngQty ?? m.ng_qty,
                    quality: rt.daily.quality ?? m.quality,
                    availability: rt.daily.availability ?? m.availability,
                    performance: rt.daily.performance ?? m.performance,
                    oee_value: rt.daily.oee ?? m.oee_value,
                };
            }));
        };
        socket.on("realtime_update", handler);
        return () => { socket.off("realtime_update", handler); };
    }, []);

    const fetchAreas = async () => {
        try {
            const r = await axios.get(`${config.apiServer}/api/machine/listArea`);
            setAreas(r.data.results.map((x: any) => x.machine_area));
        } catch (e) { console.error(e); }
    };

    const fetchTypes = async (area: string) => {
        if (area === "all") { setTypes([]); return; }
        try {
            const r = await axios.get(`${config.apiServer}/api/machine/listType/${area}`);
            setTypes(r.data.results || []);
        } catch (e) { console.error(e); }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const r = await axios.get(`${config.apiServer}/api/oee-update/list`, {
                params: { area: selectedArea, type: selectedType },
            });
            setMachines(r.data.results || []);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const handleAreaChange = async (area: string) => {
        setSelectedArea(area);
        setSelectedType("all");
        localStorage.setItem("updateOee_area", area);
        localStorage.setItem("updateOee_type", "all");
        await fetchTypes(area);
    };

    const CORRECT_PASSWORD = "minebeaIoT12";

    const handleSetMode = async (machineName: string, mode: string) => {
        const { value: password, isConfirmed } = await Swal.fire({
            title: "Authentication Required",
            text: `Enter password to switch to ${mode.toUpperCase()} mode`,
            input: "password",
            inputPlaceholder: "Enter password",
            inputAttributes: { autocomplete: "current-password" },
            showCancelButton: true,
            confirmButtonText: "Confirm",
            cancelButtonText: "Cancel",
            confirmButtonColor: "#0d6efd",
        });

        if (!isConfirmed) return; // User cancelled

        if (password !== CORRECT_PASSWORD) {
            Swal.fire({ icon: "error", title: "Incorrect Password", text: "Access denied. Please try again.", confirmButtonColor: "#d33" });
            return;
        }

        try {
            await axios.post(`${config.apiServer}/api/oee-update/set-mode`, {
                machine_name: machineName,
                oee_mode: mode,
            });
            Swal.fire({ icon: "success", title: `Mode → ${mode.toUpperCase()}`, text: machineName, timer: 1500, showConfirmButton: false });
            fetchData();
        } catch (e) {
            console.error(e);
            Swal.fire("Error", "Failed to set mode", "error");
        }
    };

    // ุุ Manual NG Modal (Multi-Day) ุุ
    const handleOpenManualNg = async (machineName: string) => {
        setEditMachine(machineName);
        setNgEdits({});
        const y = dayjs().year();
        const m = dayjs().month() + 1;
        setEditYear(y);
        setEditMonth(m);
        await loadHistory(machineName, y, m);
        showModal("modalManualNg");
    };

    const loadHistory = async (machine: string, year: number, month: number) => {
        try {
            const r = await axios.get(`${config.apiServer}/api/oee-update/history/${machine}`, {
                params: { year, month },
            });
            const results = r.data.results || [];
            setHistory(results);
            const edits: Record<string, string> = {};
            for (const h of results) {
                edits[h.date] = String(h.ng_qty || 0);
            }
            setNgEdits(edits);
        } catch (e) { console.error(e); }
    };

    const handleMonthChange = async (year: number, month: number) => {
        setEditYear(year);
        setEditMonth(month);
        await loadHistory(editMachine, year, month);
    };

    const handleSaveNgBatch = async () => {
        setSaving(true);
        try {
            // เก็บเฉพาะวันที่มีการเปลี่ยนแปลง
            const changedItems = history
                .filter(h => {
                    const editVal = parseInt(ngEdits[h.date] || "0", 10);
                    return editVal !== (h.ng_qty || 0);
                })
                .map(h => ({
                    date: h.date,
                    ng_qty: parseInt(ngEdits[h.date] || "0", 10),
                }));

            if (changedItems.length === 0) {
                Swal.fire({ icon: "info", title: "No Changes", text: "No changes detected", timer: 1500, showConfirmButton: false });
                setSaving(false);
                return;
            }

            await axios.post(`${config.apiServer}/api/oee-update/manual-ng-batch`, {
                machine_name: editMachine,
                items: changedItems,
            });

            Swal.fire({ icon: "success", title: `Saved ${changedItems.length} day(s)!`, timer: 1500, showConfirmButton: false });
            await loadHistory(editMachine, editYear, editMonth);
            fetchData();
        } catch (e) {
            console.error(e);
            Swal.fire("Error", "Failed to save NG data", "error");
        }
        setSaving(false);
    };

    const showModal = (id: string) => { const el = document.getElementById(id); if (el) new (window as any).bootstrap.Modal(el).show(); };
    const hideModal = (id: string) => { const el = document.getElementById(id); if (el) (window as any).bootstrap.Modal.getInstance(el)?.hide(); };

    // ── Batch Multi-Machine ──
    const handleOpenBatchMulti = async () => {
        // หาวันเมื่อวานล่าสุดที่ไม่ใช่วันหยุด
        let dt = dayjs().subtract(1, "day").format("YYYY-MM-DD");
        try {
            // ใช้ holiday ของเครื่องแรกที่เป็น manual เป็นตัวอ้างอิง
            const firstManual = machines.find(m => m.oee_mode === "manual");
            if (firstManual) {
                const r = await axios.get(`${config.apiServer}/api/holiday/list/${firstManual.machine_name}`);
                const holidaySet = new Set((r.data.results || []).map((h: any) => h.date));
                // ย้อนจากเมื่อวานไปสูงสุด 14 วัน หาวันที่ไม่ใช่วันหยุด
                for (let i = 1; i <= 14; i++) {
                    const candidate = dayjs().subtract(i, "day").format("YYYY-MM-DD");
                    if (!holidaySet.has(candidate)) {
                        dt = candidate;
                        break;
                    }
                }
            }
        } catch (e) { console.error(e); }
        setBatchDate(dt);
        await loadBatchMachines(dt);
        showModal("modalBatchMulti");
    };

    const loadBatchMachines = async (dt: string) => {
        try {
            // ดึง oee+output ของวันที่เลือก สำหรับเครื่อง manual ที่กรองไว้
            const manualMachines = machines.filter(m => m.oee_mode === "manual");
            if (manualMachines.length === 0) { setBatchMachines([]); return; }

            // ดึง OEE history ของแต่ละเครื่อง (reuse history endpoint)
            const promises = manualMachines.map(m =>
                axios.get(`${config.apiServer}/api/oee-update/history/${m.machine_name}`, {
                    params: { year: parseInt(dt.split("-")[0]), month: parseInt(dt.split("-")[1]) },
                }).then(r => {
                    const dayData = (r.data.results || []).find((h: any) => h.date === dt);
                    return {
                        machine_name: m.machine_name,
                        total_output: dayData?.total_output || 0,
                        ng_qty: dayData?.ng_qty || 0,
                        availability: dayData?.availability || 0,
                        performance: dayData?.performance || 0,
                        quality: dayData?.quality || 0,
                        oee_value: dayData?.oee_value || 0,
                    };
                }).catch(() => ({
                    machine_name: m.machine_name,
                    total_output: 0, ng_qty: 0, availability: 0, performance: 0, quality: 0, oee_value: 0,
                }))
            );
            const results = await Promise.all(promises);
            setBatchMachines(results);

            const edits: Record<string, string> = {};
            for (const r of results) edits[r.machine_name] = String(r.ng_qty || 0);
            setBatchNgEdits(edits);
        } catch (e) { console.error(e); }
    };

    const getBatchPreview = (m: any) => {
        const ngVal = parseInt(batchNgEdits[m.machine_name] || "0", 10);
        const output = m.total_output || 0;
        const quality = output > 0 ? ((output - ngVal) / output) * 100 : 0;
        const oee = (m.availability > 0 && m.performance > 0 && quality > 0)
            ? (m.availability / 100) * (m.performance / 100) * (quality / 100) * 100 : 0;
        const changed = ngVal !== (m.ng_qty || 0);
        return { quality, oee, changed };
    };

    const handleSaveBatchMulti = async () => {
        setBatchSaving(true);
        try {
            // ส่งทุกเครื่องเพื่อบังคับคำนวณ OEE ทุกเครื่อง (แม้ NG = 0)
            const allItems = batchMachines.map(m => ({
                machine_name: m.machine_name,
                ng_qty: parseInt(batchNgEdits[m.machine_name] || "0", 10),
            }));

            if (allItems.length === 0) {
                Swal.fire({ icon: "info", title: "No Machines", text: "No machines to save", timer: 1500, showConfirmButton: false });
                setBatchSaving(false);
                return;
            }

            await axios.post(`${config.apiServer}/api/oee-update/manual-ng-multi-machine`, {
                date: batchDate,
                items: allItems,
            });

            Swal.fire({ icon: "success", title: `Saved ${allItems.length} machine(s)!`, timer: 1500, showConfirmButton: false });
            await loadBatchMachines(batchDate);
            fetchData();
        } catch (e) {
            console.error(e);
            Swal.fire("Error", "Failed to save batch NG data", "error");
        }
        setBatchSaving(false);
    };

    // Preview: คำนวณ Quality/OEE ให้แต่ละแถวจาก NG ที่กรอก
    const getPreview = (h: any) => {
        const ngVal = parseInt(ngEdits[h.date] || "0", 10);
        const output = h.total_output || 0;
        const quality = output > 0 ? ((output - ngVal) / output) * 100 : 0;
        const oee = (h.availability > 0 && h.performance > 0 && quality > 0)
            ? (h.availability / 100) * (h.performance / 100) * (quality / 100) * 100 : 0;
        const changed = ngVal !== (h.ng_qty || 0);
        return { quality, oee, changed };
    };

    return (
        <>
            <div className="card mt-3">
                <div className="card-header position-relative fs-2 text-dark"
                    style={{ background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)", borderBottom: "1px solid #e0e0e0", fontWeight: 600, fontSize: "1.8rem" }}>
                    <div className="d-flex align-items-center gap-2">
                        <i className="fa fa-sync-alt fs-4 text-primary"></i>
                        <span>Update OEE</span>
                    </div>
                </div>

                <div className="card-body">
                    {/* Filters */}
                    <div className="d-flex gap-3 align-items-end mb-3">
                        <div style={{ flex: 1 }}>
                            <div className="fs-5 mb-1">Select Area</div>
                            <select className="form-select" value={selectedArea} onChange={e => handleAreaChange(e.target.value)}>
                                <option value="all">-- Select Area --</option>
                                {areas.map(a => <option key={a}>{a}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <div className="fs-5 mb-1">Select Type</div>
                            <select className="form-select" value={selectedType} onChange={e => { setSelectedType(e.target.value); localStorage.setItem("updateOee_type", e.target.value); }}>
                                <option value="all">-- All Types --</option>
                                {types.map(t => <option key={t}>{t}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 0 }} className="d-flex gap-2 align-self-end">
                            <button className="btn btn-warning btn-sm px-3" onClick={handleOpenBatchMulti}
                                disabled={machines.filter(m => m.oee_mode === "manual").length === 0}
                                title="Fill NG for multiple machines in one day" style={{ whiteSpace: "nowrap", height: "38px" }}>
                                <i className="fa fa-edit me-1"></i>Fill NG
                            </button>
                            <button className="btn btn-outline-primary btn-sm px-3" onClick={fetchData} disabled={loading}
                                style={{ whiteSpace: "nowrap", height: "38px" }}>
                                <i className={`fa ${loading ? "fa-spinner fa-spin" : "fa-refresh"} me-1`}></i>Refresh
                            </button>
                        </div>
                    </div>

                    {selectedArea === "all" ? (
                        <div className="text-center py-5 text-muted">
                            <i className="fa fa-hand-pointer" style={{ fontSize: "2.5rem", opacity: 0.4 }}></i>
                            <p className="mt-3">Select Area to view OEE settings</p>
                        </div>
                    ) : loading ? (
                        <LoadingSpinner />
                    ) : (
                        <div className="rounded-3 shadow-sm" style={{ background: "#fff", border: "1px solid #e0e0e0", overflow: "hidden" }}>
                            <div className="table-responsive">
                                <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.88rem" }}>
                                    <thead>
                                        <tr style={{ background: "linear-gradient(90deg, #f8f9fa, #fff)", borderBottom: "2px solid #e0e0e0" }}>
                                            <th style={{ width: "40px" }}>#</th>
                                            <th>Machine</th>
                                            <th>Type</th>
                                            <th className="text-center">OEE Mode</th>

                                            <th className="text-center" style={{ width: "180px" }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {machines.map((m, i) => (
                                            <tr key={m.machine_name}>
                                                <td className="text-muted">{i + 1}</td>
                                                <td className="fw-bold">{m.machine_name}</td>
                                                <td className="text-muted">{m.machine_type}</td>
                                                <td className="text-center">
                                                    <span className={`badge ${m.oee_mode === "auto" ? "bg-success" : "bg-warning text-dark"}`} style={{ fontSize: "0.75rem" }}>
                                                        {m.oee_mode === "auto" ? "🟢 Auto" : "📝 Manual"}
                                                    </span>
                                                </td>

                                                <td className="text-center">
                                                    <div className="d-flex gap-1 justify-content-center">
                                                        <select className="form-select form-select-sm" style={{ width: "100px", fontSize: "0.75rem" }}
                                                            value={m.oee_mode}
                                                            onChange={e => handleSetMode(m.machine_name, e.target.value)}>
                                                            <option value="auto">🟢 Auto</option>
                                                            <option value="manual">📝 Manual</option>
                                                        </select>
                                                        {m.oee_mode === "manual" && (
                                                            <button className="btn btn-outline-primary btn-sm" title="Edit NG"
                                                                onClick={() => handleOpenManualNg(m.machine_name)}>
                                                                <i className="fa fa-edit"></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="d-flex justify-content-between align-items-center px-3 py-2" style={{ borderTop: "1px solid #e0e0e0", background: "#f8f9fa", fontSize: "0.82rem" }}>
                                <span className="text-muted">
                                    Showing {machines.length} machines |
                                    <span className="text-success fw-bold ms-1">{machines.filter(m => m.oee_mode === "auto").length}</span> Auto |
                                    <span className="text-warning fw-bold ms-1">{machines.filter(m => m.oee_mode !== "auto").length}</span> Manual
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ญญญญญญญ MODAL: MANUAL NG BATCH INPUT ญญญญญญญ */}
            <MyModal id="modalManualNg" title={`📝 Manual NG Input — ${editMachine}`} modalSize="modal-lg">
                <div className="container" style={{ maxHeight: "80vh", overflowY: "auto" }}>
                    <div className="d-flex gap-2 align-items-end mb-3">
                        <div>
                            <label className="form-label fw-bold mb-1" style={{ fontSize: "0.82rem" }}>Year</label>
                            <select className="form-select form-select-sm" value={editYear}
                                onChange={e => handleMonthChange(parseInt(e.target.value), editMonth)}>
                                {Array.from({ length: 5 }, (_, i) => dayjs().year() - i).map(y =>
                                    <option key={y} value={y}>{y}</option>
                                )}
                            </select>
                        </div>
                        <div>
                            <label className="form-label fw-bold mb-1" style={{ fontSize: "0.82rem" }}>Month</label>
                            <select className="form-select form-select-sm" value={editMonth}
                                onChange={e => handleMonthChange(editYear, parseInt(e.target.value))}>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
                                    <option key={m} value={m}>{dayjs().month(m - 1).format("MMMM")}</option>
                                )}
                            </select>
                        </div>
                        <div className="flex-grow-1"></div>
                        <span className="badge bg-secondary" style={{ fontSize: "0.8rem" }}>
                            {history.length} day(s)
                        </span>
                    </div>

                    <div className="alert alert-info py-2 mb-3" style={{ fontSize: "0.82rem" }}>
                        <i className="fa fa-info-circle me-1"></i>
                        Edit <strong>NG</strong> values then click <strong>Save All</strong> — changed rows are highlighted in yellow
                    </div>

                    <div className="rounded-3 shadow-sm" style={{ border: "1px solid #e0e0e0", overflow: "hidden" }}>
                        <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
                            <thead>
                                <tr style={{ background: "linear-gradient(90deg, #e3f2fd, #fff)", borderBottom: "2px solid #bbdefb" }}>
                                    <th style={{ width: "120px" }}>Date</th>
                                    <th className="text-center">Output</th>
                                    <th className="text-center" style={{ width: "100px" }}>
                                        <span className="text-danger">NG Qty</span>
                                    </th>
                                    <th className="text-center">Quality</th>
                                    <th className="text-center">Avail</th>
                                    <th className="text-center">Perf</th>
                                    <th className="text-center">OEE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map(h => {
                                    const preview = getPreview(h);
                                    const isToday = h.date === dayjs().format("YYYY-MM-DD");
                                    return (
                                        <tr key={h.date} style={{
                                            background: preview.changed ? "#fff8e1" : isToday ? "#e3f2fd" : "transparent",
                                        }}>
                                            <td className="fw-semibold">
                                                {dayjs(h.date).format("DD/MM/YYYY")}
                                                {isToday && <span className="badge bg-primary ms-1" style={{ fontSize: "0.6rem" }}>Today</span>}
                                            </td>
                                            <td className="text-center">{(h.total_output || 0).toLocaleString()}</td>
                                            <td className="text-center p-1">
                                                <input
                                                    type="number"
                                                    className="form-control form-control-sm text-center fw-bold"
                                                    style={{
                                                        width: "80px", margin: "0 auto",
                                                        border: preview.changed ? "2px solid #f57c00" : "1px solid #ccc",
                                                        background: preview.changed ? "#fff3e0" : "#fff",
                                                    }}
                                                    value={ngEdits[h.date] || "0"}
                                                    onChange={e => setNgEdits(prev => ({ ...prev, [h.date]: e.target.value }))}
                                                    min="0"
                                                />
                                            </td>
                                            <td className="text-center">
                                                <span className="fw-bold" style={{ color: preview.quality > 95 ? "#2e7d32" : preview.quality > 80 ? "#e65100" : "#d32f2f" }}>
                                                    {preview.quality > 0 ? `${preview.quality.toFixed(1)}%` : "-"}
                                                </span>
                                            </td>
                                            <td className="text-center">{h.availability > 0 ? `${h.availability.toFixed(1)}%` : "-"}</td>
                                            <td className="text-center">{h.performance > 0 ? `${h.performance.toFixed(1)}%` : "-"}</td>
                                            <td className="text-center">
                                                <span className="fw-bold" style={{ color: preview.oee > 85 ? "#2e7d32" : preview.oee > 60 ? "#e65100" : "#d32f2f" }}>
                                                    {preview.oee > 0 ? `${preview.oee.toFixed(1)}%` : "-"}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="d-flex justify-content-between align-items-center mt-3">
                        <span className="text-muted" style={{ fontSize: "0.82rem" }}>
                            {history.filter(h => getPreview(h).changed).length} day(s) changed
                        </span>
                        <button className="btn btn-primary px-4" onClick={handleSaveNgBatch} disabled={saving}>
                            <i className={`fa ${saving ? "fa-spinner fa-spin" : "fa-save"} me-2`}></i>
                            Save All
                        </button>
                    </div>
                </div>
            </MyModal>

            {/* ═══════ MODAL: BATCH NG MULTI-MACHINE ═══════ */}
            <MyModal id="modalBatchMulti" title={`📝 Fill NG — Multi-Machine (${batchDate})`} modalSize="modal-lg">
                <div className="container" style={{ maxHeight: "80vh", overflowY: "auto" }}>
                    <div className="d-flex gap-2 align-items-end mb-3">
                        <div>
                            <label className="form-label fw-bold mb-1" style={{ fontSize: "0.82rem" }}>Date</label>
                            <input type="date" className="form-control form-control-sm" value={batchDate}
                                onChange={e => { setBatchDate(e.target.value); loadBatchMachines(e.target.value); }} />
                        </div>
                        <div className="flex-grow-1"></div>
                        <span className="badge bg-secondary" style={{ fontSize: "0.8rem" }}>
                            {batchMachines.length} machine(s)
                        </span>
                    </div>

                    <div className="alert alert-warning py-2 mb-3" style={{ fontSize: "0.82rem" }}>
                        <i className="fa fa-info-circle me-1"></i>
                        Enter <strong>NG</strong> for each machine then click <strong>Save All</strong> — changed rows are highlighted in yellow
                    </div>

                    <div className="rounded-3 shadow-sm" style={{ border: "1px solid #e0e0e0", overflow: "hidden" }}>
                        <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
                            <thead>
                                <tr style={{ background: "linear-gradient(90deg, #fff3e0, #fff)", borderBottom: "2px solid #ffcc80" }}>
                                    <th>Machine</th>
                                    <th className="text-center">Output</th>
                                    <th className="text-center" style={{ width: "100px" }}>
                                        <span className="text-danger">NG Qty</span>
                                    </th>
                                    <th className="text-center">Quality</th>
                                    <th className="text-center">Avail</th>
                                    <th className="text-center">Perf</th>
                                    <th className="text-center">OEE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {batchMachines.map(m => {
                                    const preview = getBatchPreview(m);
                                    return (
                                        <tr key={m.machine_name} style={{
                                            background: preview.changed ? "#fff8e1" : "transparent",
                                        }}>
                                            <td className="fw-bold">{m.machine_name}</td>
                                            <td className="text-center">{(m.total_output || 0).toLocaleString()}</td>
                                            <td className="text-center p-1">
                                                <input type="number" className="form-control form-control-sm text-center fw-bold"
                                                    style={{
                                                        width: "80px", margin: "0 auto",
                                                        border: preview.changed ? "2px solid #f57c00" : "1px solid #ccc",
                                                        background: preview.changed ? "#fff3e0" : "#fff",
                                                    }}
                                                    value={batchNgEdits[m.machine_name] || "0"}
                                                    onChange={e => setBatchNgEdits(prev => ({ ...prev, [m.machine_name]: e.target.value }))}
                                                    min="0"
                                                />
                                            </td>
                                            <td className="text-center">
                                                <span className="fw-bold" style={{ color: preview.quality > 95 ? "#2e7d32" : preview.quality > 80 ? "#e65100" : "#d32f2f" }}>
                                                    {preview.quality > 0 ? `${preview.quality.toFixed(1)}%` : "-"}
                                                </span>
                                            </td>
                                            <td className="text-center">{m.availability > 0 ? `${m.availability.toFixed(1)}%` : "-"}</td>
                                            <td className="text-center">{m.performance > 0 ? `${m.performance.toFixed(1)}%` : "-"}</td>
                                            <td className="text-center">
                                                <span className="fw-bold" style={{ color: preview.oee > 85 ? "#2e7d32" : preview.oee > 60 ? "#e65100" : "#d32f2f" }}>
                                                    {preview.oee > 0 ? `${preview.oee.toFixed(1)}%` : "-"}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="d-flex justify-content-between align-items-center mt-3">
                        <span className="text-muted" style={{ fontSize: "0.82rem" }}>
                            {batchMachines.filter(m => getBatchPreview(m).changed).length} machine(s) changed
                        </span>
                        <button className="btn btn-primary px-4" onClick={handleSaveBatchMulti} disabled={batchSaving}>
                            <i className={`fa ${batchSaving ? "fa-spinner fa-spin" : "fa-save"} me-2`}></i>
                            Save All
                        </button>
                    </div>
                </div>
            </MyModal>
        </>
    );
}

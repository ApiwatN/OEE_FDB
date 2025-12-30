"use client";
import { Suspense } from "react";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Swal from "sweetalert2";
import axios from "axios";
import dayjs from "dayjs";
import config from "@/app/config";
import MyModal from "../components/MyModal";

export default function Page() {
    return (
        <Suspense fallback={<div>Loading Machine Working...</div>}>
            <AddPlanningPage />
        </Suspense>
    );
}

function AddPlanningPage() {
    const searchParams = useSearchParams();

    // ==========================
    // 🔹 ค่าเริ่มต้นจาก URL
    // ==========================
    const urlArea = searchParams.get("area") || "all";
    const urlType = searchParams.get("type") || "all";
    const urlMachine = searchParams.get("machine_name") || "all";

    const [editMode, setEditMode] = useState(false);

    const [areas, setAreas] = useState<string[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [machines, setMachines] = useState<any[]>([]);
    const [targets, setTargets] = useState<any[]>([]);
    const [totalRecords, setTotalRecords] = useState(0); // 🆕
    const [models, setModels] = useState<any[]>([]);
    const [modelTypes, setModelTypes] = useState<any[]>([]); // 🆕
    const [processes, setProcesses] = useState<any[]>([]);   // 🆕

    // State เริ่มต้นให้เป็น "all" ก่อน แล้วจะถูก Override ด้วย useEffect
    const [selectedArea, setSelectedArea] = useState("all");
    const [selectedType, setSelectedType] = useState("all");
    const [selectedMachine, setSelectedMachine] = useState("all");

    const [formData, setFormData] = useState({
        startDate: "",
        endDate: "",
        area: "",
        machine_type: "",
        machine_name: "",
        model: "",
        model_name: "",
        model_type: "",   // 🆕
        process_name: "", // 🆕
        pc_target: "",
        cycle_target: "4.2",
        eff_target: "90",
        hours: {} as Record<string, number>,
    });
    const [activeHours, setActiveHours] = useState<Record<string, boolean>>({});

    // 🆕 State สำหรับหยุดการคำนวณ Auto ชั่วคราว (เช่น ตอนโหลดข้อมูล Edit)
    const [isAutoCalc, setIsAutoCalc] = useState(true);

    const rowsPerPage = 12;
    const [currentPage, setCurrentPage] = useState(1);

    // ===================================================
    // 🔸 โหลดข้อมูลเริ่มต้น & จัดการ LocalStorage
    // ===================================================
    useEffect(() => {
        const init = async () => {
            await fetchAreas(); // โหลด Area มาก่อนเสมอ

            // 🆕 Logic: LocalStorage > URL > "all"
            const localArea = localStorage.getItem("planning_filter_area");
            const localType = localStorage.getItem("planning_filter_type");
            const localMachine = localStorage.getItem("planning_filter_machine");

            // ถ้ามีค่าใน LocalStorage ให้ใช้ ถ้าไม่มีให้ใช้จาก URL
            const targetArea = localArea && localArea !== "all" ? localArea : urlArea;
            const targetType = localType && localType !== "all" ? localType : urlType;
            const targetMachine = localMachine && localMachine !== "all" ? localMachine : urlMachine;

            // อัปเดต State ให้ตรงกับค่าที่ได้
            setSelectedArea(targetArea);
            setSelectedType(targetType);
            setSelectedMachine(targetMachine);

            // 🔄 โหลด Dropdown แบบ Cascade ตามค่าที่ได้
            if (targetArea !== "all") {
                await fetchTypes(targetArea);
                if (targetType !== "all") {
                    await fetchMachines(targetArea, targetType);
                } else {
                    await fetchMachines(targetArea, "all");
                }
            }

            // 🔍 โหลดตารางข้อมูล (Page 1)
            await fetchTargets(targetArea, targetType, targetMachine, 1);
            await fetchModels();

            // Default date init
            const date = new Date();
            date.setDate(date.getDate() + 1);
            const formatted = date.toISOString().split("T")[0];
            const endDate = new Date(date.getFullYear(), date.getMonth() + 2, 0);
            const formattedEnd = endDate.toISOString().split("T")[0];

            setFormData((prev) => ({
                ...prev,
                startDate: formatted,
                endDate: formattedEnd
            }));
        };
        init();
    }, []);

    // ===================================================
    // 🆕 4. Auto Calculate PC Target
    // ===================================================
    useEffect(() => {
        if (!isAutoCalc) return;

        const cycle = parseFloat(formData.cycle_target);
        const eff = parseFloat(formData.eff_target);

        if (!cycle || cycle <= 0 || isNaN(cycle) || isNaN(eff)) return;

        const activeCount = Object.values(activeHours).filter(isActive => isActive).length;
        if (activeCount === 0) {
            setFormData(prev => ({ ...prev, pc_target: "0" }));
            return;
        }

        const totalSeconds = activeCount * 3600;
        const calculatedTarget = (totalSeconds / cycle) * (eff / 100);
        const finalTarget = Math.floor(calculatedTarget);

        setFormData(prev => ({
            ...prev,
            pc_target: String(finalTarget)
        }));

    }, [formData.cycle_target, formData.eff_target, activeHours, isAutoCalc]);


    // ===================================================
    // 🔸 Distribute Target to Hours
    // ===================================================
    useEffect(() => {
        if (!formData.pc_target) return;
        const total = Number(formData.pc_target);
        const hoursList = [
            "07", "08", "09", "10", "11", "12", "13", "14",
            "15", "16", "17", "18", "19", "20", "21", "22",
            "23", "00", "01", "02", "03", "04", "05", "06"
        ];
        const activeList = hoursList.filter(h => activeHours[h] !== false);

        if (activeList.length === 0) return;

        const base = Math.floor(total / activeList.length);
        let remainder = total % activeList.length;

        const newHours: Record<string, number> = { ...formData.hours };

        hoursList.forEach((h) => {
            if (activeList.includes(h)) {
                newHours[h] = base + (remainder > 0 ? 1 : 0);
                if (remainder > 0) remainder--;
            } else {
                newHours[h] = 0;
            }
        });
        setFormData((prev) => ({ ...prev, hours: newHours }));
    }, [formData.pc_target, activeHours]);


    // ===================================================
    // 🔸 Actions
    // ===================================================
    const handleChange = (field: string, value: any) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleHourChange = (hour: string, value: any) => {
        setFormData((prev) => ({
            ...prev,
            hours: { ...prev.hours, [hour]: Number(value) || 0 },
        }));
    };

    const handleToggleShift = (shiftHours: string[]) => {
        const hasUnchecked = shiftHours.some(h => activeHours[h] === false);
        const newActiveHours = { ...activeHours };
        shiftHours.forEach(h => {
            newActiveHours[h] = hasUnchecked;
        });
        setActiveHours(newActiveHours);
    };

    // 🟢 Handle Open (ADD Mode)
    const handleOpen = async () => {
        setEditMode(false);
        setIsAutoCalc(true);

        let start = new Date();
        start.setDate(start.getDate() + 1);

        if (selectedMachine && selectedMachine !== "all") {
            try {
                const res = await axios.get(`${config.apiServer}/api/outputTarget/getLastTargetDate?machine_name=${selectedMachine}`);
                if (res.data.lastDate) {
                    const lastDate = new Date(res.data.lastDate);
                    lastDate.setDate(lastDate.getDate() + 1);
                    start = lastDate;
                }
            } catch (error) {
                console.error("Failed to fetch last date", error);
            }
        }
        const startStr = start.toISOString().split("T")[0];
        const end = new Date(start.getFullYear(), start.getMonth() + 2, 0);
        const endStr = end.toISOString().split("T")[0];

        setFormData({
            startDate: startStr,
            endDate: endStr,
            area: selectedArea !== "all" ? selectedArea : "",
            machine_type: selectedType !== "all" ? selectedType : "",
            machine_name: selectedMachine !== "all" ? selectedMachine : "",
            model: "",
            model_name: "",
            model_type: "",   // 🆕
            process_name: "", // 🆕
            pc_target: "",
            cycle_target: "4.2",
            eff_target: "90",
            hours: {},
        });

        const defaultActive: Record<string, boolean> = {};
        const hours = [
            "07", "08", "09", "10", "11", "12", "13", "14",
            "15", "16", "17", "18", "19", "20", "21", "22",
            "23", "00", "01", "02", "03", "04", "05", "06"
        ];
        hours.forEach((h) => defaultActive[h] = true);
        setActiveHours(defaultActive);

        const modal = document.getElementById("modalProductionPlaning");
        const bsModal = new window.bootstrap.Modal(modal!);
        bsModal.show();

        // 🆕 Fetch Model Types when opening modal
        await fetchModelTypes();
    };

    // 🟡 Handle Edit
    const handleEdit = async (model: any, target: any) => {
        setEditMode(true);
        setIsAutoCalc(false);

        const startDate = target.date.split("T")[0];
        let endDate = startDate;
        try {
            const res = await axios.get(`${config.apiServer}/api/outputTarget/getLastTargetDate?machine_name=${target.machine_name}`);
            if (res.data.lastDate) {
                endDate = res.data.lastDate.split("T")[0];
            }
        } catch (error) {
            console.error("Failed to fetch last date", error);
        }

        const currentModelId = model?.parent?.models?.[0]?.model_id || "";
        const currentModelName = model?.model_name || "";

        const cleanedHours: Record<string, number> = {};
        if (model.hourly_targets) {
            Object.entries(model.hourly_targets).forEach(([key, val]) => {
                if (key.startsWith("target_")) {
                    const h = key.replace("target_", "");
                    cleanedHours[h] = Number(val);
                }
            });
        }

        setFormData({
            startDate: startDate,
            endDate: endDate,
            area: target.area || "",
            machine_type: target.type || "",
            machine_name: target.machine_name,
            model: currentModelId,
            model_name: currentModelName,
            model_type: model.model_type || "",     // 🆕
            process_name: model.process_name || "", // 🆕
            pc_target: model.pc_target,
            cycle_target: model.cycle_time_target,
            eff_target: model.eff_target,
            hours: cleanedHours,
        });

        const activeStatus: Record<string, boolean> = {};
        Object.entries(model.hourly_targets).forEach(([key, val]) => {
            if (key.startsWith('target_')) {
                const h = key.split("_")[1];
                activeStatus[h] = (val as number) !== 0;
            }
        });
        setActiveHours(activeStatus);

        if (target.area) {
            await fetchTypes(target.area);
            await fetchMachines(target.area, target.type || "all");
        }

        // 🆕 Fetch dependent data
        await fetchModelTypes();
        if (target.type) {
            await fetchProcesses(target.type);
        }

        const modal = document.getElementById("modalProductionPlaning");
        const bsModal = new window.bootstrap.Modal(modal!);
        bsModal.show();

        setTimeout(() => setIsAutoCalc(true), 500);
    };

    // 💾 Handle Save
    const handleSave = async () => {
        if (!formData.startDate || !formData.endDate) {
            Swal.fire("Warning", "Please specify start and end dates.", "warning");
            return;
        }
        if (new Date(formData.startDate) > new Date(formData.endDate)) {
            Swal.fire("Warning", "Start date must be before or equal to end date.", "warning");
            return;
        }

        try {
            const selectedModelObj = models.find(m => String(m.id) === String(formData.model));
            const modelNameToSend = selectedModelObj ? selectedModelObj.model_name : formData.model_name;

            const payload = {
                start_date: formData.startDate,
                end_date: formData.endDate,
                machine_name: formData.machine_name,
                model_name: modelNameToSend,
                model_type: formData.model_type,     // 🆕
                process_name: formData.process_name, // 🆕
                pc_target: Number(formData.pc_target),
                cycle_time_target: Number(formData.cycle_target),
                eff_target: Number(formData.eff_target),
                hours: Object.fromEntries(
                    Object.entries(formData.hours).map(([h, v]) => [`target_${h}`, v])
                ),
            };

            let url = "";
            if (editMode) {
                url = `${config.apiServer}/api/outputTarget/updateOutputTargetRange`;
                await axios.put(url, payload);
            } else {
                url = `${config.apiServer}/api/outputTarget/createOutputTargetRange`;
                await axios.post(url, payload);
            }

            Swal.fire({
                icon: "success",
                title: "✅ สำเร็จ",
                text: editMode ? "Production plan updated successfully." : "Production plan added successfully.",
                showConfirmButton: false,
                timer: 1500,
            });

            const modalEl = document.getElementById("modalProductionPlaning");
            const modal = window.bootstrap.Modal.getInstance(modalEl!);
            modal?.hide();

            setEditMode(false);
            await fetchTargets(selectedArea, selectedType, selectedMachine, currentPage); // Reload current page

        } catch (error) {
            console.error(error);
            Swal.fire("❌ Error", "Failed to save.", "error");
        }
    };

    // ... Helper functions
    const formatNumber = (value: string | number) => {
        if (value === "" || value === null || value === undefined) return "";
        const num = Number(value);
        return isNaN(num) ? "" : num.toLocaleString("en-US");
    };
    const parseNumber = (value: string) => value.replace(/,/g, "");

    const fetchAreas = async () => {
        try { const res = await axios.get(`${config.apiServer}/api/machine/listArea`); setAreas(res.data.results.map((r: any) => r.machine_area)); } catch (e) { console.error(e); }
    };
    const fetchTypes = async (area: string) => {
        try { if (area === "all" || !area) { setTypes([]); return; } const res = await axios.get(`${config.apiServer}/api/machine/listType/${area}`); setTypes(res.data.results); } catch (e) { console.error(e); }
    };
    const fetchMachines = async (area: string, type: string) => {
        try { if (area === "all" || type === "all" || !area || !type) { setMachines([]); return; } const res = await axios.get(`${config.apiServer}/api/machine/listMachines/${area}/${type}`); setMachines(res.data.results); } catch (e) { console.error(e); }
    };
    const fetchTargets = async (area: string, type: string, machine: string, page: number = 1) => {
        try {
            const res = await axios.get(`${config.apiServer}/api/outputTarget/listOutputTarget/${area}/${type}/${machine}?page=${page}&limit=${rowsPerPage}`);
            setTargets(res.data.results);
            setTotalRecords(res.data.total || 0);
            setCurrentPage(page);
        } catch (e) { console.error(e); }
    };
    const fetchModels = async () => {
        try { const res = await axios.get(`${config.apiServer}/api/model/listModel`); setModels(res.data.results || []); } catch (e) { console.error(e); }
    };
    const fetchModelTypes = async () => { // 🆕
        try { const res = await axios.get(`${config.apiServer}/api/model/listModelType`); setModelTypes(res.data.results || []); } catch (e) { console.error(e); }
    };
    const fetchProcesses = async (machineType: string) => { // 🆕
        try { if (!machineType) { setProcesses([]); return; } const res = await axios.get(`${config.apiServer}/api/machine/listProcess/${machineType}`); setProcesses(res.data.results || []); } catch (e) { console.error(e); }
    };

    // =========================================================
    // 🆕 Update Handlers with LocalStorage Saving
    // =========================================================
    const handleAreaChange = async (area: string) => {
        setSelectedArea(area);
        setSelectedType("all");
        setSelectedMachine("all");

        // Save to Storage
        localStorage.setItem("planning_filter_area", area);
        localStorage.setItem("planning_filter_type", "all");
        localStorage.setItem("planning_filter_machine", "all");

        await fetchTypes(area);
        await fetchMachines(area, "all");
        await fetchTargets(area, "all", "all", 1); // Reset to page 1
    };

    const handleTypeChange = async (type: string) => {
        setSelectedType(type);
        setSelectedMachine("all");

        // Save to Storage
        localStorage.setItem("planning_filter_type", type);
        localStorage.setItem("planning_filter_machine", "all");

        await fetchMachines(selectedArea, type);
        await fetchTargets(selectedArea, type, "all", 1); // Reset to page 1
    };

    const handleMachineChange = async (machine: string) => {
        setSelectedMachine(machine);

        // Save to Storage
        localStorage.setItem("planning_filter_machine", machine);

        await fetchTargets(selectedArea, selectedType, machine, 1); // Reset to page 1
    };

    const handleDelete = async (id: number) => {
        const confirm = await Swal.fire({ title: "Confirm Delete?", text: "This data will be permanently deleted.", icon: "warning", showCancelButton: true, confirmButtonText: "Yes, delete it", cancelButtonText: "Cancel" });
        if (!confirm.isConfirmed) return;
        try { await axios.delete(`${config.apiServer}/api/outputTarget/delete/${id}`); Swal.fire({ icon: "success", title: "✅ Success", text: "Data deleted successfully.", showConfirmButton: false, timer: 800 }); await fetchTargets(selectedArea, selectedType, selectedMachine, currentPage); } catch (e) { Swal.fire("Error", "Failed to delete.", "error"); }
    };

    // 🆕 Server-side Pagination: targets is already paginated
    const allRows = targets.flatMap((t) => t.models.map((m: any) => ({ id: m.id, date: t.date, machine_name: t.machine_name, model_name: m.model_name, model_type: m.model_type, process_name: m.process_name, pc_target: m.pc_target, cycle_time_target: m.cycle_time_target, eff_target: m.eff_target, hourly_targets: m.hourly_targets, parent: t, area: t.area || selectedArea, type: t.type || selectedType })));
    const totalPages = Math.ceil(totalRecords / rowsPerPage);
    const startIdx = (currentPage - 1) * rowsPerPage; // For display "Showing x-y"
    // const paginatedRows = allRows.slice(startIdx, startIdx + rowsPerPage); // ❌ No need to slice anymore
    const paginatedRows = allRows; // ✅ Use all rows returned from server

    // 🔹 Shift Arrays definition
    const shiftAHours = ["07", "08", "09", "10", "11", "12", "13", "14"];
    const shiftBHours = ["15", "16", "17", "18", "19", "20", "21", "22"];
    const shiftCHours = ["23", "00", "01", "02", "03", "04", "05", "06"];

    return (
        <>
            <div className="content">
                <div className="card mt-3">
                    <div className="card-header d-flex align-items-center position-relative" style={{ background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)", borderBottom: "1px solid #e0e0e0", fontWeight: 600, fontSize: "1.8rem" }}>
                        <div className="d-flex align-items-center"><i className="fa fa-calendar-check me-2 text-primary"></i><span>Daily Production Planning</span></div>
                        <button className="btn btn-outline-secondary btn-sm d-flex align-items-center position-absolute top-50 end-0 translate-middle-y me-3" onClick={() => (window.location.href = "/oee_production/machine_area")}><i className="fa fa-arrow-left me-2"></i>Back to Dashboard</button>
                    </div>
                    <div className="card-body">
                        <div className="d-flex justify-content-between align-items-center">
                            <button className="btn btn-primary" onClick={handleOpen}><i className="fa fa-plus me-2"></i>add daily target</button>
                            <span className="d-flex align-items-center gap-2">
                                <span className="fw-semibold me-2">Filter By:</span>
                                <select className="form-select form-select-sm w-auto" value={selectedArea} onChange={(e) => handleAreaChange(e.target.value)}><option value="all">All Area</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
                                <select className="form-select form-select-sm w-auto" value={selectedType} onChange={(e) => handleTypeChange(e.target.value)}><option value="all">All Type</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
                                <select className="form-select form-select-sm w-auto" value={selectedMachine} onChange={(e) => handleMachineChange(e.target.value)}><option value="all">All Machine</option>{machines.map((m) => <option key={m.id}>{m.machine_name}</option>)}</select>
                            </span>
                        </div>
                        <div className="table-wrapper mt-3" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "flex-start", overflow: "hidden", border: "1px solid #dee2e6" }}>
                            <div className="fixed-table" style={{ position: "sticky", left: 0, zIndex: 3, background: "white", boxShadow: "2px 0 4px rgba(0,0,0,0.05)" }}>
                                <table className="table table-bordered table-striped align-middle text-center mb-0">
                                    <thead className="table-light sticky-header"><tr><th>No</th><th>Date</th><th>Machine</th><th>Model</th><th>Model Type</th><th>Process</th><th>PC Plan</th><th>Cycle Time</th><th>Efficiency</th></tr></thead>
                                    <tbody>{paginatedRows.length === 0 ? (<tr><td colSpan={9} className="text-muted">No Data</td></tr>) : (paginatedRows.map((r, i) => (<tr key={r.id}><td>{startIdx + i + 1}</td><td>{dayjs(r.date).format("DD/MM/YYYY")}</td><td>{r.machine_name}</td><td>{r.model_name}</td><td>{r.model_type || "-"}</td><td>{r.process_name || "-"}</td><td>{Number(r.pc_target).toLocaleString("en-US")}</td><td>{r.cycle_time_target}</td><td>{r.eff_target}</td></tr>)))}</tbody>
                                </table>
                            </div>
                            <div className="scrollable-table" style={{ overflowX: "auto", overflowY: "hidden", maxWidth: "100%" }}>
                                <table className="table table-bordered table-striped align-middle text-center mb-0">
                                    <thead className="table-light sticky-header"><tr>{Array.from({ length: 24 }).map((_, i) => { const hour = (7 + i) % 24; return <th key={hour} style={{ minWidth: "90px", whiteSpace: "nowrap" }}>{hour.toString().padStart(2, "0")}:00</th> })}</tr></thead>
                                    <tbody>{paginatedRows.length === 0 ? (<tr><td colSpan={24} className="text-muted">No Data</td></tr>) : (paginatedRows.map((r) => { const h = r.hourly_targets; const hoursArr = [h.target_07, h.target_08, h.target_09, h.target_10, h.target_11, h.target_12, h.target_13, h.target_14, h.target_15, h.target_16, h.target_17, h.target_18, h.target_19, h.target_20, h.target_21, h.target_22, h.target_23, h.target_00, h.target_01, h.target_02, h.target_03, h.target_04, h.target_05, h.target_06]; return (<tr key={`row-${r.id}`}>{hoursArr.map((v, idx) => (<td key={idx}>{v != null && v !== 0 ? Number(v).toLocaleString("en-US") : v === 0 ? "0" : "-"}</td>))}</tr>); }))}</tbody>
                                </table>
                            </div>
                            <div className="fixed-action" style={{ position: "sticky", right: 0, zIndex: 3, background: "white", boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>
                                <table className="table table-bordered table-striped align-middle text-center mb-0">
                                    <thead className="table-light sticky-header"><tr><th>Action</th></tr></thead>
                                    <tbody>{paginatedRows.length === 0 ? (<tr><td>-</td></tr>) : (paginatedRows.map((r) => (<tr key={`act-${r.id}`}><td><button className="btn btn-primary btn-sm me-2" style={{ padding: "1px 5px", fontSize: "0.6rem" }} onClick={() => handleEdit(r, r.parent)}> <i className="fa fa-edit"></i></button><button className="btn btn-danger btn-sm" style={{ padding: "1px 5px", fontSize: "0.6rem" }} onClick={() => handleDelete(r.id)}><i className="fa fa-times"></i></button></td></tr>)))}</tbody>
                                </table>
                            </div>
                        </div>
                        <div className="d-flex justify-content-between align-items-center mt-2">
                            <span className="text-muted">Showing {startIdx + 1}-{Math.min(startIdx + paginatedRows.length, totalRecords)} of {totalRecords} records</span>
                            <div className="btn-group"><button className="btn btn-outline-secondary btn-sm" disabled={currentPage === 1} onClick={() => fetchTargets(selectedArea, selectedType, selectedMachine, currentPage - 1)}><i className="fa fa-chevron-left"></i></button><span className="btn btn-outline-secondary btn-sm disabled">Page {currentPage} / {totalPages}</span><button className="btn btn-outline-secondary btn-sm" disabled={currentPage === totalPages} onClick={() => fetchTargets(selectedArea, selectedType, selectedMachine, currentPage + 1)}><i className="fa fa-chevron-right"></i></button></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ========================== */}
            {/* 🟡 MODAL SECTION */}
            {/* ========================== */}
            <MyModal
                id="modalProductionPlaning"
                title={editMode ? "✏️ Edit Planning (Range)" : "🧾 Add Planning (Range)"}
                modalSize="modal-lg"
            >
                <div className="container mt-1" style={{ maxHeight: "88vh", overflowY: "auto" }}>
                    <div className="row g-3 mb-3">
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">📅 Start Date</label>
                            <input type="date" className="form-control form-control-sm" value={formData.startDate} onChange={(e) => handleChange("startDate", e.target.value)} />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">🏁 End Date</label>
                            <input type="date" className="form-control form-control-sm" value={formData.endDate} min={formData.startDate} onChange={(e) => handleChange("endDate", e.target.value)} />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">🏭 Area</label>
                            <select className="form-select form-select-sm" value={formData.area} disabled={editMode} onChange={async (e) => { const area = e.target.value; handleChange("area", area); await fetchTypes(area); handleChange("machine_type", ""); handleChange("machine_name", ""); setMachines([]); }}>
                                <option value="">-- Select Area --</option>{areas.map((a) => (<option key={a} value={a}>{a}</option>))}
                            </select>
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">⚙️ Machine Type</label>
                            <select className="form-select form-select-sm" value={formData.machine_type} disabled={editMode} onChange={async (e) => { const type = e.target.value; handleChange("machine_type", type); await fetchMachines(formData.area, type); await fetchProcesses(type); handleChange("machine_name", ""); handleChange("process_name", ""); }}><option value="">-- Select Type --</option>{types.map((t) => (<option key={t} value={t}>{t}</option>))}</select>
                        </div>
                    </div>

                    <div className="row g-3 mb-3">
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">🛠️ Machine</label>
                            <select className="form-select form-select-sm" value={formData.machine_name} disabled={editMode} onChange={(e) => handleChange("machine_name", e.target.value)}><option value="">-- Select Machine --</option>{machines.map((m) => (<option key={m.id} value={m.machine_name}>{m.machine_name}</option>))}</select>
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">📦 Model</label>
                            <select className="form-select form-select-sm" value={formData.model} onChange={(e) => handleChange("model", e.target.value)}><option value="">-- Select Model --</option>{models.map((m: any) => (<option key={m.id} value={m.id}>{m.model_name}</option>))}</select>
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">🏷️ Model Type</label>
                            <select className="form-select form-select-sm" value={formData.model_type} onChange={(e) => handleChange("model_type", e.target.value)}>
                                <option value="">-- Select Model Type --</option>
                                {modelTypes.map((mt: any) => (<option key={mt.id} value={mt.model_type}>{mt.model_type}</option>))}
                            </select>
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">🔧 Process Name</label>
                            <select className="form-select form-select-sm" value={formData.process_name} onChange={(e) => handleChange("process_name", e.target.value)}>
                                <option value="">-- Select Process --</option>
                                {processes.map((p: any) => (<option key={p.id} value={p.process_name}>{p.process_name}</option>))}
                            </select>
                        </div>

                        {/* PC Target: ReadOnly or Editable (It will be auto-calculated) */}
                        <div className="col-md-2">
                            <label className="form-label fw-semibold mb-1">🎯 PC Target</label>
                            <input type="text" inputMode="numeric" className="form-control form-control-sm text-center"
                                value={formatNumber(formData.pc_target)}
                                onChange={(e) => handleChange("pc_target", parseNumber(e.target.value))}
                            />
                        </div>
                        <div className="col-md-2">
                            <label className="form-label fw-semibold mb-1">⏱️ Cycle(s)</label>
                            <input type="number" step="0.01" className="form-control form-control-sm text-center"
                                value={formData.cycle_target || "0"}
                                onChange={(e) => handleChange("cycle_target", e.target.value)}
                            />
                        </div>
                        <div className="col-md-2">
                            <label className="form-label fw-semibold mb-1">⚙️ Eff (%)</label>
                            <input type="number" className="form-control form-control-sm text-center"
                                value={formData.eff_target || "0"}
                                onChange={(e) => handleChange("eff_target", e.target.value)}
                            />
                        </div>
                    </div>

                    {/* 🔹 Shifts A (With Toggle Button) */}
                    <div className="card mb-2 shadow-sm">
                        <div className="card-header py-1 bg-primary text-white fw-bold d-flex justify-content-between align-items-center">
                            <span>Shift A (07:00 - 15:00)</span>
                            <button className="btn btn-light btn-sm py-0 px-2 ms-auto" style={{ fontSize: '0.75rem' }} onClick={() => handleToggleShift(shiftAHours)}>
                                {shiftAHours.some(h => activeHours[h] === false) ? 'Enable All' : 'Disable All'}
                            </button>
                        </div>
                        <div className="card-body py-2"><div className="row g-2 text-center">{shiftAHours.map((h) => renderHourInput(h, activeHours, formData, setActiveHours, handleHourChange))}</div></div>
                    </div>

                    {/* 🔹 Shifts B (With Toggle Button) */}
                    <div className="card mb-2 shadow-sm">
                        <div className="card-header py-1 bg-warning fw-bold d-flex justify-content-between align-items-center">
                            <span>Shift B (15:00 - 23:00)</span>
                            <button className="btn btn-light btn-sm py-0 px-2 ms-auto" style={{ fontSize: '0.75rem' }} onClick={() => handleToggleShift(shiftBHours)}>
                                {shiftBHours.some(h => activeHours[h] === false) ? 'Enable All' : 'Disable All'}
                            </button>
                        </div>
                        <div className="card-body py-2"><div className="row g-2 text-center">{shiftBHours.map((h) => renderHourInput(h, activeHours, formData, setActiveHours, handleHourChange))}</div></div>
                    </div>

                    {/* 🔹 Shifts C (With Toggle Button) */}
                    <div className="card mb-2 shadow-sm">
                        <div className="card-header py-1 bg-dark text-white fw-bold d-flex justify-content-between align-items-center">
                            <span>Shift C (23:00 - 06:00)</span>
                            <button className="btn btn-light btn-sm py-0 px-2 ms-auto" style={{ fontSize: '0.75rem' }} onClick={() => handleToggleShift(shiftCHours)}>
                                {shiftCHours.some(h => activeHours[h] === false) ? 'Enable All' : 'Disable All'}
                            </button>
                        </div>
                        <div className="card-body py-2"><div className="row g-2 text-center">{shiftCHours.map((h) => renderHourInput(h, activeHours, formData, setActiveHours, handleHourChange))}</div></div>
                    </div>

                    <div className="mt-3 text-end">
                        <button className="btn btn-primary btn-sm px-4 " onClick={handleSave}>
                            <i className="fa fa-check me-1"></i>{editMode ? "Update Range" : "Save Range"}
                        </button>
                    </div>
                </div>
            </MyModal>
        </>
    );
}

// Helper component
const renderHourInput = (h: string, activeHours: any, formData: any, setActiveHours: any, handleHourChange: any) => {
    const formatNumber = (val: any) => (val === "" || val === null || val === undefined) ? "" : Number(val).toLocaleString("en-US");
    const parseNumber = (val: any) => val.replace(/,/g, "");
    return (
        <div className="col-3" key={h}>
            <div className="d-flex flex-column align-items-center">
                <div className="form-check form-switch mb-1">
                    <input type="checkbox" className="form-check-input" checked={activeHours[h] !== false} onChange={(e) => setActiveHours((prev: any) => ({ ...prev, [h]: e.target.checked }))} />
                    <label className="form-check-label fw-semibold">{h}:00</label>
                </div>
                <input type="text" inputMode="numeric" disabled={activeHours[h] === false} className="form-control form-control-sm text-center" value={formatNumber(formData.hours[h] || "0")} onChange={(e) => handleHourChange(h, parseNumber(e.target.value))} />
            </div>
        </div>
    );
};
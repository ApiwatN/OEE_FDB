"use client";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Swal from "sweetalert2";
import axios from "axios";
import dayjs from "dayjs";
import config from "@/app/config";
import MyModal from "../components/MyModal";
import LoadingSpinner from "@/app/components/LoadingSpinner";

export default function Page() {
    return (
        <Suspense fallback={<LoadingSpinner message="Loading..." />}>
            <ProductionPlanningPage />
        </Suspense>
    );
}

const HOURS_ORDER = [
    "07", "08", "09", "10", "11", "12", "13", "14",
    "15", "16", "17", "18", "19", "20", "21", "22",
    "23", "00", "01", "02", "03", "04", "05", "06",
];
const SHIFT_A = ["07", "08", "09", "10", "11", "12", "13", "14"];
const SHIFT_B = ["15", "16", "17", "18", "19", "20", "21", "22"];
const SHIFT_C = ["23", "00", "01", "02", "03", "04", "05", "06"];
const SHIFT_M = ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18"];
const SHIFT_N = ["19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06"];

const DEFAULT_HOURS: Record<string, boolean> = {};
HOURS_ORDER.forEach(h => DEFAULT_HOURS[h] = true);

function ProductionPlanningPage() {
    const searchParams = useSearchParams();
    const router = useRouter();

    // ── Filter ──
    const [areas, setAreas] = useState<string[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [machines, setMachines] = useState<any[]>([]);
    const [selectedArea, setSelectedArea] = useState("all");
    const [selectedType, setSelectedType] = useState("all");
    const [selectedMachine, setSelectedMachine] = useState("all");

    // ── Table Data ──
    const [tableData, setTableData] = useState<any[]>([]);
    const [allConfigs, setAllConfigs] = useState<Map<string, any>>(new Map());

    // ── Config Modal ──
    const [editingMachine, setEditingMachine] = useState("");
    const [formData, setFormData] = useState({
        eff_target: "90", cycle_time_target: "4.2",
        process_name: "",
        active_hours: { ...DEFAULT_HOURS },
    });
    const [processes, setProcesses] = useState<any[]>([]);
    const [configStartDate, setConfigStartDate] = useState(dayjs().add(1, "day").format("YYYY-MM-DD"));

    // ── Holiday Modal ──
    const [holidayMachine, setHolidayMachine] = useState("");
    const [currentMonth, setCurrentMonth] = useState(dayjs().month());
    const [currentYear, setCurrentYear] = useState(dayjs().year());
    const [holidays, setHolidays] = useState<string[]>([]);
    const [loadingHolidays, setLoadingHolidays] = useState(false);
    // Copy panel — separate filters
    const [copyAreas, setCopyAreas] = useState<string[]>([]);
    const [copyTypes, setCopyTypes] = useState<string[]>([]);
    const [copyMachineList, setCopyMachineList] = useState<any[]>([]);
    const [copyArea, setCopyArea] = useState("all");
    const [copyType, setCopyType] = useState("all");
    const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
    const [copyStartDate, setCopyStartDate] = useState("");
    const [copyEndDate, setCopyEndDate] = useState("");
    const [copying, setCopying] = useState(false);

    // ── Plan Preview Modal ──
    const [previewMachine, setPreviewMachine] = useState("");
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [previewHolidays, setPreviewHolidays] = useState<string[]>([]);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [previewPage, setPreviewPage] = useState(1);
    const [previewTotal, setPreviewTotal] = useState(0);
    const [expandedRow, setExpandedRow] = useState<number | null>(null);
    const [editingCell, setEditingCell] = useState<{ id: number; field: "eff" | "ct" } | null>(null);
    const [editValue, setEditValue] = useState("");
    const PREVIEW_LIMIT = 14;

    // ── Holiday Detail Modal ──
    const [hdMachine, setHdMachine] = useState("");
    const [hdList, setHdList] = useState<string[]>([]);
    const [loadingHd, setLoadingHd] = useState(false);
    const [hdYear, setHdYear] = useState(dayjs().year());
    const hdCurrentYear = dayjs().year();
    const hdYearOptions = Array.from({ length: 7 }, (_, i) => hdCurrentYear - 3 + i);

    // ── Init ──
    useEffect(() => {
        const init = async () => {
            await fetchAreas();
            const a = localStorage.getItem("planning_filter_area") || "all";
            const t = localStorage.getItem("planning_filter_type") || "all";
            const m = localStorage.getItem("planning_filter_machine") || "all";
            setSelectedArea(a); setSelectedType(t); setSelectedMachine(m);
            if (a !== "all") { await fetchTypes(a); await fetchMachines(a, t); }
        };
        init();
    }, []);

    useEffect(() => {
        if (selectedArea !== "all") loadTableData();
        else setTableData([]);
    }, [selectedArea, selectedType, selectedMachine, machines, allConfigs]);

    useEffect(() => { fetchAllConfigs(); }, []);

    // ── Fetchers ──
    const fetchAreas = async () => {
        try { const r = await axios.get(`${config.apiServer}/api/machine/listArea`); setAreas(r.data.results.map((x: any) => x.machine_area)); return r.data.results.map((x: any) => x.machine_area); } catch (e) { console.error(e); return []; }
    };
    const fetchTypes = async (area: string) => {
        try { if (area === "all") { setTypes([]); return []; } const r = await axios.get(`${config.apiServer}/api/machine/listType/${area}`); setTypes(r.data.results); return r.data.results; } catch (e) { console.error(e); return []; }
    };
    const fetchMachines = async (area: string, type: string) => {
        try { if (area === "all") { setMachines([]); return []; } const r = await axios.get(`${config.apiServer}/api/machine/listMachines/${area}/${type}`); setMachines(r.data.results); return r.data.results; } catch (e) { console.error(e); return []; }
    };
    const fetchAllConfigs = async () => {
        try {
            const r = await axios.get(`${config.apiServer}/api/planConfig/list`);
            const map = new Map<string, any>();
            (r.data.results || []).forEach((c: any) => map.set(c.machine_name, c));
            setAllConfigs(map);
        } catch (e) { console.error(e); }
    };

    const loadTableData = () => {
        let filtered = [...machines];
        if (selectedMachine !== "all") filtered = filtered.filter(m => m.machine_name === selectedMachine);
        const rows = filtered.map(m => {
            const cfg = allConfigs.get(m.machine_name);
            const activeCount = cfg ? Object.values(JSON.parse(cfg.active_hours || "{}")).filter(Boolean).length : 0;
            const pcTarget = cfg ? calcTarget(cfg.eff_target, cfg.cycle_time_target, JSON.parse(cfg.active_hours || "{}")) : 0;
            return {
                machine_name: m.machine_name, machine_type: m.machine_type,
                hasConfig: !!cfg, eff_target: cfg?.eff_target || "-",
                cycle_time_target: cfg?.cycle_time_target || "-",
                pc_target: pcTarget, process_name: cfg?.process_name || "-",
                active_hours_count: activeCount, config: cfg,
            };
        });
        setTableData(rows);
    };

    // ── Filter Handlers ──
    const handleAreaChange = async (area: string) => {
        setSelectedArea(area); setSelectedType("all"); setSelectedMachine("all");
        localStorage.setItem("planning_filter_area", area);
        localStorage.setItem("planning_filter_type", "all");
        localStorage.setItem("planning_filter_machine", "all");
        await fetchTypes(area); await fetchMachines(area, "all");
    };
    const handleTypeChange = async (type: string) => {
        setSelectedType(type); setSelectedMachine("all");
        localStorage.setItem("planning_filter_type", type);
        localStorage.setItem("planning_filter_machine", "all");
        await fetchMachines(selectedArea, type);
    };
    const handleMachineChange = (machine: string) => {
        setSelectedMachine(machine);
        localStorage.setItem("planning_filter_machine", machine);
    };

    const calcTarget = (eff: number, ct: number, hours: Record<string, boolean>) => {
        const activeCount = Object.values(hours).filter(Boolean).length;
        if (!ct || ct <= 0 || activeCount === 0) return 0;
        return Math.floor((activeCount * 3600 / ct) * (eff / 100));
    };

    // Helper: detect shift pattern from active_hours
    const detectShiftPattern = (hours: Record<string, boolean>): string => {
        const aOn = SHIFT_A.every(h => hours[h] === true);
        const bOn = SHIFT_B.every(h => hours[h] === true);
        const cOn = SHIFT_C.every(h => hours[h] === true);
        const mOn = SHIFT_M.every(h => hours[h] === true);
        const nOn = SHIFT_N.every(h => hours[h] === true);
        const totalActive = Object.values(hours).filter(Boolean).length;
        
        if (aOn && bOn && cOn) return "ABC";
        if (mOn && nOn) return "MN";
        if (mOn && totalActive === 12) return "M";
        if (nOn && totalActive === 12) return "N";
        if (aOn && bOn && !cOn) return "AB";
        if (bOn && cOn && !aOn) return "BC";
        if (aOn && cOn && !bOn) return "AC";
        if (aOn && !bOn && !cOn) return "A";
        if (bOn && !aOn && !cOn) return "B";
        if (cOn && !aOn && !bOn) return "C";
        return "custom";
    };

    // Helper: apply shift pattern to active_hours
    const applyShiftPattern = (pattern: string): Record<string, boolean> => {
        const hours: Record<string, boolean> = {};
        HOURS_ORDER.forEach(h => hours[h] = false);
        if (pattern.includes("A")) SHIFT_A.forEach(h => hours[h] = true);
        if (pattern.includes("B")) SHIFT_B.forEach(h => hours[h] = true);
        if (pattern.includes("C")) SHIFT_C.forEach(h => hours[h] = true);
        if (pattern.includes("M")) SHIFT_M.forEach(h => hours[h] = true);
        if (pattern.includes("N")) SHIFT_N.forEach(h => hours[h] = true);
        return hours;
    };

    // Helper: detect shift pattern from hourly targets for Plan Preview
    const detectShiftFromTargets = (ht: Record<string, number>): string => {
        const aOn = SHIFT_A.every(h => (ht[`target_${h}`] || 0) > 0);
        const bOn = SHIFT_B.every(h => (ht[`target_${h}`] || 0) > 0);
        const cOn = SHIFT_C.every(h => (ht[`target_${h}`] || 0) > 0);
        const mOn = SHIFT_M.every(h => (ht[`target_${h}`] || 0) > 0);
        const nOn = SHIFT_N.every(h => (ht[`target_${h}`] || 0) > 0);
        const totalActive = Object.values(ht).filter(v => typeof v === 'number' && v > 0).length;

        if (aOn && bOn && cOn) return "ABC";
        if (mOn && nOn) return "MN";
        if (mOn && totalActive === 12) return "M";
        if (nOn && totalActive === 12) return "N";
        if (aOn && bOn && !cOn) return "AB";
        if (bOn && cOn && !aOn) return "BC";
        if (aOn && cOn && !bOn) return "AC";
        if (aOn && !bOn && !cOn) return "A";
        if (bOn && !aOn && !cOn) return "B";
        if (cOn && !aOn && !bOn) return "C";
        return "custom";
    };

    // Handler: update shift for a single day in Plan Preview
    const handleUpdateDayShift = async (machineName: string, date: string, shiftPattern: string) => {
        try {
            await axios.post(`${config.apiServer}/api/planConfig/updateDayShift`, {
                machine_name: machineName, date, shift_pattern: shiftPattern,
            });
            Swal.fire({ icon: "success", title: `Shift → ${shiftPattern}`, text: `${machineName} on ${dayjs(date).format("DD/MM/YYYY")}`, timer: 1500, showConfirmButton: false });
            await fetchPreview(previewMachine, previewPage);
        } catch (e) { console.error(e); Swal.fire("Error", "Failed to update shift", "error"); }
    };

    // Handler: toggle a single hour on/off for a specific day
    const handleToggleHour = async (machineName: string, date: string, ht: Record<string, number>, hourKey: string) => {
        // Build active_hours from current hourly targets
        const activeHours: Record<string, boolean> = {};
        HOURS_ORDER.forEach(h => activeHours[h] = (ht[`target_${h}`] || 0) > 0);
        // Toggle the clicked hour
        activeHours[hourKey] = !activeHours[hourKey];
        try {
            await axios.post(`${config.apiServer}/api/planConfig/updateDayHours`, {
                machine_name: machineName, date, active_hours: activeHours,
            });
            await fetchPreview(previewMachine, previewPage);
        } catch (e) { console.error(e); Swal.fire("Error", "Failed to update hour", "error"); }
    };

    // Handler: update Eff% or CT for a single day in Plan Preview
    const handleUpdateDayEffCt = async (machineName: string, date: string, field: "eff" | "ct", value: string) => {
        const numVal = Number(value);
        if (isNaN(numVal) || numVal <= 0) { setEditingCell(null); return; }
        if (field === "eff" && numVal > 100) { Swal.fire("Error", "Eff% ต้องไม่เกิน 100", "error"); setEditingCell(null); return; }
        try {
            const payload: any = { machine_name: machineName, date };
            if (field === "eff") payload.eff_target = numVal;
            if (field === "ct") payload.cycle_time_target = numVal;
            await axios.post(`${config.apiServer}/api/planConfig/updateDayEffCt`, payload);
            setEditingCell(null);
            Swal.fire({ icon: "success", title: field === "eff" ? `Eff → ${numVal}%` : `CT → ${numVal}s`, text: `${machineName} on ${dayjs(date).format("DD/MM/YYYY")}`, timer: 1500, showConfirmButton: false });
            await fetchPreview(previewMachine, previewPage);
        } catch (e) { console.error(e); Swal.fire("Error", `Failed to update ${field}`, "error"); setEditingCell(null); }
    };
    const currentTarget = calcTarget(Number(formData.eff_target) || 0, Number(formData.cycle_time_target) || 0, formData.active_hours);

    // ═══════════════════════════════════════════════════════
    // CONFIG MODAL
    // ═══════════════════════════════════════════════════════
    const handleOpenConfig = async (machineName: string) => {
        setEditingMachine(machineName);
        const machineInfo = machines.find(m => m.machine_name === machineName);
        const machineType = machineInfo?.machine_type || selectedType;
        try {
            const procRes = await axios.get(`${config.apiServer}/api/machine/listProcess/${machineType}`);
            setProcesses(procRes.data.results || []);
        } catch (e) { console.error(e); }

        const cfg = allConfigs.get(machineName);
        if (cfg) {
            const ah = typeof cfg.active_hours === "string" ? JSON.parse(cfg.active_hours) : cfg.active_hours;
            setFormData({ eff_target: String(cfg.eff_target), cycle_time_target: String(cfg.cycle_time_target), process_name: cfg.process_name || "", active_hours: ah || { ...DEFAULT_HOURS } });
        } else {
            setFormData({ eff_target: "90", cycle_time_target: "4.2", process_name: "", active_hours: { ...DEFAULT_HOURS } });
        }
        setConfigStartDate(dayjs().format("YYYY-MM-DD"));
        showModal("modalConfig");
    };

    const handleSave = async () => {
        if (!formData.eff_target || !formData.cycle_time_target) { Swal.fire("Warning", "Please input Eff and Cycle Time", "warning"); return; }
        
        const existingConfig = allConfigs.get(editingMachine);
        
        try {
            await axios.post(`${config.apiServer}/api/planConfig/upsert`, {
                machine_name: editingMachine, 
                eff_target: Number(formData.eff_target),
                cycle_time_target: Number(formData.cycle_time_target),
                process_name: formData.process_name || null, 
                model_name: existingConfig?.model_name || null,
                model_type: existingConfig?.model_type || null,
                active_hours: formData.active_hours,
            });
            Swal.fire({ icon: "success", title: "Save Successful", text: `Config saved + All existing plans updated`, showConfirmButton: false, timer: 2000 });
            hideModal("modalConfig");
            await fetchAllConfigs();
        } catch (e) { console.error(e); Swal.fire("Error", "Save Failed", "error"); }
    };

    const handleCopyToType = async () => {
        if (!formData.eff_target || !formData.cycle_time_target) { Swal.fire("Warning", "Please input Eff and Cycle Time", "warning"); return; }
        
        let targetM = machines.find((m: any) => m.machine_name === editingMachine);
        const currentType = targetM?.machine_type || selectedType;

        if (!currentType || currentType === "all") {
            Swal.fire("Error", "Could not determine machine type.", "error"); return;
        }

        try {
            const r = await axios.get(`${config.apiServer}/api/machine/listAllMachinesByArea`);
            const allMachines = r.data.results.flatMap((g: any) => g.machines);
            const sameTypeMachines = allMachines.filter((m: any) => m.type === currentType && m.name !== editingMachine);

            if (sameTypeMachines.length === 0) {
                Swal.fire("Info", `No other machines found with type '${currentType}'`, "info"); return;
            }

            const confirm = await Swal.fire({
                title: `Copy to ${sameTypeMachines.length} Machines?`,
                html: `This will copy the configuration from <b>${editingMachine}</b> to all other machines of type <b>${currentType}</b>.<br><br><small>This action will take a few seconds as it recalculates production plans.</small>`,
                icon: "warning",
                showCancelButton: true,
                confirmButtonColor: "#1565c0",
                confirmButtonText: "Yes, Copy & Save All",
                cancelButtonText: "Cancel"
            });

            if (!confirm.isConfirmed) return;

            Swal.fire({
                title: "Processing...",
                html: "Applying configuration to machines...",
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            // 1. Save source machine
            const existingSource = allConfigs.get(editingMachine);
            await axios.post(`${config.apiServer}/api/planConfig/upsert`, {
                machine_name: editingMachine, 
                eff_target: Number(formData.eff_target),
                cycle_time_target: Number(formData.cycle_time_target),
                process_name: formData.process_name || null, 
                model_name: existingSource?.model_name || null,
                model_type: existingSource?.model_type || null,
                active_hours: formData.active_hours,
            });

            // 2. Loop and save other machines sequentially to prevent DB locking
            const total = sameTypeMachines.length;
            let currentCount = 0;
            let successCount = 0;
            const failedMachines: string[] = [];

            for (const m of sameTypeMachines) {
                currentCount++;
                Swal.update({ html: `Saving configuration to <b>${m.name}</b>...<br/><br/><div style="font-size: 0.95rem; color: #555;">Progress: <b>${currentCount} / ${total}</b> machines</div>` });
                
                try {
                    const existingDest = allConfigs.get(m.name);
                    await axios.post(`${config.apiServer}/api/planConfig/upsert`, {
                        machine_name: m.name, 
                        eff_target: Number(formData.eff_target),
                        cycle_time_target: Number(formData.cycle_time_target),
                        process_name: formData.process_name || null, 
                        model_name: existingDest?.model_name || null,
                        model_type: existingDest?.model_type || null,
                        active_hours: formData.active_hours,
                    });
                    successCount++;
                } catch (err) {
                    // ✅ Bug #3 Fix: ไม่หยุด loop เมื่อ 1 เครื่องล้มเหลว
                    console.error(`[CopyConfig] Failed to copy to ${m.name}:`, err);
                    failedMachines.push(m.name);
                }
            }

            await fetchAllConfigs();
            
            const failNote = failedMachines.length > 0 
                ? `\n⚠️ Failed (${failedMachines.length}): ${failedMachines.join(", ")}` 
                : "";
            Swal.fire({ 
                icon: failedMachines.length > 0 ? "warning" : "success", 
                title: "Done", 
                text: `Copied to ${successCount} of ${total} machines.${failNote}`, 
                timer: 3000, 
                showConfirmButton: false 
            });
            hideModal("modalConfig");
        } catch (e) { console.error(e); Swal.fire("Error", "Failed to copy config", "error"); }
    };

    const handleToggleShift = (shiftHours: string[]) => {
        const hasOff = shiftHours.some(h => formData.active_hours[h] === false);
        setFormData(prev => ({ ...prev, active_hours: { ...prev.active_hours, ...Object.fromEntries(shiftHours.map(h => [h, hasOff])) } }));
    };

    // ═══════════════════════════════════════════════════════
    // HOLIDAY MODAL
    // ═══════════════════════════════════════════════════════
    const handleOpenHoliday = async (machineName: string) => {
        setHolidayMachine(machineName);
        setCurrentMonth(dayjs().month());
        setCurrentYear(dayjs().year());
        setSelectedTargets(new Set());
        setCopyStartDate(dayjs().startOf("month").format("YYYY-MM-DD"));
        setCopyEndDate(dayjs().endOf("month").format("YYYY-MM-DD"));
        // Load areas for copy panel
        try {
            const areasR = await axios.get(`${config.apiServer}/api/machine/listArea`);
            const areasList = areasR.data.results.map((x: any) => x.machine_area);
            setCopyAreas(areasList);
        } catch (e) { console.error(e); }
        setCopyArea("all"); setCopyType("all"); setCopyTypes([]); setCopyMachineList([]);
        await fetchHolidays(machineName, dayjs().year(), dayjs().month());
        showModal("modalHoliday");
    };

    const fetchHolidays = async (mn: string, year: number, month: number) => {
        setLoadingHolidays(true);
        try {
            const r = await axios.get(`${config.apiServer}/api/holiday/list/${mn}?year=${year}&month=${month + 1}`);
            setHolidays(r.data.results.map((h: any) => h.date));
        } catch (e) { console.error(e); }
        setLoadingHolidays(false);
    };

    // Copy panel handlers — can select any area/type
    const handleCopyAreaChange = async (area: string) => {
        setCopyArea(area); setCopyType("all"); setCopyMachineList([]); setSelectedTargets(new Set());
        if (area === "all") { setCopyTypes([]); return; }
        try {
            const r = await axios.get(`${config.apiServer}/api/machine/listType/${area}`);
            setCopyTypes(r.data.results || []);
            // Load all machines in area
            const mr = await axios.get(`${config.apiServer}/api/machine/listMachines/${area}/all`);
            setCopyMachineList((mr.data.results || []).filter((m: any) => m.machine_name !== holidayMachine));
        } catch (e) { console.error(e); }
    };
    const handleCopyTypeChange = async (type: string) => {
        setCopyType(type); setSelectedTargets(new Set());
        const area = copyArea;
        try {
            const mr = await axios.get(`${config.apiServer}/api/machine/listMachines/${area}/${type}`);
            setCopyMachineList((mr.data.results || []).filter((m: any) => m.machine_name !== holidayMachine));
        } catch (e) { console.error(e); }
    };

    const handleToggleHoliday = async (dateStr: string) => {
        try {
            const r = await axios.post(`${config.apiServer}/api/holiday/toggle`, { machine_name: holidayMachine, date: dateStr });
            if (r.data.action === "added") setHolidays(prev => [...prev, dateStr]);
            else setHolidays(prev => prev.filter(d => d !== dateStr));
        } catch (e) { console.error(e); Swal.fire("Error", "Could not update holiday", "error"); }
    };

    const handleCopy = async () => {
        if (selectedTargets.size === 0) { Swal.fire("Warning", "Please select target machines", "warning"); return; }
        const confirm = await Swal.fire({
            title: "Confirm Copy Holidays?",
            html: `From <b>${holidayMachine}</b> to <b>${selectedTargets.size}</b> machine(s)<br/>Period: ${copyStartDate} to ${copyEndDate}`,
            icon: "question", showCancelButton: true, confirmButtonText: "Copy", cancelButtonText: "Cancel",
        });
        if (!confirm.isConfirmed) return;
        setCopying(true);
        try {
            const r = await axios.post(`${config.apiServer}/api/holiday/copy`, { from_machine: holidayMachine, to_machines: Array.from(selectedTargets), start_date: copyStartDate, end_date: copyEndDate });
            Swal.fire({ icon: "success", title: "Copy Successful", text: r.data.message, showConfirmButton: false, timer: 2000 });
            setSelectedTargets(new Set());
        } catch (e) { console.error(e); Swal.fire("Error", "Copy Failed", "error"); }
        setCopying(false);
    };

    const handleMonthChange = async (dir: number) => {
        let m = currentMonth + dir, y = currentYear;
        if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
        setCurrentMonth(m); setCurrentYear(y);
        setCopyStartDate(dayjs().year(y).month(m).startOf("month").format("YYYY-MM-DD"));
        setCopyEndDate(dayjs().year(y).month(m).endOf("month").format("YYYY-MM-DD"));
        await fetchHolidays(holidayMachine, y, m);
    };

    // ═══════════════════════════════════════════════════════
    // PLAN PREVIEW MODAL
    // ═══════════════════════════════════════════════════════
    const handleOpenPreview = async (machineName: string) => {
        setPreviewMachine(machineName);
        setPreviewPage(1);
        setExpandedRow(null);
        await fetchPreview(machineName, 1);
        showModal("modalPreview");
    };

    const fetchPreview = async (mn: string, page: number) => {
        setLoadingPreview(true);
        try {
            const [targetsRes, holidaysRes] = await Promise.all([
                axios.get(`${config.apiServer}/api/outputTarget/listOutputTarget/all/all/${mn}?page=${page}&limit=${PREVIEW_LIMIT}`),
                axios.get(`${config.apiServer}/api/holiday/list/${mn}`),
            ]);
            const rows = targetsRes.data.results.flatMap((t: any) =>
                t.models.map((m: any) => ({
                    id: m.id, date: t.date, machine_name: t.machine_name,
                    model_name: m.model_name, process_name: m.process_name,
                    pc_target: m.pc_target, cycle_time_target: m.cycle_time_target,
                    eff_target: m.eff_target, model_type: m.model_type,
                    hourly_targets: m.hourly_targets || {},
                }))
            );
            setPreviewData(rows);
            setPreviewTotal(targetsRes.data.total || 0);
            setPreviewPage(page);
            setPreviewHolidays(holidaysRes.data.results.map((h: any) => h.date));
        } catch (e) { console.error(e); }
        setLoadingPreview(false);
    };

    // ── Helpers ──
    // ═══════════════════════════════════════════════════════
    // HOLIDAY DETAIL MODAL (read-only)
    // ═══════════════════════════════════════════════════════
    const handleOpenHolidayDetail = async (machineName: string) => {
        setHdMachine(machineName);
        setHdYear(dayjs().year());
        setLoadingHd(true);
        try {
            const r = await axios.get(`${config.apiServer}/api/holiday/list/${machineName}`);
            setHdList((r.data.results || []).map((h: any) => h.date).sort());
        } catch (e) { console.error(e); }
        setLoadingHd(false);
        showModal("modalHolidayDetail");
    };
    const hdFilteredList = hdList.filter(d => d.startsWith(String(hdYear)));

    // Handler: toggle holiday from Holiday Detail Modal
    const handleToggleHolidayDetail = async (dateStr: string) => {
        try {
            const r = await axios.post(`${config.apiServer}/api/holiday/toggle`, { machine_name: hdMachine, date: dateStr });
            if (r.data.action === "added") setHdList(prev => [...prev, dateStr].sort());
            else setHdList(prev => prev.filter(d => d !== dateStr));
        } catch (e) { console.error(e); Swal.fire("Error", "Could not update holiday", "error"); }
    };

    const showModal = (id: string) => { const el = document.getElementById(id); if (el) new (window as any).bootstrap.Modal(el).show(); };
    const hideModal = (id: string) => { const el = document.getElementById(id); if (el) (window as any).bootstrap.Modal.getInstance(el)?.hide(); };

    // Calendar helpers
    const firstDay = dayjs().year(currentYear).month(currentMonth).startOf("month");
    const daysInMonth = firstDay.daysInMonth();
    const startDayOfWeek = (firstDay.day() + 6) % 7;
    const calendarCells: (string | null)[] = [];
    for (let i = 0; i < startDayOfWeek; i++) calendarCells.push(null);
    for (let d = 1; d <= daysInMonth; d++) calendarCells.push(firstDay.date(d).format("YYYY-MM-DD"));
    while (calendarCells.length % 7 !== 0) calendarCells.push(null);
    const monthName = dayjs().year(currentYear).month(currentMonth).format("MMMM YYYY");
    const today = dayjs().format("YYYY-MM-DD");
    const totalPreviewPages = Math.ceil(previewTotal / PREVIEW_LIMIT);

    return (
        <>
            <div className="card mt-3">
                {/* Header */}
                <div className="card-header position-relative fs-2 text-dark"
                    style={{ background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)", borderBottom: "1px solid #e0e0e0", fontWeight: 600, fontSize: "1.8rem" }}>
                    <div className="d-flex align-items-center justify-content-between">
                        <div className="d-flex align-items-center gap-2">
                            <i className="fa fa-calendar-check fs-4 text-primary"></i>
                            <span>Production Planning</span>
                        </div>
                        {/* Action Legend */}
                        <div className="d-flex align-items-center gap-3" style={{ fontSize: "0.75rem", fontWeight: 400 }}>
                            <span className="d-flex align-items-center gap-1">
                                <span className="btn btn-primary btn-sm py-0 px-1" style={{ fontSize: "0.65rem", pointerEvents: "none" }}><i className="fa fa-edit"></i></span>
                                <span className="text-muted">Edit Config</span>
                            </span>
                            <span className="d-flex align-items-center gap-1">
                                <span className="btn btn-outline-danger btn-sm py-0 px-1" style={{ fontSize: "0.65rem", pointerEvents: "none" }}><i className="fa fa-calendar"></i></span>
                                <span className="text-muted">Manage Holidays</span>
                            </span>
                            <span className="d-flex align-items-center gap-1">
                                <span className="btn btn-outline-info btn-sm py-0 px-1" style={{ fontSize: "0.65rem", pointerEvents: "none" }}><i className="fa fa-eye"></i></span>
                                <span className="text-muted">View Plan</span>
                            </span>
                            <span className="d-flex align-items-center gap-1">
                                <span className="btn btn-outline-warning btn-sm py-0 px-1" style={{ fontSize: "0.65rem", pointerEvents: "none" }}><i className="fa fa-list"></i></span>
                                <span className="text-muted">View Holidays</span>
                            </span>
                        </div>
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
                            <select className="form-select" value={selectedType} onChange={e => handleTypeChange(e.target.value)}>
                                <option value="all">-- All Types --</option>
                                {types.map(t => <option key={t}>{t}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <div className="fs-5 mb-1">Select Machine</div>
                            <select className="form-select" value={selectedMachine} onChange={e => handleMachineChange(e.target.value)}>
                                <option value="all">-- All Machines --</option>
                                {machines.map(m => <option key={m.id} value={m.machine_name}>{m.machine_name}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* TABLE */}
                    {selectedArea === "all" ? (
                        <div className="text-center py-5 text-muted">
                            <i className="fa fa-hand-pointer" style={{ fontSize: "2.5rem", opacity: 0.4 }}></i>
                            <p className="mt-3">Select Area to view Machine Configurations</p>
                        </div>
                    ) : tableData.length === 0 ? (
                        <div className="text-center py-4 text-muted"><i className="fa fa-info-circle me-2"></i>No machines found in this category</div>
                    ) : (
                        <div className="rounded-3 shadow-sm" style={{ background: "#fff", border: "1px solid #e0e0e0", overflow: "hidden" }}>
                            <div className="table-responsive">
                                <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.88rem" }}>
                                    <thead>
                                        <tr style={{ background: "linear-gradient(90deg, #f8f9fa, #fff)", borderBottom: "2px solid #e0e0e0" }}>
                                            <th style={{ width: "40px" }}>#</th>
                                            <th>Machine</th>
                                            <th>Type</th>
                                            <th className="text-center">CT (s)</th>
                                            <th className="text-center">Target/Day</th>
                                            <th>Process</th>
                                            <th className="text-center">Working Hours</th>
                                            <th className="text-center">Status</th>
                                            <th className="text-center" style={{ width: "210px" }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tableData.map((row, i) => (
                                            <tr key={row.machine_name}>
                                                <td className="text-muted">{i + 1}</td>
                                                <td className="fw-bold">{row.machine_name}</td>
                                                <td className="text-muted">{row.machine_type}</td>
                                                <td className="text-center">{row.hasConfig ? <span className="fw-bold" style={{ color: "#e65100" }}>{row.cycle_time_target}</span> : <span className="text-muted">-</span>}</td>
                                                <td className="text-center">{row.hasConfig ? <span className="fw-bold" style={{ color: "#1565c0" }}>{row.pc_target.toLocaleString("en-US")}</span> : <span className="text-muted">-</span>}</td>
                                                <td>{row.process_name}</td>
                                                <td className="text-center">{row.hasConfig ? <span className="badge bg-info" style={{ fontSize: "0.75rem" }}>{row.active_hours_count}/24 Hrs</span> : <span className="text-muted">-</span>}</td>
                                                <td className="text-center">{row.hasConfig ? <span className="badge bg-success" style={{ fontSize: "0.72rem" }}>Configured</span> : <span className="badge bg-warning text-dark" style={{ fontSize: "0.72rem" }}>No Config</span>}</td>
                                                <td className="text-center">
                                                    <div className="d-flex gap-1 justify-content-center">
                                                        <button className="btn btn-primary btn-sm" title="Edit Config" onClick={() => handleOpenConfig(row.machine_name)}><i className="fa fa-edit"></i></button>
                                                        <button className="btn btn-outline-danger btn-sm" title="Manage Holidays" onClick={() => handleOpenHoliday(row.machine_name)}><i className="fa fa-calendar"></i></button>
                                                        <button className="btn btn-outline-info btn-sm" title="View Plan Details" onClick={() => handleOpenPreview(row.machine_name)}><i className="fa fa-eye"></i></button>
                                                        <button className="btn btn-outline-warning btn-sm" title="View Holidays" onClick={() => handleOpenHolidayDetail(row.machine_name)}><i className="fa fa-list"></i></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="d-flex justify-content-between align-items-center px-3 py-2" style={{ borderTop: "1px solid #e0e0e0", background: "#f8f9fa", fontSize: "0.82rem" }}>
                                <span className="text-muted">
                                    Showing {tableData.length} machines |
                                    <span className="text-success fw-bold ms-1">{tableData.filter(r => r.hasConfig).length}</span> Configured |
                                    <span className="text-warning fw-bold ms-1">{tableData.filter(r => !r.hasConfig).length}</span> No Config
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══════════════ MODAL: CONFIG ═══════════════ */}
            <MyModal id="modalConfig" title={`${allConfigs.has(editingMachine) ? "Edit" : "Set"} Config — ${editingMachine}`} modalSize="modal-lg">
                <div className="container" style={{ maxHeight: "80vh", overflowY: "auto" }}>
                    <div className="row g-3 mb-3">
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">Efficiency (%)</label>
                            <input type="number" className="form-control text-center" value={formData.eff_target} onChange={e => setFormData(p => ({ ...p, eff_target: e.target.value }))} />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">Cycle Time (s)</label>
                            <input type="number" step="0.01" className="form-control text-center" value={formData.cycle_time_target} onChange={e => setFormData(p => ({ ...p, cycle_time_target: e.target.value }))} />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">Target/Day (auto)</label>
                            <input type="text" readOnly className="form-control text-center fw-bold" style={{ background: "#e3f2fd", color: "#1565c0" }} value={currentTarget.toLocaleString("en-US")} />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold mb-1">Working Hrs</label>
                            <input type="text" readOnly className="form-control text-center" style={{ background: "#f5f5f5" }} value={`${Object.values(formData.active_hours).filter(Boolean).length}/24 Hrs`} />
                        </div>
                    </div>
                    <div className="row g-3 mb-3">
                        <div className="col-md-12">
                            <label className="form-label fw-semibold mb-1">Process Name</label>
                            <select className="form-select" value={formData.process_name} onChange={e => setFormData(p => ({ ...p, process_name: e.target.value }))}><option value="">-- Select --</option>{processes.map((p: any) => <option key={p.id} value={p.process_name}>{p.process_name}</option>)}</select>
                        </div>
                    </div>
                    <div className="mb-3">
                        <label className="form-label fw-bold mb-2">Shift Pattern (Default)</label>
                        <div className="d-flex gap-2 mb-2 flex-wrap">
                            {["ABC", "AB", "BC", "AC", "A", "B", "C", "MN", "M", "N"].map(p => (
                                <button key={p}
                                    className={`btn btn-sm ${detectShiftPattern(formData.active_hours) === p ? "btn-primary" : "btn-outline-secondary"} px-3`}
                                    onClick={() => setFormData(prev => ({ ...prev, active_hours: applyShiftPattern(p) }))}
                                >
                                    {p} ({(p.includes('M') || p.includes('N') ? p.length * 12 : p.length * 8)}h)
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="mb-3">
                        <label className="form-label fw-bold mb-2">Working hours (Advanced)</label>
                        {[{ name: "Shift A (07:00-15:00)", hours: SHIFT_A, border: "#bbdefb", color: "#1565c0" }, { name: "Shift B (15:00-23:00)", hours: SHIFT_B, border: "#ffe0b2", color: "#e65100" }, { name: "Shift C (23:00-07:00)", hours: SHIFT_C, border: "#cfd8dc", color: "#37474f" }, { name: "Shift M (07:00-19:00)", hours: SHIFT_M, border: "#fff59d", color: "#fbc02d" }, { name: "Shift N (19:00-07:00)", hours: SHIFT_N, border: "#e1bee7", color: "#6a1b9a" }].map(shift => (
                            <div key={shift.name} className="mb-2 p-2 rounded-3" style={{ border: `1px solid ${shift.border}` }}>
                                <div className="d-flex align-items-center justify-content-between mb-1">
                                    <span className="fw-bold" style={{ fontSize: "0.85rem", color: shift.color }}>{shift.name}</span>
                                    <button className="btn btn-sm py-0 px-2" style={{ fontSize: "0.7rem", color: shift.color }} onClick={() => handleToggleShift(shift.hours)}>
                                        {shift.hours.some(h => !formData.active_hours[h]) ? "Select All" : "Deselect All"}
                                    </button>
                                </div>
                                <div className="d-flex flex-wrap gap-1">
                                    {shift.hours.map(h => (<button key={h} className={`btn btn-sm ${formData.active_hours[h] ? "btn-success" : "btn-outline-danger"}`} style={{ minWidth: "55px", borderRadius: "6px", fontWeight: 600, fontSize: "0.78rem" }} onClick={() => setFormData(p => ({ ...p, active_hours: { ...p.active_hours, [h]: !p.active_hours[h] } }))}>{formData.active_hours[h] ? "✅" : "❌"} {h}:00</button>))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mb-3 p-3 rounded-3" style={{ border: "1px solid #bbdefb", background: "#e3f2fd" }}>
                        <div className="d-flex align-items-center gap-2" style={{ color: "#1565c0", fontSize: "0.9rem" }}>
                            <i className="fa fa-info-circle"></i>
                            <span className="fw-bold">Save Config will be updated all existing plans</span>
                        </div>
                    </div>
                    <div className="d-flex justify-content-between mt-3">
                        <button className="btn btn-outline-primary px-3 fw-bold" onClick={handleCopyToType} type="button">
                            <i className="fa fa-copy me-2"></i>Copy to All in Same Type
                        </button>
                        <button className="btn btn-primary px-4 fw-bold" onClick={handleSave} type="button">
                            <i className="fa fa-check me-2"></i>Save Config
                        </button>
                    </div>
                </div>
            </MyModal>

            {/* ═══════════════ MODAL: HOLIDAY ═══════════════ */}
            <MyModal id="modalHoliday" title={`Holiday Calendar — ${holidayMachine}`} modalSize="modal-xl">
                {loadingHolidays ? (
                    <LoadingSpinner />
                ) : (
                    <div className="row g-4">
                        {/* Left: Calendar */}
                        <div className="col-lg-7">
                            <div className="d-flex justify-content-between align-items-center mb-3">
                                <h5 className="m-0 fw-bold d-flex align-items-center"><i className="fa fa-calendar-alt me-2 text-danger"></i>{monthName}</h5>
                                <div className="btn-group btn-group-sm">
                                    <button className="btn btn-outline-secondary" onClick={() => handleMonthChange(-1)}><i className="fa fa-chevron-left"></i></button>
                                    <button className="btn btn-outline-secondary" onClick={() => { setCurrentMonth(dayjs().month()); setCurrentYear(dayjs().year()); fetchHolidays(holidayMachine, dayjs().year(), dayjs().month()); }}>Today</button>
                                    <button className="btn btn-outline-secondary" onClick={() => handleMonthChange(1)}><i className="fa fa-chevron-right"></i></button>
                                </div>
                            </div>

                            <div className="p-3 rounded-4 shadow-sm" style={{ background: "#f8f9fa", border: "1px solid #e0e0e0" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px" }}>
                                    {/* Day headers */}
                                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                                        <div key={d} className="text-center fw-bold" style={{ padding: "6px", fontSize: "0.8rem", color: d === "Sat" || d === "Sun" ? "#d32f2f" : "#666" }}>{d}</div>
                                    ))}
                                    {calendarCells.map((dateStr, idx) => {
                                        if (!dateStr) return <div key={`e-${idx}`}></div>;
                                        const isH = holidays.includes(dateStr);
                                        const isT = dateStr === today;
                                        const isPast = dayjs(dateStr).isBefore(dayjs(), "day");
                                        const isHoliday = holidays.includes(dateStr);
                                        return (
                                            <button key={dateStr} className="btn btn-light p-0" onClick={() => handleToggleHoliday(dateStr)}
                                                style={{
                                                    padding: "8px 4px", textAlign: "center", borderRadius: "6px", cursor: "pointer",
                                                    fontWeight: isT ? 800 : 600, fontSize: "0.9rem", transition: "all 0.15s ease",
                                                    background: isH ? "#ef5350" : isT ? "#e3f2fd" : "transparent",
                                                    color: isH ? "#fff" : isPast ? "#bbb" : isT ? "#1565c0" : "#333",
                                                    border: isT && !isH ? "2px solid #1565c0" : "1px solid transparent",
                                                }}
                                                onMouseEnter={e => { if (!isH) (e.target as HTMLElement).style.background = "#f5f5f5"; }}
                                                onMouseLeave={e => { if (!isH && !isT) (e.target as HTMLElement).style.background = "transparent"; else if (isT && !isH) (e.target as HTMLElement).style.background = "#e3f2fd"; }}>
                                                <span style={{ fontSize: "1.1rem" }}>{dayjs(dateStr).date()}</span>
                                                {isHoliday && <div style={{ fontSize: "0.65rem", marginTop: "-2px" }}>Holiday</div>}
                                            </button>
                                        );
                                    })}
                                </div>
                                {/* Legend */}
                                <div className="d-flex justify-content-between align-items-center mt-3 pt-2 px-1" style={{ borderTop: "1px solid #dee2e6", fontSize: "0.85rem" }}>
                                    <div className="d-flex gap-3">
                                        <span className="d-flex align-items-center gap-1"><span style={{ width: "14px", height: "14px", background: "#ef5350", borderRadius: "3px", display: "inline-block" }}></span>Holiday</span>
                                        <span className="d-flex align-items-center gap-1"><span style={{ width: "14px", height: "14px", background: "#e3f2fd", border: "2px solid #1565c0", borderRadius: "3px", display: "inline-block" }}></span>Today</span>
                                        <span className="text-muted"><i className="fa fa-info-circle me-1"></i>Click date to Add/Remove holiday</span>
                                    </div>
                                    <div className="text-muted">Holidays this month: <strong className="text-danger">{holidays.length}</strong> day(s)</div>
                                </div>{holidays.length > 0 && (
                                    <div className="d-flex flex-wrap gap-1 mt-2">
                                        {holidays.sort().map(d => (
                                            <span key={d} className="badge" style={{ background: "#ffcdd2", color: "#c62828", fontSize: "0.75rem", padding: "4px 8px", cursor: "pointer", borderRadius: "6px" }}
                                                onClick={() => handleToggleHoliday(d)}>
                                                {dayjs(d).format("DD MMM")} <i className="fa fa-times ms-1" style={{ fontSize: "0.6rem" }}></i>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Copy Panel — with Area/Type selectors */}
                        <div className="col-lg-5">
                            <div className="rounded-3 shadow-sm h-100 d-flex flex-column" style={{ border: "1px solid #e0e0e0", background: "#fff" }}>
                                <div className="px-3 py-2 fw-bold" style={{ borderBottom: "1px solid #e0e0e0", background: "#f5f5f5", color: "#1565c0" }}>
                                    <i className="fa fa-copy me-2"></i>Copy Holidays to other machines
                                </div>
                                <div className="p-3 flex-grow-1 overflow-auto">
                                    <div className="mb-3 p-2 rounded-3" style={{ background: "#e3f2fd", border: "1px solid #90caf9" }}>
                                        <label className="form-label fw-semibold mb-0" style={{ fontSize: "0.85rem", color: "#1565c0" }}>Source Machine:</label>
                                        <div className="fw-bold fs-5 text-primary">{holidayMachine}</div>
                                    </div>

                                    <div className="row g-2 mb-3">
                                        <div className="col-6">
                                            <label className="form-label fw-semibold mb-1" style={{ fontSize: "0.85rem" }}>Target Area</label>
                                            <select className="form-select form-select-sm" value={copyArea} onChange={e => handleCopyAreaChange(e.target.value)}>
                                                <option value="all">-- Select Area --</option>
                                                {copyAreas.map(a => <option key={a}>{a}</option>)}
                                            </select>
                                        </div>
                                        <div className="col-6">
                                            <label className="form-label fw-semibold mb-1" style={{ fontSize: "0.85rem" }}>Target Type</label>
                                            <select className="form-select form-select-sm" value={copyType} onChange={e => handleCopyTypeChange(e.target.value)}>
                                                <option value="all">-- All Types --</option>
                                                {copyTypes.map(t => <option key={t}>{t}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="mb-3">
                                        <div className="d-flex justify-content-between align-items-center mb-2">
                                            <label className="form-label fw-semibold mb-0" style={{ fontSize: "0.85rem" }}>Select Target Machines:</label>
                                            {copyMachineList.length > 0 && (
                                                <button className="btn btn-link btn-sm p-0" style={{ fontSize: "0.75rem" }}
                                                    onClick={() => { selectedTargets.size === copyMachineList.length ? setSelectedTargets(new Set()) : setSelectedTargets(new Set(copyMachineList.map(m => m.machine_name))); }}>
                                                    {selectedTargets.size === copyMachineList.length ? "Deselect All" : "Select All"}
                                                </button>
                                            )}
                                        </div>
                                        <div className="p-2 rounded-3" style={{ border: "1px solid #dee2e6", background: "#fafafa", minHeight: "100px", maxHeight: "150px", overflowY: "auto" }}>
                                            {copyArea === "all" ? (
                                                <div className="text-center text-muted mt-4" style={{ fontSize: "0.85rem" }}>Please select Target Area first</div>
                                            ) : copyMachineList.length === 0 ? (
                                                <div className="text-center text-muted mt-4" style={{ fontSize: "0.85rem" }}>No other machines found</div>
                                            ) : (
                                                <div style={{ maxHeight: "180px", overflowY: "auto", border: "1px solid #eee", borderRadius: "6px", padding: "6px" }}>
                                                    {copyMachineList.map(m => (
                                                        <div key={m.machine_name} className="form-check mb-1">
                                                            <input type="checkbox" className="form-check-input" id={`cp-${m.machine_name}`}
                                                                checked={selectedTargets.has(m.machine_name)}
                                                                onChange={() => { setSelectedTargets(prev => { const n = new Set(prev); n.has(m.machine_name) ? n.delete(m.machine_name) : n.add(m.machine_name); return n; }); }} />
                                                            <label className="form-check-label" htmlFor={`cp-${m.machine_name}`} style={{ fontSize: "0.85rem" }}>
                                                                {m.machine_name} <span className="text-muted" style={{ fontSize: "0.7rem" }}>({m.machine_type})</span>
                                                            </label>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="row g-2 mb-3">
                                            <div className="col-6">
                                                <label className="form-label fw-semibold mb-1" style={{ fontSize: "0.85rem" }}>From Date</label>
                                                <input type="date" className="form-control form-control-sm" value={copyStartDate} onChange={e => setCopyStartDate(e.target.value)} />
                                            </div>
                                            <div className="col-6">
                                                <label className="form-label fw-semibold mb-1" style={{ fontSize: "0.85rem" }}>To Date</label>
                                                <input type="date" className="form-control form-control-sm" value={copyEndDate} onChange={e => setCopyEndDate(e.target.value)} />
                                            </div>
                                        </div>
                                        <button className="btn btn-primary w-100 fw-bold shadow-sm" onClick={handleCopy} disabled={copying}>
                                            {copying ? <><i className="fa fa-spinner fa-spin me-2"></i>Copying...</> : <><i className="fa fa-copy me-2"></i>Copy Holidays ({selectedTargets.size} machines)</>}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </MyModal>

            {/* ═══════════════ MODAL: PLAN PREVIEW ═══════════════ */}
            <MyModal id="modalPreview" title={`Plan Details — ${previewMachine}`} modalSize="modal-xl modal-fullscreen-lg-down">
                {loadingPreview ? (
                    <LoadingSpinner />
                ) : previewData.length === 0 ? (
                    <div className="text-center text-muted py-4">No plan available — Please set up Configuration first</div>
                ) : (
                    <>
                        {/* Legend */}
                        <div className="d-flex gap-3 mb-2 px-2" style={{ fontSize: "0.78rem" }}>
                            <span className="d-flex align-items-center gap-1"><span style={{ width: "12px", height: "12px", background: "#4caf50", borderRadius: "2px", display: "inline-block" }}></span>Working</span>
                            <span className="d-flex align-items-center gap-1"><span style={{ width: "12px", height: "12px", background: "#e0e0e0", borderRadius: "2px", display: "inline-block" }}></span>Holiday (0 pcs)</span>
                            <span className="text-muted ms-2">Click row to view hourly setup</span>
                        </div>

                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
                                <thead style={{ background: "#f8f9fa" }}>
                                    <tr>
                                        <th style={{ width: "40px" }}>#</th>
                                        <th style={{ width: "110px" }}>Date</th>
                                        <th>Machine</th>
                                        <th style={{ width: "90px" }}>Process</th>
                                        <th>Model</th>
                                        <th className="text-center" style={{ width: "60px" }}>Eff%</th>
                                        <th className="text-center" style={{ width: "60px" }}>CT(s)</th>
                                        <th className="text-center fw-bold" style={{ width: "100px" }}>Target</th>
                                        <th className="text-center" style={{ width: "100px" }}>Target/Hr</th>
                                        <th className="text-center" style={{ width: "100px" }}>Shift</th>
                                        <th className="text-center" style={{ minWidth: "260px" }}>Working Hours</th>
                                        <th className="text-center" style={{ width: "80px" }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewData.map((r, i) => {
                                        const isH = previewHolidays.includes(r.date);
                                        const isPast = dayjs(r.date).isBefore(dayjs(), "day");
                                        const ht = r.hourly_targets || {};
                                        const workingHours = HOURS_ORDER.filter(h => (ht[`target_${h}`] || 0) > 0).length;
                                        const rowIdx = (previewPage - 1) * PREVIEW_LIMIT + i + 1;
                                        const isExpanded = expandedRow === r.id;

                                        return (
                                            <>
                                                <tr key={r.id} style={{ background: isH ? "#ffebee" : isPast ? "#f5f5f5" : "transparent", cursor: "pointer", opacity: isPast ? 0.7 : 1 }}
                                                    onClick={() => setExpandedRow(isExpanded ? null : r.id)}>
                                                    <td>{rowIdx}</td>
                                                    <td className="fw-semibold">{dayjs(r.date).format("DD/MM/YYYY")}</td>
                                                    <td>{r.machine_name}</td>
                                                    <td>{r.process_name || "-"}</td>
                                                    <td>{r.model_name || "-"}</td>
                                                    <td className="text-center" style={{ cursor: isH ? "default" : "pointer", minWidth: "60px" }} onClick={e => { e.stopPropagation(); if (!isH) { setEditingCell({ id: r.id, field: "eff" }); setEditValue(String(r.eff_target)); } }}>
                                                        {editingCell?.id === r.id && editingCell?.field === "eff" ? (
                                                            <input type="number" className="form-control form-control-sm text-center" style={{ width: "65px", fontSize: "0.8rem", margin: "0 auto", padding: "2px 4px" }}
                                                                value={editValue} autoFocus
                                                                onChange={e => setEditValue(e.target.value)}
                                                                onClick={e => e.stopPropagation()}
                                                                onKeyDown={e => { if (e.key === "Enter") handleUpdateDayEffCt(r.machine_name, r.date, "eff", editValue); if (e.key === "Escape") setEditingCell(null); }}
                                                                onBlur={() => handleUpdateDayEffCt(r.machine_name, r.date, "eff", editValue)} />
                                                        ) : (<span style={{ borderBottom: isH ? "none" : "1px dashed #90caf9" }}>{r.eff_target}%</span>)}
                                                    </td>
                                                    <td className="text-center" style={{ cursor: isH ? "default" : "pointer", minWidth: "60px" }} onClick={e => { e.stopPropagation(); if (!isH) { setEditingCell({ id: r.id, field: "ct" }); setEditValue(String(r.cycle_time_target)); } }}>
                                                        {editingCell?.id === r.id && editingCell?.field === "ct" ? (
                                                            <input type="number" step="0.1" className="form-control form-control-sm text-center" style={{ width: "65px", fontSize: "0.8rem", margin: "0 auto", padding: "2px 4px" }}
                                                                value={editValue} autoFocus
                                                                onChange={e => setEditValue(e.target.value)}
                                                                onClick={e => e.stopPropagation()}
                                                                onKeyDown={e => { if (e.key === "Enter") handleUpdateDayEffCt(r.machine_name, r.date, "ct", editValue); if (e.key === "Escape") setEditingCell(null); }}
                                                                onBlur={() => handleUpdateDayEffCt(r.machine_name, r.date, "ct", editValue)} />
                                                        ) : (<span style={{ borderBottom: isH ? "none" : "1px dashed #90caf9" }}>{r.cycle_time_target}</span>)}
                                                    </td>
                                                    <td className="text-center fw-bold" style={{ color: "#1565c0" }}>{Number(r.pc_target).toLocaleString("en-US")}</td>
                                                    <td className="text-center">{workingHours > 0 ? Math.round(r.pc_target / workingHours).toLocaleString("en-US") : "-"}</td>
                                                    <td className="text-center">
                                                        {isH ? (
                                                            <span className="text-muted">-</span>
                                                        ) : (
                                                            <select className="form-select form-select-sm" style={{ width: "90px", fontSize: "0.75rem", margin: "0 auto" }}
                                                                value={detectShiftFromTargets(ht)}
                                                                onClick={e => e.stopPropagation()}
                                                                onChange={e => { e.stopPropagation(); handleUpdateDayShift(r.machine_name, r.date, e.target.value); }}
                                                            >
                                                                <option value="ABC">ABC</option>
                                                                <option value="MN">MN</option>
                                                                <option value="M">M</option>
                                                                <option value="N">N</option>
                                                                <option value="AB">AB</option>
                                                                <option value="BC">BC</option>
                                                                <option value="AC">AC</option>
                                                                <option value="A">A</option>
                                                                <option value="B">B</option>
                                                                <option value="C">C</option>
                                                            </select>
                                                        )}
                                                    </td>
                                                    <td className="text-center">
                                                        <div className="d-flex gap-0 justify-content-center" style={{ flexWrap: "nowrap" }}>
                                                            {HOURS_ORDER.map(h => {
                                                                const val = ht[`target_${h}`] || 0;
                                                                const isWorking = val > 0;
                                                                return (
                                                                    <div key={h} title={`${h}:00 — ${isWorking ? val + " pcs" : "Off"}`}
                                                                        style={{
                                                                            width: "10px", height: "16px",
                                                                            background: isWorking ? "#4caf50" : "#e0e0e0",
                                                                            borderRadius: "1px",
                                                                            border: "0.5px solid rgba(255,255,255,0.5)",
                                                                        }} />
                                                                );
                                                            })}
                                                            <span className="ms-1 text-muted" style={{ fontSize: "0.7rem", whiteSpace: "nowrap" }}>{workingHours}h</span>
                                                        </div>
                                                    </td>
                                                    <td className="text-center">{isH ? <span className="badge bg-danger" style={{ fontSize: "0.7rem" }}>Holiday</span> : isPast ? <span className="badge bg-secondary" style={{ fontSize: "0.7rem" }}>Past</span> : <span className="badge bg-success" style={{ fontSize: "0.7rem" }}>Plan</span>}</td>
                                                </tr>
                                                {/* Expanded row — show all 24 hours */}
                                                {isExpanded && (
                                                    <tr key={`exp-${r.id}`} style={{ background: "#f8f9fa" }}>
                                                        <td colSpan={12} className="py-2 px-3">
                                                            <div className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: "0.75rem" }}>
                                                                <span className="text-muted"><i className="fa fa-info-circle me-1"></i>Click hour to toggle on/off</span>
                                                                <span className="fw-bold" style={{ color: "#1565c0" }}>Total: {Number(r.pc_target).toLocaleString("en-US")} pcs</span>
                                                            </div>
                                                            <div className="d-flex flex-wrap gap-1">
                                                                {HOURS_ORDER.map(h => {
                                                                    const val = ht[`target_${h}`] || 0;
                                                                    const isWorking = val > 0;
                                                                    return (
                                                                        <div key={h} className="text-center" style={{
                                                                            minWidth: "48px", padding: "4px 6px", borderRadius: "6px",
                                                                            background: isWorking ? "#e8f5e9" : "#f5f5f5",
                                                                            border: `1px solid ${isWorking ? "#a5d6a7" : "#e0e0e0"}`,
                                                                            fontSize: "0.72rem", cursor: isH ? "default" : "pointer",
                                                                            transition: "all 0.15s ease",
                                                                        }}
                                                                            onClick={e => { e.stopPropagation(); if (!isH) handleToggleHour(r.machine_name, r.date, ht, h); }}
                                                                            onMouseEnter={e => { if (!isH) (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
                                                                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                                                                        >
                                                                            <div className="fw-bold" style={{ color: isWorking ? "#2e7d32" : "#bbb" }}>{h}:00</div>
                                                                            <div style={{ color: isWorking ? "#1b5e20" : "#ccc", fontWeight: 700 }}>{isWorking ? val : "—"}</div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {previewTotal > PREVIEW_LIMIT && (
                            <div className="d-flex justify-content-between align-items-center px-3 py-2" style={{ borderTop: "1px solid #e0e0e0" }}>
                                <span className="text-muted" style={{ fontSize: "0.8rem" }}>Page {previewPage}/{totalPreviewPages} ({previewTotal} records)</span>
                                <div className="btn-group btn-group-sm">
                                    <button className="btn btn-outline-primary" disabled={previewPage === 1} onClick={() => fetchPreview(previewMachine, previewPage - 1)}><i className="fa fa-chevron-left"></i></button>
                                    <button className="btn btn-outline-primary" disabled={previewPage >= totalPreviewPages} onClick={() => fetchPreview(previewMachine, previewPage + 1)}><i className="fa fa-chevron-right"></i></button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </MyModal>

            {/* ═══════════════ MODAL: HOLIDAY DETAIL ═══════════════ */}
            <MyModal id="modalHolidayDetail" title={`All Holidays — ${hdMachine}`} modalSize="modal-xl">
                {loadingHd ? (
                    <LoadingSpinner />
                ) : (
                    <>
                        {/* Year selector + summary */}
                        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                            <div className="d-flex align-items-center gap-2">
                                <label className="fw-semibold mb-0" style={{ fontSize: "0.9rem" }}>Year:</label>
                                <div className="btn-group btn-group-sm">
                                    {hdYearOptions.map(y => (
                                        <button key={y} className={`btn ${y === hdYear ? "btn-primary" : "btn-outline-secondary"}`}
                                            style={{ fontSize: "0.8rem", fontWeight: y === hdYear ? 700 : 400 }}
                                            onClick={() => setHdYear(y)}>
                                            {y}{y === hdCurrentYear ? " (Current)" : ""}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="d-flex align-items-center gap-3">
                                <span style={{ fontSize: "0.85rem" }}>
                                    <i className="fa fa-calendar-times me-1 text-danger"></i>
                                    Holidays in {hdYear}: <strong className="text-danger">{hdFilteredList.length}</strong> day(s)
                                </span>
                                <div className="d-flex gap-2" style={{ fontSize: "0.75rem" }}>
                                    <span className="d-flex align-items-center gap-1"><span style={{ width: "12px", height: "12px", background: "#ef5350", borderRadius: "3px", display: "inline-block" }}></span>Holiday</span>
                                    <span className="d-flex align-items-center gap-1"><span style={{ width: "12px", height: "12px", background: "#e3f2fd", border: "2px solid #1565c0", borderRadius: "3px", display: "inline-block" }}></span>Today</span>
                                    <span className="text-muted ms-2"><i className="fa fa-mouse-pointer me-1"></i>Click date to toggle</span>
                                </div>
                            </div>
                        </div>

                        {/* Calendar Grids — all 12 months, uniform 6-week height */}
                        {(() => {
                            const sortedMonths = Array.from({ length: 12 }, (_, i) => `${hdYear}-${String(i + 1).padStart(2, "0")}`);
                            const holidaySet = new Set(hdList);
                            const todayStr = dayjs().format("YYYY-MM-DD");

                            return (
                                <div className="row g-3">
                                    {sortedMonths.map(ym => {
                                        const [y, m] = ym.split("-").map(Number);
                                        const firstOfMonth = dayjs().year(y).month(m - 1).startOf("month");
                                        const daysCount = firstOfMonth.daysInMonth();
                                        const startDay = (firstOfMonth.day() + 6) % 7; // Monday=0
                                        // Always 42 cells (6 rows × 7) for uniform height
                                        const cells: (string | null)[] = [];
                                        for (let i = 0; i < startDay; i++) cells.push(null);
                                        for (let d = 1; d <= daysCount; d++) cells.push(firstOfMonth.date(d).format("YYYY-MM-DD"));
                                        while (cells.length < 42) cells.push(null);
                                        const monthHolidayCount = hdFilteredList.filter(d => d.startsWith(ym)).length;
                                        const hasHolidays = monthHolidayCount > 0;

                                        return (
                                            <div key={ym} className="col-lg-4 col-md-6">
                                                <div className="rounded-3 h-100" style={{
                                                    border: hasHolidays ? "1.5px solid #ef9a9a" : "1px solid #e0e0e0",
                                                    overflow: "hidden",
                                                    boxShadow: hasHolidays ? "0 2px 8px rgba(229,57,53,0.1)" : "0 1px 3px rgba(0,0,0,0.05)",
                                                    transition: "box-shadow 0.2s ease",
                                                }}>
                                                    {/* Month Header */}
                                                    <div className="px-3 py-2 fw-bold d-flex justify-content-between align-items-center"
                                                        style={{
                                                            background: hasHolidays
                                                                ? "linear-gradient(135deg, #ffebee 0%, #fff 100%)"
                                                                : "linear-gradient(135deg, #f5f5f5 0%, #fff 100%)",
                                                            borderBottom: hasHolidays ? "1.5px solid #ef9a9a" : "1px solid #e0e0e0",
                                                            fontSize: "0.88rem",
                                                        }}>
                                                        <span style={{ color: hasHolidays ? "#c62828" : "#555" }}>
                                                            <i className={`fa fa-calendar me-1 ${hasHolidays ? "text-danger" : "text-muted"}`}></i>
                                                            {firstOfMonth.format("MMMM YYYY")}
                                                        </span>
                                                        <span className={`badge ${hasHolidays ? "bg-danger" : "bg-success"}`} style={{ fontSize: "0.68rem", padding: "4px 8px" }}>
                                                            {monthHolidayCount} days
                                                        </span>
                                                    </div>

                                                    <div className="p-2" style={{ background: "#fafafa" }}>
                                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px" }}>
                                                            {/* Day headers */}
                                                            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(d => (
                                                                <div key={d} className="text-center fw-bold" style={{
                                                                    padding: "4px 2px", fontSize: "0.68rem",
                                                                    color: d === "Sa" || d === "Su" ? "#c62828" : "#777",
                                                                    borderBottom: "1px solid #eee",
                                                                    background: "#fff",
                                                                }}>{d}</div>
                                                            ))}

                                                            {/* Calendar cells — exactly 42 */}
                                                            {cells.map((dateStr, idx) => {
                                                                if (!dateStr) return (
                                                                    <div key={`e-${ym}-${idx}`} style={{
                                                                        height: "32px", background: "#fff",
                                                                    }}></div>
                                                                );
                                                                const isH = holidaySet.has(dateStr);
                                                                const isT = dateStr === todayStr;
                                                                const isPast = dayjs(dateStr).isBefore(dayjs(), "day");
                                                                const dayOfWeek = dayjs(dateStr).day();
                                                                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                                                                return (
                                                                    <div key={dateStr} style={{
                                                                        height: "32px", display: "flex", flexDirection: "column",
                                                                        alignItems: "center", justifyContent: "center",
                                                                        borderRadius: "4px",
                                                                        fontWeight: isT ? 800 : isH ? 700 : 500,
                                                                        fontSize: "0.76rem",
                                                                        background: isH ? "#e53935" : isT ? "#e3f2fd" : "#fff",
                                                                        color: isH ? "#fff" : isPast ? "#ccc" : isT ? "#1565c0" : isWeekend ? "#d32f2f" : "#333",
                                                                        border: isT && !isH ? "2px solid #1976d2" : "none",
                                                                        cursor: "pointer",
                                                                        transition: "all 0.15s ease",
                                                                    }}
                                                                        onClick={() => handleToggleHolidayDetail(dateStr)}
                                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
                                                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                                                                    >
                                                                        <span>{dayjs(dateStr).date()}</span>
                                                                        {isH && <span style={{ fontSize: "0.4rem", lineHeight: 1, marginTop: "-1px", opacity: 0.9 }}>Off</span>}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </>
                )}
            </MyModal>
        </>
    );
}
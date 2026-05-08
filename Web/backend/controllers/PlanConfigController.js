const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { recalculateAPQForDay } = require("../services/oeeCalcService");

// Default 24 hours all active
const DEFAULT_ACTIVE_HOURS = JSON.stringify({
    "07": true, "08": true, "09": true, "10": true, "11": true, "12": true,
    "13": true, "14": true, "15": true, "16": true, "17": true, "18": true,
    "19": true, "20": true, "21": true, "22": true, "23": true, "00": true,
    "01": true, "02": true, "03": true, "04": true, "05": true, "06": true,
});

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

/**
 * แปลง shift pattern ("ABC", "AB", "A", "M", "N") เป็น active_hours object
 */
function shiftPatternToActiveHours(pattern) {
    const hours = {};
    HOURS_ORDER.forEach(h => hours[h] = false);
    const p = (pattern || "ABC").toUpperCase();
    if (p.includes("A")) SHIFT_A.forEach(h => hours[h] = true);
    if (p.includes("B")) SHIFT_B.forEach(h => hours[h] = true);
    if (p.includes("C")) SHIFT_C.forEach(h => hours[h] = true);
    if (p.includes("M")) SHIFT_M.forEach(h => hours[h] = true);
    if (p.includes("N")) SHIFT_N.forEach(h => hours[h] = true);
    return hours;
}

/**
 * คำนวณ pc_target และ hourly targets จาก config
 */
function calculateTargets(config) {
    const activeHours = JSON.parse(config.active_hours || DEFAULT_ACTIVE_HOURS);
    const activeList = HOURS_ORDER.filter(h => activeHours[h] === true);
    const activeCount = activeList.length;

    if (activeCount === 0 || !config.cycle_time_target || config.cycle_time_target <= 0) {
        return { pc_target: 0, hourly: {} };
    }

    const totalSeconds = activeCount * 3600;
    const pcTarget = Math.floor((totalSeconds / config.cycle_time_target) * (config.eff_target / 100));

    // Distribute evenly
    const base = Math.floor(pcTarget / activeCount);
    let remainder = pcTarget % activeCount;
    const hourly = {};

    HOURS_ORDER.forEach(h => {
        if (activeList.includes(h)) {
            hourly[`target_${h}`] = base + (remainder > 0 ? 1 : 0);
            if (remainder > 0) remainder--;
        } else {
            hourly[`target_${h}`] = 0;
        }
    });

    return { pc_target: pcTarget, hourly };
}

module.exports = {

    // ─── GET CONFIG ──────────────────────────────────────────
    getConfig: async (req, res) => {
        try {
            const { machine_name } = req.params;
            const config = await prisma.tb_machine_plan_config.findUnique({
                where: { machine_name },
            });
            if (!config) return res.json({ result: null });

            // เสริม calculated target
            const { pc_target } = calculateTargets(config);
            res.json({ result: { ...config, pc_target_calculated: pc_target } });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error fetching config" });
        }
    },

    // ─── UPSERT CONFIG ───────────────────────────────────────
    // บันทึก Config + สร้างแผนอัตโนมัติล่วงหน้า 7 วัน (ตั้งแต่วันที่เลือก)
    upsertConfig: async (req, res) => {
        try {
            const {
                machine_name, eff_target, cycle_time_target,
                process_name, model_name, model_type, active_hours,
                start_date
            } = req.body;

            if (!machine_name || !eff_target || !cycle_time_target) {
                return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
            }

            const hoursJson = typeof active_hours === "string"
                ? active_hours
                : JSON.stringify(active_hours || JSON.parse(DEFAULT_ACTIVE_HOURS));

            // 1. Upsert config
            const config = await prisma.tb_machine_plan_config.upsert({
                where: { machine_name },
                update: {
                    eff_target: Number(eff_target),
                    cycle_time_target: Number(cycle_time_target),
                    process_name: process_name || null,
                    model_name: model_name || null,
                    model_type: model_type || null,
                    active_hours: hoursJson,
                },
                create: {
                    machine_name,
                    eff_target: Number(eff_target),
                    cycle_time_target: Number(cycle_time_target),
                    process_name: process_name || null,
                    model_name: model_name || null,
                    model_type: model_type || null,
                    active_hours: hoursJson,
                },
            });

            // 2. หา plan แรกและสุดท้ายของเครื่องนี้ (ตั้งแต่วันนี้เป็นต้นไป)
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const [earliestPlan, latestPlan] = await Promise.all([
                prisma.tb_output_target.findFirst({
                    where: { machine_name, date: { gte: today } },
                    orderBy: { date: "asc" },
                    select: { date: true },
                }),
                prisma.tb_output_target.findFirst({
                    where: { machine_name, date: { gte: today } },
                    orderBy: { date: "desc" },
                    select: { date: true },
                }),
            ]);

            // ✅ เริ่มจากวัน plan แรก หรือ วันนี้ (อันไหนเร็วกว่า)
            const updateStart = earliestPlan
                ? new Date(Math.min(new Date(earliestPlan.date).getTime(), today.getTime()))
                : today;
            updateStart.setHours(0, 0, 0, 0);

            // ✅ จบที่ plan สุดท้ายที่มีอยู่แล้ว (ไม่สร้างเพิ่ม)
            const latestDate = latestPlan ? new Date(latestPlan.date) : new Date(today);

            const diffMs = latestDate.getTime() - updateStart.getTime();
            const advanceDays = Math.max(7, Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1);

            const generated = await generatePlanForMachine(config, advanceDays, updateStart.toISOString().split("T")[0], true);

            res.json({
                success: true,
                message: `Config saved, updated ${generated} day(s) plan`,
                config,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error saving config", error: err.message });
        }
    },

    // ─── LIST ALL CONFIGS ────────────────────────────────────
    listConfigs: async (req, res) => {
        try {
            const configs = await prisma.tb_machine_plan_config.findMany({
                orderBy: { machine_name: "asc" },
            });
            res.json({ results: configs });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error listing configs" });
        }
    },

    // ─── MANUAL GENERATE PLAN ───────────────────────────────
    generatePlan: async (req, res) => {
        try {
            const { machine_name } = req.body;
            if (!machine_name) return res.status(400).json({ message: "ต้องระบุ machine_name" });

            const config = await prisma.tb_machine_plan_config.findUnique({
                where: { machine_name },
            });
            if (!config) return res.status(404).json({ message: "ไม่พบ Config ของเครื่อง" });

            const generated = await generatePlanForMachine(config);
            res.json({ success: true, message: `สร้างแผน ${generated} วัน`, generated });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error generating plan", error: err.message });
        }
    },

    // ─── UPDATE DAY SHIFT ────────────────────────────────────
    // เปลี่ยน shift ของวันเดียว (recalculate hourly targets)
    updateDayShift: async (req, res) => {
        try {
            const { machine_name, date, shift_pattern } = req.body;
            if (!machine_name || !date || !shift_pattern) {
                return res.status(400).json({ message: "machine_name, date, shift_pattern are required" });
            }

            // 1. Get machine config
            const config = await prisma.tb_machine_plan_config.findUnique({ where: { machine_name } });
            if (!config) return res.status(404).json({ message: "Config not found" });

            // 2. Build active_hours from shift pattern
            const activeHours = shiftPatternToActiveHours(shift_pattern);

            // 3. Calculate targets with overridden active_hours
            const tempConfig = { ...config, active_hours: JSON.stringify(activeHours) };
            const { pc_target, hourly } = calculateTargets(tempConfig);

            // 4. Find & update the output_target record
            const planDate = new Date(date);
            const existing = await prisma.tb_output_target.findFirst({
                where: { machine_name, date: planDate },
            });

            const activeCount = Object.values(activeHours).filter(Boolean).length;
            const updateData = { ...hourly, pc_target, accum_target: pc_target };

            if (existing) {
                await prisma.tb_output_target.update({ where: { id: existing.id }, data: updateData });
            } else {
                await prisma.tb_output_target.create({
                    data: {
                        date: planDate, machine_name,
                        model_name: config.model_name || "",
                        model_type: config.model_type || null,
                        process_name: config.process_name || null,
                        eff_target: config.eff_target,
                        cycle_time_target: config.cycle_time_target,
                        ...updateData,
                    },
                });
            }

            // ✅ Recalculate OEE (A, P, Q) for this date after target update
            await recalculateAPQForDay(machine_name, planDate);
            
            // ✅ Recalculate OEE & Daily Actuals in MSSQL
            const { recalcOverallInMSSQL } = require("../services/cronService");
            await recalcOverallInMSSQL(planDate, [machine_name]);

            res.json({ success: true, shift_pattern, work_hours: activeCount, pc_target });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error updating day shift", error: err.message });
        }
    },

    // ─── UPDATE DAY HOURS (Custom toggle) ───────────────────
    // รับ active_hours object ตรงๆ สำหรับ toggle ชั่วโมงรายตัว
    updateDayHours: async (req, res) => {
        try {
            const { machine_name, date, active_hours } = req.body;
            if (!machine_name || !date || !active_hours) {
                return res.status(400).json({ message: "machine_name, date, active_hours are required" });
            }

            // 1. Get machine config
            const config = await prisma.tb_machine_plan_config.findUnique({ where: { machine_name } });
            if (!config) return res.status(404).json({ message: "Config not found" });

            // 2. Calculate targets with custom active_hours
            const tempConfig = { ...config, active_hours: JSON.stringify(active_hours) };
            const { pc_target, hourly } = calculateTargets(tempConfig);

            // 3. Find & update
            const planDate = new Date(date);
            const existing = await prisma.tb_output_target.findFirst({
                where: { machine_name, date: planDate },
            });

            const updateData = { ...hourly, pc_target, accum_target: pc_target };

            if (existing) {
                await prisma.tb_output_target.update({ where: { id: existing.id }, data: updateData });
            } else {
                await prisma.tb_output_target.create({
                    data: {
                        date: planDate, machine_name,
                        model_name: config.model_name || "",
                        model_type: config.model_type || null,
                        process_name: config.process_name || null,
                        eff_target: config.eff_target,
                        cycle_time_target: config.cycle_time_target,
                        ...updateData,
                    },
                });
            }

            // ✅ Recalculate OEE (A, P, Q) for this date after target update
            await recalculateAPQForDay(machine_name, planDate);
            
            // ✅ Recalculate OEE & Daily Actuals in MSSQL
            const { recalcOverallInMSSQL } = require("../services/cronService");
            await recalcOverallInMSSQL(planDate, [machine_name]);

            const activeCount = Object.values(active_hours).filter(Boolean).length;
            res.json({ success: true, work_hours: activeCount, pc_target });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error updating day hours", error: err.message });
        }
    },

    // ─── UPDATE DAY EFF / CT ─────────────────────────────────
    // แก้ Eff% / CT(s) ของวันเดียว → recalculate targets + OEE
    updateDayEffCt: async (req, res) => {
        try {
            const { machine_name, date, eff_target, cycle_time_target } = req.body;
            if (!machine_name || !date) {
                return res.status(400).json({ message: "machine_name and date are required" });
            }
            if (eff_target === undefined && cycle_time_target === undefined) {
                return res.status(400).json({ message: "eff_target or cycle_time_target is required" });
            }

            // 1. Get existing plan record for this day
            const planDate = new Date(date);
            const existing = await prisma.tb_output_target.findFirst({
                where: { machine_name, date: planDate },
            });

            if (!existing) {
                return res.status(404).json({ message: "No plan found for this date" });
            }

            // 2. Determine new values (use provided or keep existing)
            const newEff = eff_target !== undefined ? Number(eff_target) : existing.eff_target;
            const newCt = cycle_time_target !== undefined ? Number(cycle_time_target) : existing.cycle_time_target;

            if (newEff <= 0 || newEff > 100) {
                return res.status(400).json({ message: "eff_target must be between 0.1 and 100" });
            }
            if (newCt <= 0) {
                return res.status(400).json({ message: "cycle_time_target must be > 0" });
            }

            // 3. Rebuild active_hours from current hourly targets
            const activeHours = {};
            HOURS_ORDER.forEach(h => {
                activeHours[h] = (existing[`target_${h}`] || 0) > 0;
            });

            // 4. Calculate new targets with new Eff/CT
            const tempConfig = {
                eff_target: newEff,
                cycle_time_target: newCt,
                active_hours: JSON.stringify(activeHours),
            };
            const { pc_target, hourly } = calculateTargets(tempConfig);

            // 5. Update tb_output_target
            await prisma.tb_output_target.update({
                where: { id: existing.id },
                data: {
                    ...hourly,
                    pc_target,
                    accum_target: pc_target,
                    eff_target: newEff,
                    cycle_time_target: newCt,
                },
            });

            // 6. ✅ Recalculate full OEE (A, P, Q) using the unified backfill service
            await recalculateAPQForDay(machine_name, planDate);

            // ✅ Recalculate OEE & Daily Actuals in MSSQL
            const { recalcOverallInMSSQL } = require("../services/cronService");
            await recalcOverallInMSSQL(planDate, [machine_name]);

            const activeCount = Object.values(activeHours).filter(Boolean).length;
            res.json({
                success: true,
                eff_target: newEff,
                cycle_time_target: newCt,
                pc_target,
                work_hours: activeCount,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error updating day eff/ct", error: err.message });
        }
    },

    // Export for use in cron
    generatePlanForMachine,
    calculateTargets,
    shiftPatternToActiveHours,
    HOURS_ORDER,
    DEFAULT_ACTIVE_HOURS,
};

/**
 * สร้าง/อัปเดตแผนอัตโนมัติสำหรับเครื่องจักร
 * forceUpdate = true  → update plan ที่มีอยู่ (ใช้ตอน Save Config)
 * forceUpdate = false → ข้ามวันที่มี plan อยู่แล้ว (ใช้ตอน Cron)
 */
async function generatePlanForMachine(config, advanceDays = 7, startDate = null, forceUpdate = false) {
    // ใช้ startDate ที่ส่งมา หรือพรุ่งนี้ถ้าไม่ระบุ
    const start = startDate ? new Date(startDate) : new Date();
    if (!startDate) start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);

    const endDate = new Date(start);
    endDate.setDate(endDate.getDate() + advanceDays - 1);

    // ดึงวันหยุดในช่วงนี้
    const holidays = await prisma.tb_machine_holiday.findMany({
        where: {
            machine_name: config.machine_name,
            holiday_date: { gte: start, lte: endDate },
        },
        select: { holiday_date: true },
    });
    const holidaySet = new Set(holidays.map(h => h.holiday_date.toISOString().split("T")[0]));

    // คำนวณ targets
    const { pc_target, hourly } = calculateTargets(config);

    const planData = {
        model_name: config.model_name || "",
        model_type: config.model_type || null,
        process_name: config.process_name || null,
        pc_target,
        cycle_time_target: config.cycle_time_target,
        eff_target: config.eff_target,
        ...hourly,
    };

    let generated = 0;
    const d = new Date(start);
    while (d <= endDate) {
        const dateStr = d.toISOString().split("T")[0];
        const planDate = new Date(dateStr);

        if (!holidaySet.has(dateStr)) {
            // หา record ที่มีอยู่แล้ว
            const existing = await prisma.tb_output_target.findFirst({
                where: {
                    machine_name: config.machine_name,
                    date: planDate,
                },
            });

            if (existing) {
                if (forceUpdate) {
                    // Save Config → update plan ที่มีอยู่
                    await prisma.tb_output_target.update({
                        where: { id: existing.id },
                        data: planData,
                    });
                    generated++;
                }
                // Cron (forceUpdate=false) → ข้ามวันที่มี plan อยู่แล้ว
            } else {
                // ยังไม่มี → create
                await prisma.tb_output_target.create({
                    data: {
                        date: planDate,
                        machine_name: config.machine_name,
                        ...planData,
                    },
                });
                generated++;
            }
        }
        d.setDate(d.getDate() + 1);
    }

    return generated;
}

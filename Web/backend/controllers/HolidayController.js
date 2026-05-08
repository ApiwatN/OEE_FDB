const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { calculateTargets, HOURS_ORDER } = require("./planConfigController");
const { recalculateAPQForDay } = require("../services/oeeCalcService");
module.exports = {

    // ─── LIST HOLIDAYS ────────────────────────────────────
    // ดึงวันหยุดของเครื่องจักร (filter by year-month for performance)
    listHolidays: async (req, res) => {
        try {
            const { machine_name } = req.params;
            const { year, month } = req.query; // optional: filter by month

            const where = { machine_name };

            if (year && month) {
                const startDate = new Date(`${year}-${String(month).padStart(2, "0")}-01`);
                const endDate = new Date(startDate);
                endDate.setMonth(endDate.getMonth() + 1);
                where.holiday_date = { gte: startDate, lt: endDate };
            }

            const holidays = await prisma.tb_machine_holiday.findMany({
                where,
                orderBy: { holiday_date: "asc" },
                select: { id: true, holiday_date: true },
            });

            res.json({
                results: holidays.map(h => ({
                    id: h.id,
                    date: h.holiday_date.toISOString().split("T")[0],
                })),
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error listing holidays" });
        }
    },

    // ─── TOGGLE HOLIDAY ───────────────────────────────────
    // คลิกวันที่ → ถ้ามีอยู่ = ลบ / ถ้าไม่มี = เพิ่ม
    toggleHoliday: async (req, res) => {
        try {
            const { machine_name, date } = req.body;
            if (!machine_name || !date) {
                return res.status(400).json({ message: "ต้องระบุ machine_name และ date" });
            }

            const holidayDate = new Date(date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // ตรวจว่ามีอยู่หรือยัง
            const existing = await prisma.tb_machine_holiday.findUnique({
                where: {
                    machine_name_holiday_date: { machine_name, holiday_date: holidayDate },
                },
            });

            if (existing) {
                // ลบวันหยุด (กลายเป็นวันทำงาน)
                await prisma.tb_machine_holiday.delete({ where: { id: existing.id } });

                // ── Auto-generate plan for this day if config exists ──
                let planCreated = false;

                const config = await prisma.tb_machine_plan_config.findUnique({
                    where: { machine_name },
                });

                if (config) {
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

                    const existingPlan = await prisma.tb_output_target.findFirst({
                        where: { machine_name, date: holidayDate },
                    });

                    if (existingPlan) {
                        await prisma.tb_output_target.update({
                            where: { id: existingPlan.id },
                            data: planData,
                        });
                    } else {
                        await prisma.tb_output_target.create({
                            data: { date: holidayDate, machine_name, ...planData },
                        });
                    }
                    planCreated = true;
                }

                // [NEW] รีคำนวณ OEE ถ้าย้อนหลัง (วันทำงานจะได้มี APQ กลับมา)
                if (holidayDate <= today) {
                    await recalculateAPQForDay(machine_name, holidayDate);
                }

                res.json({ success: true, action: "removed", date, planCreated });
            } else {
                // เพิ่มวันหยุด + ลบแผนในวันนั้น (ถ้ามี)
                await prisma.$transaction([
                    prisma.tb_machine_holiday.create({
                        data: { machine_name, holiday_date: holidayDate },
                    }),
                    prisma.tb_output_target.deleteMany({
                        where: { machine_name, date: holidayDate },
                    }),
                ]);

                // [NEW] รีคำนวณ OEE ถ้าย้อนหลัง (วันหยุด Performance จะได้เป็นศูนย์ หรือถูกปรับ)
                if (holidayDate <= today) {
                    await recalculateAPQForDay(machine_name, holidayDate);
                }

                res.json({ success: true, action: "added", date });
            }
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error toggling holiday", error: err.message });
        }
    },

    // ─── SYNC HOLIDAYS ────────────────────────────────────
    // Sync วันหยุดจากเครื่องต้นทาง → เครื่องปลายทาง
    // - วันที่ต้นทางมี แต่ปลายทางไม่มี → เพิ่มวันหยุด + ลบแผน
    // - วันที่ปลายทางมี แต่ต้นทางไม่มีแล้ว → ลบวันหยุด + สร้างแผนคืน
    copyHolidays: async (req, res) => {
        try {
            const { from_machine, to_machines, start_date, end_date } = req.body;

            if (!from_machine || !to_machines?.length || !start_date || !end_date) {
                return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
            }

            const rangeStart = new Date(start_date);
            const rangeEnd = new Date(end_date);

            // 1. ดึงวันหยุดต้นทาง
            const sourceHolidays = await prisma.tb_machine_holiday.findMany({
                where: {
                    machine_name: from_machine,
                    holiday_date: { gte: rangeStart, lte: rangeEnd },
                },
                select: { holiday_date: true },
            });

            const sourceDateSet = new Set(
                sourceHolidays.map(h => h.holiday_date.toISOString())
            );

            // 2. ดึงวันหยุดปลายทางที่มีอยู่ (ในช่วงเดียวกัน)
            const existingHolidays = await prisma.tb_machine_holiday.findMany({
                where: {
                    machine_name: { in: to_machines },
                    holiday_date: { gte: rangeStart, lte: rangeEnd },
                },
                select: { machine_name: true, holiday_date: true },
            });

            const existingSet = new Set(
                existingHolidays.map(h => `${h.machine_name}|${h.holiday_date.toISOString()}`)
            );

            // 3. คำนวณสิ่งที่ต้องทำ
            const holidaysToAdd = [];
            const plansToDelete = [];
            const holidaysToRemove = [];
            const daysToRegenerate = [];

            // 3a. วันที่ต้นทางมี → ปลายทางต้องมีด้วย
            for (const targetMachine of to_machines) {
                for (const h of sourceHolidays) {
                    const key = `${targetMachine}|${h.holiday_date.toISOString()}`;
                    if (!existingSet.has(key)) {
                        holidaysToAdd.push({
                            machine_name: targetMachine,
                            holiday_date: h.holiday_date,
                        });
                        plansToDelete.push({
                            machine_name: targetMachine,
                            date: h.holiday_date,
                        });
                    }
                }
            }

            // 3b. วันที่ปลายทางมี แต่ต้นทางไม่มีแล้ว → ลบออก + สร้างแผนคืน
            for (const ex of existingHolidays) {
                if (!sourceDateSet.has(ex.holiday_date.toISOString())) {
                    holidaysToRemove.push({
                        machine_name: ex.machine_name,
                        holiday_date: ex.holiday_date,
                    });
                    daysToRegenerate.push({
                        machine_name: ex.machine_name,
                        date: ex.holiday_date,
                    });
                }
            }

            // 4. Execute ทุกอย่างใน Transaction เดียว
            const txOps = [];

            if (holidaysToAdd.length > 0) {
                txOps.push(prisma.tb_machine_holiday.createMany({ data: holidaysToAdd }));
            }
            if (plansToDelete.length > 0) {
                txOps.push(prisma.tb_output_target.deleteMany({ where: { OR: plansToDelete } }));
            }
            if (holidaysToRemove.length > 0) {
                const removeFilters = holidaysToRemove.map(h => ({
                    machine_name: h.machine_name,
                    holiday_date: h.holiday_date,
                }));
                txOps.push(prisma.tb_machine_holiday.deleteMany({ where: { OR: removeFilters } }));
            }

            if (txOps.length > 0) {
                await prisma.$transaction(txOps);
            }

            // 5. สร้างแผนคืนให้วันที่ถูกเอาออกจากวันหยุด
            let plansCreated = 0;
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (const day of daysToRegenerate) {
                const config = await prisma.tb_machine_plan_config.findUnique({
                    where: { machine_name: day.machine_name },
                });
                if (!config) continue;

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

                const existingPlan = await prisma.tb_output_target.findFirst({
                    where: { machine_name: day.machine_name, date: day.date },
                });

                if (existingPlan) {
                    await prisma.tb_output_target.update({
                        where: { id: existingPlan.id },
                        data: planData,
                    });
                } else {
                    await prisma.tb_output_target.create({
                        data: { date: day.date, machine_name: day.machine_name, ...planData },
                    });
                }
                plansCreated++;
            }

            // [NEW] รีคำนวณ OEE ถ้าย้อนหลัง (สำหรับวันที่กลับเป็นวันทำงาน)
            for (const day of daysToRegenerate) {
                if (day.date <= today) {
                    await recalculateAPQForDay(day.machine_name, day.date);
                }
            }

            // [NEW] รีคำนวณ OEE ถ้าย้อนหลัง (สำหรับวันที่พึ่งถูกเปลี่ยนเป็นวันหยุด)
            for (const h of holidaysToAdd) {
                if (h.holiday_date <= today) {
                    await recalculateAPQForDay(h.machine_name, h.holiday_date);
                }
            }

            res.json({
                success: true,
                message: `Sync สำเร็จ: เพิ่ม ${holidaysToAdd.length}, ลบ ${holidaysToRemove.length} วันหยุด ไปยัง ${to_machines.length} เครื่อง`,
                added: holidaysToAdd.length,
                removed: holidaysToRemove.length,
                plansCreated,
                machines: to_machines.length,
                sourceHolidays: sourceHolidays.length,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error syncing holidays", error: err.message });
        }
    },
};

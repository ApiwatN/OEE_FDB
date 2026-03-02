const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { calculateTargets, HOURS_ORDER } = require("./PlanConfigController");

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

            // ตรวจว่ามีอยู่หรือยัง
            const existing = await prisma.tb_machine_holiday.findUnique({
                where: {
                    machine_name_holiday_date: { machine_name, holiday_date: holidayDate },
                },
            });

            if (existing) {
                // ลบวันหยุด
                await prisma.tb_machine_holiday.delete({ where: { id: existing.id } });

                // ── Auto-generate plan for this day if config exists ──
                let planCreated = false;
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                if (holidayDate >= today) {
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
                res.json({ success: true, action: "added", date });
            }
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error toggling holiday", error: err.message });
        }
    },

    // ─── COPY HOLIDAYS ───────────────────────────────────
    // คัดลอกวันหยุดจากเครื่องต้นทางไปเครื่องปลายทาง
    copyHolidays: async (req, res) => {
        try {
            const { from_machine, to_machines, start_date, end_date } = req.body;

            if (!from_machine || !to_machines?.length || !start_date || !end_date) {
                return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
            }

            // ดึงวันหยุดต้นทาง
            const sourceHolidays = await prisma.tb_machine_holiday.findMany({
                where: {
                    machine_name: from_machine,
                    holiday_date: {
                        gte: new Date(start_date),
                        lte: new Date(end_date),
                    },
                },
                select: { holiday_date: true },
            });

            if (sourceHolidays.length === 0) {
                return res.json({ success: true, message: "ไม่มีวันหยุดในช่วงที่เลือก", copied: 0 });
            }

            let totalCopied = 0;

            for (const targetMachine of to_machines) {
                for (const h of sourceHolidays) {
                    try {
                        // upsert: ข้ามถ้ามีอยู่แล้ว
                        await prisma.tb_machine_holiday.upsert({
                            where: {
                                machine_name_holiday_date: {
                                    machine_name: targetMachine,
                                    holiday_date: h.holiday_date,
                                },
                            },
                            update: {}, // ไม่ต้องอัปเดตอะไร
                            create: {
                                machine_name: targetMachine,
                                holiday_date: h.holiday_date,
                            },
                        });

                        // ลบแผนในวันหยุดนี้ (ถ้ามี)
                        await prisma.tb_output_target.deleteMany({
                            where: {
                                machine_name: targetMachine,
                                date: h.holiday_date,
                            },
                        });

                        totalCopied++;
                    } catch (e) {
                        // ข้ามถ้า unique constraint violation
                        if (e.code !== "P2002") console.error(e);
                    }
                }
            }

            res.json({
                success: true,
                message: `คัดลอกสำเร็จ ${totalCopied} วัน ไปยัง ${to_machines.length} เครื่อง`,
                copied: totalCopied,
                machines: to_machines.length,
                holidays: sourceHolidays.length,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error copying holidays", error: err.message });
        }
    },
};

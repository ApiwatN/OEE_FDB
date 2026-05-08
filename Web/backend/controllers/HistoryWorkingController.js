const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = {
    // =========================================================
    // 🔍 1. ตรวจสอบว่าเครื่องนี้มี Operator ทำงานอยู่ไหม
    // =========================================================
    getOperatorIdWorking: async (req, res) => {
        try {
            const machine_name = req.params.machine_name;
            if (!machine_name) {
                return res.status(400).json({ message: "machine_name is required" });
            }

            // ดึง record ที่ยังไม่จบงาน และ machine_name ตรงกัน
            const history = await prisma.tb_history_working.findFirst({
                where: {
                    machine_name,
                    end_time: null,
                },
                orderBy: {
                    id: "desc",
                },
                select: {
                    id: true,
                    emp_no: true,
                    date: true,
                    shift: true,
                    start_time: true,
                    end_time: true,
                    tbm_operator: {
                        select: {
                            operator_name: true,
                            picture_path: true,
                        },
                    },
                },
            });

            if (!history) {
                return res.json({ results: null });
            }

            return res.json({
                results: {
                    id: history.id,
                    emp_no: history.emp_no,
                    operator_name: history.tbm_operator?.operator_name || null,
                    picture_path: history.tbm_operator?.picture_path || null,
                    machine_name,
                    date: history.date,
                    shift: history.shift,
                    start_time: history.start_time,
                    end_time: history.end_time,
                },
            });
        } catch (error) {
            console.error("❌ getOperatorIdWorking error:", error);
            return res.status(500).json({
                message: "Error checking machine working status",
                error: error.message,
            });
        }
    },

    // =========================================================
    // 🕒 2. Operator เริ่มทำงาน (สร้างประวัติ)
    // =========================================================
    createStartTime: async (req, res) => {
        try {
            const { machine_name, emp_no, date, shift } = req.body;

            if (!machine_name || !emp_no || !date || !shift) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            // ตรวจสอบ operator
            const operator = await prisma.tbm_operator.findUnique({
                where: { emp_no },
            });
            if (!operator) {
                return res.status(400).json({ message: "Operator not found" });
            }

            // เวลาปัจจุบัน UTC+7
            const now = new Date();
            const utc7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);

            // แปลง date เป็น UTC
            const dateUtc = new Date(date + "T00:00:00Z");

            // ❌ schema ไม่มีความสัมพันธ์ว่า tb_history_working → tb_output_target
            // ❌ ไม่มี output_target_id ใน schema
            // ดังนั้นตัดส่วนนี้ออก (เพราะ schema ไม่มี field นี้)

            // ✅ 1. Strict Active Session Check (Prevent Multi-User/Multi-Session on same machine)
            const activeHistory = await prisma.tb_history_working.findFirst({
                where: {
                    machine_name,
                    end_time: null
                },
                include: {
                    tbm_operator: { select: { operator_name: true } }
                }
            });

            if (activeHistory) {
                // ถ้าเป็นคนเดิม -> คืนค่าเดิมให้ไปทำงานต่อ (ป้องกัน Double Scan/Net Lag)
                if (activeHistory.emp_no === emp_no) {
                    console.log(`⚠️ Active session exists for ${emp_no} on ${machine_name}. Returning existing ID: ${activeHistory.id}`);
                    return res.json({
                        status: "ok",
                        message: "Existing working history found",
                        data: activeHistory // ส่งคืน format เดิม
                    });
                }

                // ถ้าเป็นคนอื่น -> แจ้ง Error ว่าเครื่องไม่ว่าง
                else {
                    const opName = activeHistory.tbm_operator?.operator_name || activeHistory.emp_no;
                    return res.status(400).json({
                        message: `Machine is currently used by ${opName} (${activeHistory.emp_no}). Please logout first.`
                    });
                }
            }

            // ✅ ถ้าเครื่องว่าง (activeHistory = null) -> สร้างรายการใหม่ตามปกติ

            const newHistory = await prisma.tb_history_working.create({
                data: {
                    machine_name,
                    emp_no,
                    date: new Date(date),
                    shift,
                    start_time: utc7,
                    end_time: null,
                },
            });

            // 🟢 Emit Socket Event
            const io = req.app.get("io");
            if (io) {
                io.emit("machine_updated", {
                    machine_name,
                    status: "active",
                    emp_no
                });
            }

            return res.json({
                status: "ok",
                message: "Created working history successfully",
                data: newHistory
            });
        } catch (error) {
            console.error("❌ historyWorking.create error:", error);
            return res.status(500).json({
                message: "Error creating working history",
                error: error.message,
            });
        }
    },

    // =========================================================
    // 🕓 3. Operator เลิกงาน (อัปเดต end_time)
    // =========================================================
    updateEndTime: async (req, res) => {
        try {
            const history_id = Number(req.params.id);

            if (!history_id) {
                return res.status(400).json({ message: "Missing required parameter: id" });
            }

            const history = await prisma.tb_history_working.findUnique({
                where: { id: history_id },
            });
            if (!history) {
                return res.status(404).json({ message: "Working history not found" });
            }

            // คำนวณเวลาไทย UTC+7
            const now = new Date();
            const utc7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);

            // ✅ อัปเดตทุก record ของ machine_name นี้ที่ยังไม่มี end_time
            // เพื่อป้องกัน ghost session และให้มั่นใจว่าเครื่องนี้ไม่มี session ค้าง
            const updateResult = await prisma.tb_history_working.updateMany({
                where: {
                    machine_name: history.machine_name,
                    end_time: null
                },
                data: { end_time: utc7 },
            });

            console.log(`✅ Closed ${updateResult.count} session(s) for machine: ${history.machine_name}`);

            // 🟢 Emit Socket Event
            const io = req.app.get("io");
            if (io) {
                io.emit("machine_updated", {
                    machine_name: history.machine_name,
                    status: "inactive"
                });
            }

            return res.json({
                status: "ok",
                message: `Updated end_time successfully (${updateResult.count} session(s) closed)`,
                results: {
                    id: history_id,
                    emp_no: history.emp_no,
                    machine_name: history.machine_name,
                    sessions_closed: updateResult.count,
                    end_time_utc7: utc7.toISOString().replace("Z", "+07:00"),
                },
            });
        } catch (error) {
            console.error("❌ updateEndTime error:", error);
            return res.status(500).json({
                message: "Error updating end_time",
                error: error.message,
            });
        }
    },
    // =========================================================
    // 📜 4. ดึงประวัติการทำงานตามวันที่ (History by Date)
    // =========================================================
    getHistoryByDate: async (req, res) => {
        try {
            const { machine_name, date } = req.query;
            if (!machine_name || !date) {
                return res.status(400).json({ message: "machine_name and date are required" });
            }

            const history = await prisma.tb_history_working.findMany({
                where: {
                    machine_name,
                    date: new Date(date),
                },
                include: {
                    tbm_operator: {
                        select: {
                            operator_name: true,
                            picture_path: true,
                        },
                    },
                },
                orderBy: {
                    start_time: "asc",
                },
            });

            return res.json({ results: history });
        } catch (error) {
            console.error("❌ getHistoryByDate error:", error);
            return res.status(500).json({
                message: "Error fetching history by date",
                error: error.message,
            });
        }
    },

    // =========================================================
    // 🔄 5. ดึง Operator ที่ทำงานข้ามวัน (Cross-Day Active Operator)
    // - เริ่มก่อนวันที่เลือก และ (ยังไม่จบ หรือ จบหลังวันที่เลือก)
    // =========================================================
    getActiveCrossDayOperator: async (req, res) => {
        try {
            const { machine_name, date } = req.query;
            if (!machine_name || !date) {
                return res.status(400).json({ message: "machine_name and date are required" });
            }

            // วันที่เลือก (เริ่มต้นของวัน)
            const targetDate = new Date(date);
            targetDate.setUTCHours(0, 0, 0, 0);

            // วันถัดไป (สิ้นสุดของวันที่เลือก)
            const nextDay = new Date(targetDate);
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);

            // หา operator ที่:
            // 1. เริ่มทำงานก่อนวันที่เลือก (date < targetDate)
            // 2. ยังไม่จบ (end_time = null) หรือ จบหลังจากเริ่มวันที่เลือก (end_time >= targetDate)
            const history = await prisma.tb_history_working.findFirst({
                where: {
                    machine_name,
                    date: {
                        lt: targetDate, // เริ่มก่อนวันที่เลือก
                    },
                    OR: [
                        { end_time: null }, // ยังไม่จบงาน
                        { end_time: { gte: targetDate } } // จบหลังจากเริ่มวันที่เลือก
                    ]
                },
                orderBy: {
                    date: "desc", // เอา record ล่าสุด
                },
                include: {
                    tbm_operator: {
                        select: {
                            operator_name: true,
                            picture_path: true,
                        },
                    },
                },
            });

            if (!history) {
                return res.json({ results: null });
            }

            return res.json({
                results: {
                    id: history.id,
                    emp_no: history.emp_no,
                    operator_name: history.tbm_operator?.operator_name || null,
                    picture_path: history.tbm_operator?.picture_path || null,
                    machine_name,
                    date: history.date,
                    start_time: history.start_time,
                    end_time: history.end_time,
                },
            });
        } catch (error) {
            console.error("❌ getActiveCrossDayOperator error:", error);
            return res.status(500).json({
                message: "Error fetching cross-day operator",
                error: error.message,
            });
        }
    },
};

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

            // ✅ Check duplicate: ตรวจสอบว่ามี record ที่ยังไม่จบงานของเครื่องนี้อยู่แล้วหรือไม่
            const existingHistory = await prisma.tb_history_working.findFirst({
                where: {
                    machine_name,
                    end_time: null,
                },
            });

            if (existingHistory) {
                // ถ้ามีอยู่แล้ว ให้คืนค่า record เดิมกลับไปเลย (หรือจะแจ้ง error ก็ได้ แต่คืนค่าเดิมจะ smooth กว่าสำหรับ frontend)
                console.log(`⚠️ Found existing active history for ${machine_name}, returning existing record.`);
                return res.json({
                    status: "ok",
                    message: "Existing working history found",
                    data: existingHistory
                });
            }

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

            const updated = await prisma.tb_history_working.update({
                where: { id: history_id },
                data: { end_time: utc7 },
                select: {
                    id: true,
                    emp_no: true,
                    machine_name: true,
                    start_time: true,
                    end_time: true,
                },
            });

            // 🟢 Emit Socket Event
            const io = req.app.get("io");
            if (io) {
                io.emit("machine_updated", {
                    machine_name: updated.machine_name,
                    status: "inactive"
                });
            }

            return res.json({
                status: "ok",
                message: "Updated end_time successfully",
                results: {
                    id: updated.id,
                    emp_no: updated.emp_no,
                    machine_name: updated.machine_name,
                    start_time_utc7: updated.start_time?.toISOString().replace("Z", "+07:00"),
                    end_time_utc7: updated.end_time?.toISOString().replace("Z", "+07:00"),
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

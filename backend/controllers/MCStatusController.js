const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const dayjs = require("dayjs");

module.exports = {
    /**
     * GET /api/mcstatus/timeline
     * Query: machine_name, date (YYYY-MM-DD = shift date)
     * Returns MCStatus records for the shift (07:00 TH → 06:59 TH next day)
     * Datetime in tb_MCStatus is stored as Local TH (+7)
     */
    getTimeline: async (req, res) => {
        try {
            const { machine_name, date } = req.query;

            if (!machine_name || !date) {
                return res.status(400).json({ message: "machine_name and date are required" });
            }

            // ======================================================
            // DB เก็บเวลาไทย (+7) ตรงๆ ใน column Datetime
            // Prisma ส่ง UTC value ของ JS Date ไป SQL query
            // ดังนั้นต้องสร้าง Date ที่ UTC hour = 7 เพื่อให้ SQL กรองด้วย '07:00'
            // ซึ่งตรงกับ 07:00 ไทยใน DB (เริ่มกะ)
            // ======================================================
            const year = parseInt(date.substring(0, 4));
            const month = parseInt(date.substring(5, 7)) - 1;
            const day = parseInt(date.substring(8, 10));

            // Query range: 07:00 วันนี้ → 07:00 พรุ่งนี้ (เวลาไทยตรงกับ DB)
            const startTH = new Date(Date.UTC(year, month, day, 7, 0, 0));
            const endTH = new Date(Date.UTC(year, month, day + 1, 7, 0, 0));

            const records = await prisma.tb_MCStatus.findMany({
                where: {
                    MC: machine_name,
                    Datetime: {
                        gte: startTH,
                        lt: endTH,
                    },
                },
                orderBy: { Datetime: "asc" },
                select: {
                    Datetime: true,
                    MCStatus: true,
                },
            });

            // Cross-day handling: find the last status BEFORE shift start
            // so the timeline starts with the carry-over status
            const lastBefore = await prisma.tb_MCStatus.findFirst({
                where: {
                    MC: machine_name,
                    Datetime: { lt: startTH },
                },
                orderBy: { Datetime: "desc" },
                select: { MCStatus: true },
            });

            // ======================================================
            // แปลง TH local (+7) → UTC จริง ก่อนส่ง Frontend
            // เพราะ Prisma แปะ 'Z' ทั้งที่ข้อมูลจริงเป็นเวลาไทย
            // ลบ 7 ชั่วโมง เพื่อให้ Frontend ใช้ getUTCHours() ได้ตรง
            // UTC 00:00 = TH 07:00 (เริ่มกะ), UTC 12:00 = TH 19:00 (เริ่มกะดึก)
            // ======================================================
            const TH_OFFSET_MS = 7 * 60 * 60 * 1000; // 7 hours in ms

            // Build results: prepend virtual record at shift start if carry-over exists
            const results = [];

            // Shift start in real UTC = date 00:00:00 UTC (= TH 07:00)
            const shiftStartUTC = new Date(Date.UTC(year, month, day, 0, 0, 0));

            if (lastBefore) {
                // Only prepend if the first real record is NOT at exactly 07:00 TH
                const firstIsAtStart = records.length > 0 &&
                    new Date(records[0].Datetime).getTime() === startTH.getTime();
                if (!firstIsAtStart) {
                    results.push({
                        datetime: shiftStartUTC, // UTC 00:00 = TH 07:00
                        mc_status: lastBefore.MCStatus,
                    });
                }
            }
            for (const r of records) {
                // r.Datetime จาก Prisma = เวลาไทยที่แปะ Z → ลบ 7h ให้เป็น UTC จริง
                results.push({
                    datetime: new Date(r.Datetime.getTime() - TH_OFFSET_MS),
                    mc_status: r.MCStatus,
                });
            }

            res.json({ results });
        } catch (err) {
            console.error("MCStatus getTimeline error:", err);
            res.status(500).json({ message: "Error fetching MC Status timeline", error: err.message });
        }
    },

    /**
     * GET /api/mcstatus/latest-all
     * Returns the latest MCStatus for every machine.
     * Response: { results: { "AHV-001": "Run_Time", ... } }
     */
    getLatestAll: async (req, res) => {
        try {
            // Use raw SQL with ROW_NUMBER to get the latest record per machine
            const rows = await prisma.$queryRaw`
                SELECT MC, MCStatus
                FROM (
                    SELECT MC, MCStatus, ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn
                    FROM tb_MCStatus
                ) sub
                WHERE rn = 1
            `;

            const results = {};
            for (const row of rows) {
                results[row.MC] = row.MCStatus;
            }

            res.json({ results });
        } catch (err) {
            console.error("MCStatus getLatestAll error:", err);
            res.status(500).json({ message: "Error fetching latest MC Status", error: err.message });
        }
    },
};

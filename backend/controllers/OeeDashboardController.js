const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const cacheService = require("../services/cacheService");
const influxService = require("../services/influxService");
const { getShiftDateUTC } = require("../utils/timeUtils");

// Helper: สร้าง shift boundaries สำหรับ InfluxDB query (UTC)
function getShiftBoundariesForDate(dateStr) {
    // Shift: 07:00 TH → 00:00 UTC ถึง 07:00 TH วันถัดไป → 00:00 UTC + 24h
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(5, 7)) - 1;
    const day = parseInt(dateStr.substring(8, 10));
    const startUTC = new Date(Date.UTC(year, month, day, 0, 0, 0)); // 07:00 TH = 00:00 UTC
    const endUTC = new Date(Date.UTC(year, month, day + 1, 0, 0, 0)); // 07:00 TH next day
    return { startUTC, endUTC };
}

// Helper: ลำดับชั่วโมงของการทำงาน (07:00 - 06:00)
const SHIFT_HOURS = [
    "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
    "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06",
];

module.exports = {
    // ============================================================
    // 1️⃣ GET /api/operator/picture/:emp_no
    // ============================================================
    getOperatorPicture: async (req, res) => {
        try {
            const { emp_no } = req.params;

            if (!emp_no)
                return res.status(400).json({ message: "emp_no is required" });

            // 🔍 ค้นหา operator
            const operator = await prisma.tbm_operator.findUnique({
                where: { emp_no },
            });

            // ✅ base directory ของ backend
            const baseDir = path.join(__dirname, "..");
            // ✅ path ของภาพ
            let imagePath = operator?.picture_path
                // ? operator.picture_path
                ? path.join(baseDir, "image", operator.picture_path)
                : path.join(baseDir, "image", "avg.png");
            // 🔹 ถ้าไม่เจอไฟล์ ให้ใช้ avg.png
            if (!fs.existsSync(imagePath)) {
                imagePath = path.join(baseDir, "image", "avg.png");
            }

            // ✅ resize ภาพให้เป็น 200x200
            const resizedImageBuffer = await sharp(imagePath)
                .resize(200, 200)
                .toBuffer();

            // ✅ ส่งกลับเป็น binary พร้อม header
            res.set("Content-Type", "image/png");
            res.send(resizedImageBuffer);
        } catch (error) {
            res.status(500).json({ message: "Error getting operator picture" });
        }
    },

    // ============================================================
    // 2️⃣ GET Last OEE
    // ============================================================
    getLastOEEByMachine: async (req, res) => {
        try {
            const { machine_name, date } = req.query;
            if (!machine_name) return res.status(400).json({ message: "machine_name is required" });

            let whereCondition = { machine_name, oee_value: { gt: 0 } };

            // ✅ Logic: หา OEE ของ "วันที่เลือก" (Selected Date)
            // ถ้าเลือกวันที่ 16 -> ให้หาของวันที่ 16
            let targetDate = date ? new Date(date) : new Date();

            // กำหนดเวลาเป็นสิ้นวันของวันที่เลือก (23:59:59.999)
            const endOfTargetDay = new Date(targetDate);
            endOfTargetDay.setHours(23, 59, 59, 999);

            whereCondition.date = {
                lte: endOfTargetDay
            };

            const data = await prisma.tb_oee.findFirst({
                where: whereCondition,
                orderBy: { date: "desc" },
            });

            if (!data) return res.json({ message: "ไม่พบข้อมูล", oee_value: 0 });
            res.json(data);
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Get Last OEE Error" });
        }
    },

    // ============================================================
    // 3️⃣ GET Data Table (Calculated Values)
    // ============================================================
    getDataTable: async (req, res) => {
        try {
            const { machine_name, date, model_name } = req.query; // date format: YYYY-MM-DD
            if (!machine_name || !date) return res.status(400).json({ message: "require machine_name and date" });

            const targetDate = new Date(date);
            const todayStr = getShiftDateUTC();
            const isToday = date === todayStr;

            // 1. ดึงข้อมูล Target (ไม่ filter ด้วย model_name — target เป็น per machine/date)
            let whereCondition = { machine_name, date: targetDate };

            let outputTargetDB;
            const cachedTargetWrapper = isToday ? cacheService.getTarget(machine_name) : null;

            if (cachedTargetWrapper && cachedTargetWrapper.target) {
                outputTargetDB = cachedTargetWrapper.target;
            } else {
                const outputTargetDBResult = await prisma.tb_output_target.findFirst({
                    where: whereCondition,
                });
                outputTargetDB = outputTargetDBResult;
            }

            // 2. ดึงข้อมูล Actual — ใช้ cache ถ้าดูวันนี้
            let outputActualDB;
            const cachedData = isToday ? cacheService.getFullDay(machine_name) : null;
            if (cachedData) {
                // Build a pseudo-DB row from cache
                outputActualDB = { machine_name, date: targetDate };
                for (const h of SHIFT_HOURS) {
                    outputActualDB[`actual_${h}`] = cachedData.output[`actual_${h}`] || 0;
                }
            } else {
                outputActualDB = await prisma.tb_output_actual.findFirst({
                    where: { machine_name, date: targetDate },
                });
            }

            if (!outputTargetDB) return res.json({ message: "No Target Data" });

            // --- 🕒 Logic การคำนวณเวลา ---
            const now = new Date();
            // สร้างขอบเขตเวลาของกะ (07:00 ของวันที่เลือก ถึง 07:00 ของวันถัดไป)
            const shiftStart = new Date(targetDate);
            shiftStart.setHours(7, 0, 0, 0);

            const shiftEnd = new Date(shiftStart);
            shiftEnd.setDate(shiftEnd.getDate() + 1);

            // ถ้าวันที่ดู เป็นอดีต -> เวลา "ปัจจุบัน" คือจบกะแล้ว
            // ถ้าวันที่ดู เป็นวันนี้ -> เวลา "ปัจจุบัน" คือ now
            let calculationTime = now;
            if (now > shiftEnd) {
                calculationTime = shiftEnd;
            } else if (now < shiftStart) {
                calculationTime = shiftStart; // ยังไม่เริ่มกะ
            }

            // --- 🧮 เริ่มคำนวณ ---
            let outputTargetAccumCurrent = 0; // Target สะสม ณ เวลาปัจจุบัน (Pro-rated)
            let outputTargetDayTotal = 0;     // Target ทั้งวัน
            let outputActualSum = 0;          // Actual รวม
            let validSeconds = 0;             // วินาทีทำงาน (เฉพาะที่มี Target)

            // Loop ตามชั่วโมงกะ (07 - 06)
            for (let i = 0; i < SHIFT_HOURS.length; i++) {
                const hStr = SHIFT_HOURS[i];
                const targetVal = outputTargetDB[`target_${hStr}`] || 0;
                const actualVal = outputActualDB ? (outputActualDB[`actual_${hStr}`] || 0) : 0;

                // 1. ผลรวม Actual ทั้งหมด
                outputActualSum += actualVal;

                // 2. ผลรวม Target ทั้งวัน (สำหรับ Achieve)
                outputTargetDayTotal += targetVal;

                // 3. คำนวณ Pro-rated Target และ Seconds
                // สร้างช่วงเวลาของชั่วโมงนี้ (เช่น 07:00 - 08:00)
                let currentHourStart = new Date(shiftStart);
                currentHourStart.setHours(shiftStart.getHours() + i); // เพิ่มทีละชั่วโมง

                let currentHourEnd = new Date(currentHourStart);
                currentHourEnd.setHours(currentHourEnd.getHours() + 1);

                // ตรวจสอบว่า calculationTime อยู่ในช่วงไหน
                if (calculationTime >= currentHourEnd) {
                    // ผ่านชั่วโมงนี้มาเต็มๆ แล้ว -> คิดเต็ม
                    outputTargetAccumCurrent += targetVal;
                    if (targetVal > 0) validSeconds += 3600; // 1 ชม. = 3600 วิ
                } else if (calculationTime > currentHourStart && calculationTime < currentHourEnd) {
                    // อยู่ระหว่างชั่วโมงนี้ (เช่น ตอนนี้ 8:30) -> คิดตามสัดส่วนนาที
                    const minutesPassed = (calculationTime - currentHourStart) / 1000 / 60; // นาทีที่ผ่านไป
                    const ratio = minutesPassed / 60;

                    outputTargetAccumCurrent += Math.round(targetVal * ratio); // คิด target ตามสัดส่วน

                    if (targetVal > 0) {
                        validSeconds += (minutesPassed * 60); // บวกวินาทีที่ผ่านไปจริง
                    }
                }
                // ถ้า calculationTime < currentHourStart (อนาคต) -> ไม่บวก Target และ Time
            }

            // --- 📊 Final Calculation ---

            // Cycle Time Actual = วินาทีทำงาน / ผลรวม Output Actual
            // let cycleTimeActual = 0;
            // if (outputActualSum > 0) {
            //     cycleTimeActual = validSeconds / outputActualSum;
            // }

            // Efficiency Actual = (Actual รวม / Target สะสม ณ เวลานั้น) * 100
            // let efficiencyActual = 0;
            // if (outputTargetAccumCurrent > 0) {
            //     efficiencyActual = (outputActualSum / outputTargetAccumCurrent) * 100;
            // }

            // Achieve = Actual รวม / Target ทั้งวัน
            // let achieve = 0;
            // if (outputTargetDayTotal > 0) {
            //     achieve = (outputActualSum / outputTargetDayTotal) * 100;
            // }
            let achieve = 0;
            if (outputActualSum > 0) {
                achieve = (outputActualSum / outputTargetAccumCurrent) * 100;
            }
            // get oee data
            // ✅ Logic: หา OEE ของ "วันที่เลือก" (Selected Date)
            const endOfTargetDay = new Date(targetDate);
            endOfTargetDay.setHours(23, 59, 59, 999);

            const dataOee = await prisma.tb_oee.findFirst({
                where: {
                    machine_name,
                    oee_value: { gt: 0 },
                    date: { lte: endOfTargetDay } // ✅ Filter by selected date
                },
                orderBy: { date: "desc" },
            });
            console.log("dataOee: " + dataOee) // Removed: too noisy
            // }
            // ดึง CT และ Eff — ใช้ cache ถ้าดูวันนี้
            let cycleTimeActual = 0;
            let efficiencyActual = 0;

            if (cachedData) {
                cycleTimeActual = cachedData.overall.avgCycleTime || 0;
                efficiencyActual = cachedData.overall.totalEfficiency || 0;
            } else {
                const cycleTimeActualDB = await prisma.tb_cycle_time_actual.findFirst({
                    where: { machine_name, date: targetDate },
                });
                if (cycleTimeActualDB && cycleTimeActualDB.cycle_time) {
                    cycleTimeActual = cycleTimeActualDB.cycle_time;
                }

                const effActualDB = await prisma.tb_efficiency_actual.findFirst({
                    where: { machine_name, date: targetDate },
                });
                if (effActualDB && effActualDB.eff_actual) {
                    efficiencyActual = effActualDB.eff_actual;
                }
            }

            // ✅ Phase 1: ดึง Model จาก InfluxDB (Actual) แทน Target
            let actualModel = "-";
            try {
                const { startUTC, endUTC } = getShiftBoundariesForDate(date);
                const now = new Date();
                const queryEnd = now < endUTC ? now : endUTC;
                const actualModels = await influxService.queryActualModels(machine_name, startUTC, queryEnd);
                if (actualModels.length > 0) {
                    actualModel = actualModels[0].model_name; // dominant model (sorted by count desc)
                }
            } catch (e) {
                console.error("getDataTable: InfluxDB model query failed:", e.message);
            }
            // Fallback chain: InfluxDB → tb_output_actual → tb_output_target
            if (actualModel === "-") {
                const actualRow = await prisma.tb_output_actual.findFirst({
                    where: { machine_name, date: targetDate },
                });
                if (actualRow?.model_name) actualModel = actualRow.model_name;
                else actualModel = outputTargetDB.model_name || "-";
            }

            res.json({
                machine_name,
                model: actualModel,
                outputTarget: outputTargetAccumCurrent, // Target ณ เวลานั้น (Pro-rated)
                outputActual: outputActualSum,
                cycleTimeTarget: outputTargetDB.cycle_time_target,
                cycleTimeActual: parseFloat(cycleTimeActual.toFixed(2)),
                efficiencyTarget: outputTargetDB.eff_target,
                efficiencyActual: parseFloat(efficiencyActual.toFixed(2)),
                Achieve: parseFloat(achieve.toFixed(2)),
                oee: dataOee ? dataOee.oee_value : 0,
                oeeDate: dataOee ? dataOee.date : null
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Get DataTable Error" });
        }
    },

    // ============================================================
    // 4️⃣ GET Actual Graph 1 (Output)
    // ============================================================
    getActualGraph1: async (req, res) => {
        try {
            const { machine_name, date, model_name } = req.query;
            if (!machine_name || !date) return res.status(400).json({ message: "Missing params" });

            const targetDate = new Date(date);
            const todayStr = getShiftDateUTC();
            const isToday = date === todayStr;

            // ไม่ filter ด้วย model_name — target เป็น per machine/date
            const outputTargetDB = await prisma.tb_output_target.findFirst({
                where: { machine_name, date: targetDate },
            });

            // ใช้ cache ถ้าดูวันนี้
            let outputActualDB;
            const cachedData = isToday ? cacheService.getFullDay(machine_name) : null;
            if (cachedData) {
                outputActualDB = { machine_name, date: targetDate };
                for (const h of SHIFT_HOURS) {
                    outputActualDB[`actual_${h}`] = cachedData.output[`actual_${h}`] || 0;
                }
            } else {
                outputActualDB = await prisma.tb_output_actual.findFirst({
                    where: { machine_name, date: targetDate },
                });
            }

            let outputActual = [];
            let outputActualAccum = [];
            let outputTarget = [];
            let outputTargetAccum = [];

            let accActual = 0;
            let accTarget = 0;

            for (const h of SHIFT_HOURS) {
                // Actual
                const act = outputActualDB ? (outputActualDB[`actual_${h}`] || 0) : 0;
                accActual += act;
                outputActual.push(act);
                outputActualAccum.push(accActual);

                // Target
                const tgt = outputTargetDB ? (outputTargetDB[`target_${h}`] || 0) : 0;
                accTarget += tgt;
                outputTarget.push(tgt);
                outputTargetAccum.push(accTarget);
            }

            res.json({
                hours: SHIFT_HOURS,
                outputActual,
                outputActualAccum,
                outputTarget,
                outputTargetAccum
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Get Graph1 Error" });
        }
    },

    // ============================================================
    // 5️⃣ GET Actual Graph 2 (CT & Efficiency)
    // ============================================================
    getActualGraph2: async (req, res) => {
        try {
            const { machine_name, date, model_name } = req.query;
            if (!machine_name || !date) return res.status(400).json({ message: "Missing params" });

            const targetDate = new Date(date);
            const todayStr = getShiftDateUTC();
            const isToday = date === todayStr;

            // ไม่ filter ด้วย model_name — target เป็น per machine/date
            // ดึง Target เพื่อเอาค่า CT/Eff target
            const outputTargetDB = await prisma.tb_output_target.findFirst({
                where: { machine_name, date: targetDate },
            });

            // ใช้ cache ถ้าดูวันนี้
            let ctActualDB, effActualDB;
            const cachedData = isToday ? cacheService.getFullDay(machine_name) : null;
            if (cachedData) {
                ctActualDB = { machine_name, date: targetDate };
                effActualDB = { machine_name, date: targetDate };
                for (const h of SHIFT_HOURS) {
                    ctActualDB[`cycle_${h}`] = cachedData.cycleTime[`cycle_${h}`] || 0;
                    effActualDB[`eff_${h}`] = cachedData.efficiency[`eff_${h}`] || 0;
                }
            } else {
                ctActualDB = await prisma.tb_cycle_time_actual.findFirst({
                    where: { machine_name, date: targetDate },
                });
                effActualDB = await prisma.tb_efficiency_actual.findFirst({
                    where: { machine_name, date: targetDate },
                });
            }

            let cycleTimeActual = [];
            let cycleTimeTarget = [];
            let efficiencyActual = [];
            let efficiencyTarget = [];

            const targetCTValue = outputTargetDB ? outputTargetDB.cycle_time_target : 0;
            const targetEffValue = outputTargetDB ? outputTargetDB.eff_target : 0;

            for (const h of SHIFT_HOURS) {
                // CT Actual
                const ctAct = ctActualDB ? (ctActualDB[`cycle_${h}`] || 0) : 0;
                cycleTimeActual.push(ctAct);

                // CT Target (ค่าเดียวกันทุกชม.)
                cycleTimeTarget.push(targetCTValue);

                // Eff Actual
                const effAct = effActualDB ? (effActualDB[`eff_${h}`] || 0) : 0;
                efficiencyActual.push(effAct);

                // Eff Target (ค่าเดียวกันทุกชม.)
                efficiencyTarget.push(targetEffValue);
            }

            res.json({
                hours: SHIFT_HOURS,
                cycleTimeActual,
                cycleTimeTarget,
                efficiencyActual,
                efficiencyTarget
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Get Graph2 Error" });
        }
    },

    // ============================================================
    // 6️⃣ GET Models by Date (✅ Phase 1: InfluxDB Actual → fallback MSSQL)
    // ============================================================
    getModelsByDate: async (req, res) => {
        try {
            const { machine_name, date } = req.query;
            if (!machine_name || !date) {
                return res.status(400).json({ message: "machine_name and date required" });
            }

            const targetDate = new Date(date);

            // 1️⃣ Try InfluxDB first (actual models produced)
            try {
                const { startUTC, endUTC } = getShiftBoundariesForDate(date);
                const now = new Date();
                const queryEnd = now < endUTC ? now : endUTC;
                const actualModels = await influxService.queryActualModels(machine_name, startUTC, queryEnd);
                if (actualModels.length > 0) {
                    return res.json({ results: actualModels, source: "influxdb" });
                }
            } catch (e) {
                console.error("getModelsByDate: InfluxDB query failed, falling back:", e.message);
            }

            // 2️⃣ Fallback: tb_output_actual (Cron-written model_name)
            const actualRow = await prisma.tb_output_actual.findFirst({
                where: { machine_name, date: targetDate },
                select: { model_name: true },
            });
            if (actualRow?.model_name) {
                return res.json({ results: [{ model_name: actualRow.model_name }], source: "mssql_actual" });
            }

            // 3️⃣ Fallback: tb_output_target (original)
            const models = await prisma.tb_output_target.findMany({
                where: { machine_name, date: targetDate },
                select: { model_name: true },
                distinct: ['model_name']
            });

            return res.json({ results: models, source: "mssql_target" });
        } catch (error) {
            console.error("getModelsByDate error:", error);
            return res.status(500).json({ message: "Error fetching models", error: error.message });
        }
    }
};
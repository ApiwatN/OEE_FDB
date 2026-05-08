const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { queryNgCount, queryAllMachinesNgCount } = require("../services/influxService");
const { getShiftDateUTC } = require("../utils/timeUtils");
const { calcManualNgMetrics } = require("../services/oeeCalcService");

module.exports = {
    /**
     * GET /api/oee-update/list?area=xxx&type=xxx
     * รายชื่อเครื่องทั้งหมด + oee_mode + OEE ล่าสุด
     */
    list: async (req, res) => {
        try {
            const { area, type } = req.query;
            const where = {};
            if (area && area !== "all") where.machine_area = area;
            if (type && type !== "all") where.machine_type = type;

            const machines = await prisma.tbm_machine.findMany({
                where,
                orderBy: { machine_name: "asc" },
            });

            // Get configs (for oee_mode)
            const configs = await prisma.tb_machine_plan_config.findMany({
                select: { machine_name: true, oee_mode: true },
            });
            const configMap = new Map(configs.map(c => [c.machine_name, c]));

            // Build today & yesterday as UTC midnight
            const todayStr = getShiftDateUTC();
            const tp = todayStr.split("-");
            const today = new Date(Date.UTC(parseInt(tp[0]), parseInt(tp[1]) - 1, parseInt(tp[2])));
            const yesterday = new Date(today);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);

            // Fetch OEE for both days in one query
            const oeeRecords = await prisma.tb_oee.findMany({
                where: { date: { in: [today, yesterday] } },
            });
            const oeeMapToday = new Map();
            const oeeMapYesterday = new Map();
            for (const o of oeeRecords) {
                const d = new Date(o.date).toISOString().split("T")[0];
                if (d === todayStr) {
                    oeeMapToday.set(o.machine_name, o);
                } else {
                    oeeMapYesterday.set(o.machine_name, o);
                }
            }

            // Get today's output
            const outputRecords = await prisma.tb_output_actual.findMany({
                where: { date: today },
            });
            const outputMap = new Map(outputRecords.map(o => [o.machine_name, o]));

            const yesterdayStr = yesterday.toISOString().split("T")[0];

            const results = machines.map(m => {
                const cfg = configMap.get(m.machine_name);
                const mode = cfg?.oee_mode || "manual";
                const output = outputMap.get(m.machine_name);
                const totalOutput = output?.Overall || 0;

                // manual → yesterday data (NG/quality/oee จาก user กรอก)
                // auto → today data (NG/quality/oee จาก InfluxDB realtime)
                const oeeToday = oeeMapToday.get(m.machine_name);
                const oeeYesterday = oeeMapYesterday.get(m.machine_name);
                const oee = mode === "manual" ? oeeYesterday : oeeToday;

                // availability/performance → ใช้ today เสมอ (realtime)
                return {
                    machine_name: m.machine_name,
                    machine_type: m.machine_type,
                    machine_area: m.machine_area,
                    oee_mode: mode,
                    ng_qty: oee?.ng_qty || 0,
                    quality: oee?.quality || 0,
                    availability: oeeToday?.availability || 0,
                    performance: oeeToday?.performance || 0,
                    oee_value: oee?.oee_value || 0,
                    total_output: totalOutput,
                    display_date: mode === "manual" ? yesterdayStr : todayStr,
                };
            });

            res.json({ results });
        } catch (err) {
            console.error("OEE list error:", err);
            res.status(500).json({ message: "Error listing OEE data" });
        }
    },

    /**
     * POST /api/oee-update/set-mode
     * body: { machine_name, oee_mode: "auto"|"manual" }
     */
    setMode: async (req, res) => {
        try {
            const { machine_name, oee_mode } = req.body;
            if (!machine_name || !["auto", "manual"].includes(oee_mode)) {
                return res.status(400).json({ message: "Invalid machine_name or oee_mode" });
            }

            // Upsert config with oee_mode
            await prisma.tb_machine_plan_config.upsert({
                where: { machine_name },
                update: { oee_mode },
                create: {
                    machine_name,
                    eff_target: 90,
                    cycle_time_target: 4.2,
                    active_hours: JSON.stringify({
                        "07": true, "08": true, "09": true, "10": true, "11": true, "12": true,
                        "13": true, "14": true, "15": true, "16": true, "17": true, "18": true,
                        "19": true, "20": true, "21": true, "22": true, "23": true, "00": true,
                        "01": true, "02": true, "03": true, "04": true, "05": true, "06": true,
                    }),
                    oee_mode,
                },
            });

            res.json({ success: true, message: `OEE mode set to ${oee_mode} for ${machine_name}` });
        } catch (err) {
            console.error("Set mode error:", err);
            res.status(500).json({ message: "Error setting OEE mode" });
        }
    },

    /**
     * POST /api/oee-update/manual-ng
     * body: { machine_name, date, ng_qty }
     * คำนวณ Quality/OEE แล้ว upsert tb_oee
     */
    manualNg: async (req, res) => {
        try {
            const { machine_name, date, ng_qty } = req.body;
            if (!machine_name || !date || ng_qty === undefined) {
                return res.status(400).json({ message: "ต้องระบุ machine_name, date, ng_qty" });
            }

            const parts = date.split("-");
            const targetDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
            const ngVal = parseInt(ng_qty, 10) || 0;

            // Get output actual
            const output = await prisma.tb_output_actual.findFirst({
                where: { machine_name, date: targetDate },
            });
            const totalOutput = output?.Overall || 0;

            // Get existing OEE (availability, performance)
            const existing = await prisma.tb_oee.findFirst({
                where: { machine_name, date: targetDate },
            });
            const availability = existing?.availability || 0;
            const performance = existing?.performance || 0;

            const { quality, oeeValue } = calcManualNgMetrics(totalOutput, ngVal, availability, performance);

            // Upsert
            await prisma.tb_oee.upsert({
                where: { machine_name_date: { machine_name, date: targetDate } },
                update: {
                    ng_qty: ngVal,
                    quality,
                    oee_value: oeeValue,
                },
                create: {
                    machine_name,
                    date: targetDate,
                    availability,
                    performance,
                    ng_qty: ngVal,
                    quality,
                    oee_value: oeeValue,
                },
            });

            // ✅ [Phase 5] อัปเดต RAM ทันทีถ้าเป็นการกรอก NG ของวันนี้
            // ทำให้ Quality% และ OEE บนหน้า Dashboard เปลี่ยนทันทีใน 2 วินาทีโดยไม่ต้องรอ Slow Loop 5 นาที
            const todayStr = getShiftDateUTC();
            if (date === todayStr) {
                try {
                    const memOeeService = require('../services/memoryOeeService');
                    memOeeService.setManualNg(machine_name, ngVal);
                } catch (memErr) {
                    console.error('[OeeUpdate] memoryOeeService.setManualNg error:', memErr.message);
                }
            }

            res.json({
                success: true,
                data: {
                    machine_name,
                    date: date,
                    total_output: totalOutput,
                    ng_qty: ngVal,
                    quality,
                    availability,
                    performance,
                    oee_value: oeeValue,
                },
            });
        } catch (err) {
            console.error("Manual NG error:", err);
            res.status(500).json({ message: "Error saving NG data" });
        }
    },

    /**
     * POST /api/oee-update/manual-ng-batch
     * body: { machine_name, items: [{ date, ng_qty }, ...] }
     * บันทึก NG หลายวันพร้อมกัน
     */
    manualNgBatch: async (req, res) => {
        try {
            const { machine_name, items } = req.body;
            if (!machine_name || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ message: "ต้องระบุ machine_name และ items[]" });
            }

            const results = [];
            const errors = [];
            for (const item of items) {
                try {
                    const { date, ng_qty } = item;
                    if (!date) continue;

                    // Parse date safely as UTC midnight
                    const parts = date.split("-");
                    const targetDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
                    const ngVal = parseInt(ng_qty, 10) || 0;

                    const output = await prisma.tb_output_actual.findFirst({
                        where: { machine_name, date: targetDate },
                    });
                    const totalOutput = output?.Overall || 0;

                    const existing = await prisma.tb_oee.findFirst({
                        where: { machine_name, date: targetDate },
                    });
                    const availability = existing?.availability || 0;
                    const performance = existing?.performance || 0;

                    const { quality, oeeValue } = calcManualNgMetrics(totalOutput, ngVal, availability, performance);

                    await prisma.tb_oee.upsert({
                        where: { machine_name_date: { machine_name, date: targetDate } },
                        update: {
                            ng_qty: ngVal,
                            quality,
                            oee_value: oeeValue,
                        },
                        create: {
                            machine_name, date: targetDate,
                            availability, performance,
                            ng_qty: ngVal,
                            quality,
                            oee_value: oeeValue,
                        },
                    });

                    results.push({
                        date, total_output: totalOutput, ng_qty: ngVal,
                        quality,
                        availability, performance,
                        oee_value: oeeValue,
                    });
                } catch (itemErr) {
                    console.error(`Batch NG error for date ${item.date}:`, itemErr.message);
                    errors.push({ date: item.date, error: itemErr.message });
                }
            }

            // ✅ Emit realtime_update ทันทีสำหรับวันปัจจุบัน (ไม่ต้องรอ Slow Loop 5 นาที)
            const todayStr = getShiftDateUTC();
            const todayResults = results.filter(r => r.date === todayStr);
            if (todayResults.length > 0 && req.app.get("io")) {
                const io = req.app.get("io");
                const r = todayResults[0]; // manualNgBatch = 1 เครื่อง หลายวัน → วันนี้มีแค่ 1 record
                const payload = {
                    serverTimeUTC: new Date().toISOString(),
                    shiftDate: todayStr,
                    machines: {
                        [machine_name]: {
                            daily: {
                                availability: r.availability,
                                performance: r.performance,
                                quality: r.quality,
                                oee: r.oee_value,
                                ngQty: r.ng_qty,
                                oeeMode: "manual",
                            },
                        },
                    },
                };
                io.to("dashboard").emit("realtime_update", payload);
                io.to(`machine:${machine_name}`).emit("realtime_update", payload);
            }

            res.json({ success: true, saved: results.length, errors: errors.length, errorDetails: errors, results });
        } catch (err) {
            console.error("Manual NG batch error:", err);
            res.status(500).json({ message: "Error saving batch NG data" });
        }
    },

    /**
     * GET /api/oee-update/history/:machine?days=30  OR  ?year=2026&month=2
     * ดึงประวัติ OEE ย้อนหลัง (รองรับดึงทั้งเดือน)
     */
    history: async (req, res) => {
        try {
            const { machine } = req.params;
            const { year, month, days } = req.query;

            let since, until;
            if (year && month) {
                // ดึงทั้งเดือน
                since = new Date(parseInt(year), parseInt(month) - 1, 1);
                until = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59); // last day of month
            } else {
                const d = parseInt(days || "30", 10);
                since = new Date();
                since.setDate(since.getDate() - d);
                since.setHours(0, 0, 0, 0);
                until = new Date();
            }

            const dateFilter = { gte: since, lte: until };

            const oeeRecords = await prisma.tb_oee.findMany({
                where: { machine_name: machine, date: dateFilter },
                orderBy: { date: "desc" },
            });

            // Get output actuals for the same period
            const outputs = await prisma.tb_output_actual.findMany({
                where: { machine_name: machine, date: dateFilter },
            });
            const outputMap = new Map(outputs.map(o => [o.date.toISOString().split("T")[0], o.Overall || 0]));
            const oeeMap = new Map(oeeRecords.map(o => [o.date.toISOString().split("T")[0], o]));

            // รวมทุกวันที่มี output หรือ oee record
            const allDates = new Set([...outputMap.keys(), ...oeeMap.keys()]);
            const results = Array.from(allDates)
                .sort((a, b) => b.localeCompare(a)) // desc
                .map(dateStr => {
                    const o = oeeMap.get(dateStr);
                    return {
                        date: dateStr,
                        ng_qty: o?.ng_qty || 0,
                        quality: o?.quality || 0,
                        availability: o?.availability || 0,
                        performance: o?.performance || 0,
                        oee_value: o?.oee_value || 0,
                        total_output: outputMap.get(dateStr) || 0,
                    };
                });

            res.json({ results });
        } catch (err) {
            console.error("OEE history error:", err);
            res.status(500).json({ message: "Error fetching OEE history" });
        }
    },

    /**
     * POST /api/oee-update/manual-ng-multi-machine
     * body: { date, items: [{ machine_name, ng_qty }, ...] }
     * บันทึก NG หลายเครื่อง 1 วันพร้อมกัน
     */
    manualNgMultiMachine: async (req, res) => {
        try {
            const { date, items } = req.body;
            if (!date || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ message: "ต้องระบุ date และ items[]" });
            }

            // Parse date as UTC midnight
            const parts = date.split("-");
            const targetDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));

            const results = [];
            const errors = [];
            for (const item of items) {
                try {
                    const { machine_name, ng_qty } = item;
                    if (!machine_name) continue;
                    const ngVal = parseInt(ng_qty, 10) || 0;

                    const output = await prisma.tb_output_actual.findFirst({
                        where: { machine_name, date: targetDate },
                    });
                    const totalOutput = output?.Overall || 0;

                    const existing = await prisma.tb_oee.findFirst({
                        where: { machine_name, date: targetDate },
                    });
                    const availability = existing?.availability || 0;
                    const performance = existing?.performance || 0;

                    const { quality, oeeValue } = calcManualNgMetrics(totalOutput, ngVal, availability, performance);

                    await prisma.tb_oee.upsert({
                        where: { machine_name_date: { machine_name, date: targetDate } },
                        update: {
                            ng_qty: ngVal,
                            quality,
                            oee_value: oeeValue,
                        },
                        create: {
                            machine_name, date: targetDate,
                            availability, performance,
                            ng_qty: ngVal,
                            quality,
                            oee_value: oeeValue,
                        },
                    });

                    results.push({
                        machine_name, total_output: totalOutput, ng_qty: ngVal,
                        quality,
                        availability, performance,
                        oee_value: oeeValue,
                    });
                } catch (itemErr) {
                    console.error(`Multi-machine NG error for ${item.machine_name}:`, itemErr.message);
                    errors.push({ machine_name: item.machine_name, error: itemErr.message });
                }
            }

            // ✅ Emit realtime_update ทันทีสำหรับวันปัจจุบัน (ไม่ต้องรอ Slow Loop 5 นาที)
            const todayStr = getShiftDateUTC();
            if (date === todayStr && results.length > 0 && req.app.get("io")) {
                const io = req.app.get("io");
                const machines = {};
                for (const r of results) {
                    machines[r.machine_name] = {
                        daily: {
                            availability: r.availability,
                            performance: r.performance,
                            quality: r.quality,
                            oee: r.oee_value,
                            ngQty: r.ng_qty,
                            oeeMode: "manual",
                        },
                    };
                }
                const payload = {
                    serverTimeUTC: new Date().toISOString(),
                    shiftDate: todayStr,
                    machines,
                };
                io.to("dashboard").emit("realtime_update", payload);
                // Emit ไปที่ room เฉพาะเครื่องด้วย
                for (const r of results) {
                    io.to(`machine:${r.machine_name}`).emit("realtime_update", {
                        serverTimeUTC: payload.serverTimeUTC,
                        shiftDate: todayStr,
                        machines: { [r.machine_name]: machines[r.machine_name] },
                    });
                }
            }

            res.json({ success: true, saved: results.length, errors: errors.length, errorDetails: errors, results });
        } catch (err) {
            console.error("Manual NG multi-machine error:", err);
            res.status(500).json({ message: "Error saving multi-machine NG data" });
        }
    },

    /**
     * GET /api/oee-update/auto-ng/:machine
     * ดู NG count realtime จาก InfluxDB (วันนี้)
     */
    autoNg: async (req, res) => {
        try {
            const { machine } = req.params;

            // Shift: 07:00 TH today → now TH
            const now = new Date();
            const year = now.getUTCFullYear();
            const month = now.getUTCMonth();
            const day = now.getUTCDate();
            const shiftStart = new Date(Date.UTC(year, month, day, 0, 0, 0)); // 07:00 TH = 00:00 UTC
            const shiftEnd = now;

            const ngCount = await queryNgCount(machine, shiftStart, shiftEnd);
            res.json({ machine_name: machine, ng_count: ngCount, shift_start: shiftStart, shift_end: shiftEnd });
        } catch (err) {
            console.error("Auto NG error:", err);
            res.status(500).json({ message: "Error querying NG count" });
        }
    },
};

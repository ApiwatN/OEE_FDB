const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const cacheService = require("../services/cacheService");
const influxService = require("../services/influxService");
const { groupActualRowsByMachineAndDate, sumActualByHour } = require("../services/actualOutputService");
const { getShiftDateUTC, SHIFT_HOURS, getCurrentHourBoundaries } = require("../utils/timeUtils");

module.exports = {
  // =============================================================
  // 1) รายชื่อ Area
  // =============================================================
  listArea: async (req, res) => {
    try {
      const rows = await prisma.tbm_machine.findMany({
        select: { machine_area: true },
        distinct: ["machine_area"],
        orderBy: { machine_area: "asc" },
      });

      res.json({ results: rows });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  },

  // =============================================================
  // 2) ประเภทเครื่อง + รายการเครื่อง + แผนวันนี้/พรุ่งนี้ + operator
  // =============================================================
  listTypeWithMachines: async (req, res) => {
    try {
      const machine_area = req.params.area;
      if (!machine_area) return res.json({ results: [] });

      // ---- ช่วงเวลา (วันนี้ / พรุ่งนี้) ----
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

      const todayISO = today.toISOString().slice(0, 10);
      const tomorrowISO = tomorrow.toISOString().slice(0, 10);

      // ---- 1. ดึงเครื่องทั้งหมด ----
      const machines = await prisma.tbm_machine.findMany({
        where: {
          machine_area,
          status: "active",
        },
        orderBy: { machine_type: "asc" },
        select: {
          id: true,
          machine_name: true,
          machine_type: true,
          full_machine_type: true,
          status: true,
        },
      });

      // ---- 2. ดึงแผน target ----
      const targets = await prisma.tb_output_target.findMany({
        where: {
          date: {
            gte: today,
            lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2)),
          },
        },
      });

      const targetMap = new Map();
      for (const t of targets) {
        const key = `${t.machine_name}__${t.date.toISOString().slice(0, 10)}`;
        targetMap.set(key, t);
      }

      // ---- 3. Operator กำลังทำงาน (end_time = null) ----
      const activeWorks = await prisma.tb_history_working.findMany({
        where: {
          end_time: null,
        },
        select: {
          id: true,
          emp_no: true,
          machine_name: true,
          tbm_operator: {
            select: {
              operator_name: true,
              picture_path: true,
            },
          },
        },
      });

      const activeMap = new Map();
      for (const w of activeWorks) {
        activeMap.set(w.machine_name, {
          history_id: w.id,
          emp_no: w.emp_no,
          operator_name: w.tbm_operator?.operator_name || null,
          picture_path: w.tbm_operator?.picture_path || null,
        });
      }

      // ---- 4. Group ตาม machine_type ----
      const grouped = {};

      for (const m of machines) {
        if (!grouped[m.machine_type]) {
          grouped[m.machine_type] = {
            machine_type: m.machine_type,
            full_machine_type: m.full_machine_type || m.machine_type,
            machines: [],
          };
        }

        const todayPlan = targetMap.get(`${m.machine_name}__${todayISO}`) || null;
        const tomorrowPlan = targetMap.get(`${m.machine_name}__${tomorrowISO}`) || null;
        const activeInfo = activeMap.get(m.machine_name) || null;

        grouped[m.machine_type].machines.push({
          id: m.id,
          name: m.machine_name,
          status: m.status,

          today_plan: todayPlan
            ? {
              id: todayPlan.id,
              date: todayPlan.date,
              model_name: todayPlan.model_name,
              pc_target: todayPlan.pc_target,
              eff_target: todayPlan.eff_target,
              cycle_time_target: todayPlan.cycle_time_target,
            }
            : null,

          tomorrow_plan: tomorrowPlan
            ? {
              id: tomorrowPlan.id,
              date: tomorrowPlan.date,
              model_name: tomorrowPlan.model_name,
              pc_target: tomorrowPlan.pc_target,
              eff_target: tomorrowPlan.eff_target,
              cycle_time_target: tomorrowPlan.cycle_time_target,
            }
            : null,

          operator: activeInfo
            ? {
              history_id: activeInfo.history_id,
              emp_no: activeInfo.emp_no,
              name: activeInfo.operator_name,
              picture: activeInfo.picture_path,
            }
            : null,
        });
      }

      res.json({ results: Object.values(grouped) });

    } catch (error) {
      console.error("❌ listTypeWithMachines error:", error);
      res.status(500).json({
        message: "Error fetching machine list",
        error: error.message,
      });
    }
  },
  // =============================================================
  // 3) รายชื่อ Type ใน Area
  // =============================================================
  listType: async (req, res) => {
    try {
      const area = req.params.area?.trim();
      if (!area) return res.status(400).json({ message: "กรุณาระบุ area" });

      const types = await prisma.tbm_machine.findMany({
        where: {
          machine_area: area,
          status: "active",
        },
        distinct: ["machine_type"],
        select: { machine_type: true },
        orderBy: { machine_type: "asc" },
      });

      res.json({ results: types.map(t => t.machine_type) });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  },

  // =============================================================
  // 4) รายชื่อเครื่องใน Area + Type (รองรับ type = "all")
  // =============================================================
  listMachines: async (req, res) => {
    try {
      const area = req.params.area?.trim();
      const type = req.params.type?.trim();

      if (!area)
        return res.status(400).json({ message: "กรุณาระบุ area" });

      const where = {
        machine_area: area,
        status: "active",
      };
      // ถ้า type ไม่ใช่ "all" ให้ filter ตาม machine_type
      if (type && type !== "all") {
        where.machine_type = type;
      }

      const machines = await prisma.tbm_machine.findMany({
        where,
        select: {
          id: true,
          machine_name: true,
          machine_type: true,
          status: true,
        },
        orderBy: { machine_name: "asc" },
      });

      res.json({ results: machines });

    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // =============================================================
  // 5) รายชื่อ Process ตาม Machine Type
  // =============================================================
  listProcess: async (req, res) => {
    try {
      const { machine_type } = req.params;
      if (!machine_type) return res.status(400).json({ message: "No machine type" });

      const processes = await prisma.tbm_process.findMany({
        where: {
          machine_type: machine_type,
          status: "active"
        },
        orderBy: { process_name: "asc" }
      });

      res.json({ results: processes });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Error fetching processes" });
    }
  },

  // =============================================================
  // 6) รายชื่อ Machine ทั้งหมดแยกตาม Area (สำหรับ Layout Dashboard)
  // =============================================================
  listAllMachinesByArea: async (req, res) => {
    try {
      // ดึง machine ทั้งหมดที่ active
      const machines = await prisma.tbm_machine.findMany({
        where: { status: "active" },
        orderBy: [
          { machine_area: "asc" },
          { machine_type: "asc" },
          { machine_name: "asc" }
        ],
        select: {
          id: true,
          machine_area: true,
          machine_type: true,
          machine_name: true,
        }
      });

      // Group by Area
      const grouped = {};
      for (const m of machines) {
        if (!grouped[m.machine_area]) {
          grouped[m.machine_area] = {
            area: m.machine_area,
            machines: []
          };
        }
        grouped[m.machine_area].machines.push({
          id: m.id,
          type: m.machine_type,
          name: m.machine_name
        });
      }

      res.json({ results: Object.values(grouped) });
    } catch (e) {
      console.error("❌ listAllMachinesByArea error:", e);
      res.status(500).json({ message: e.message });
    }
  },

  // =============================================================
  // 7) ข้อมูลเครื่องจักรพร้อมข้อมูลวันปัจจุบัน (สำหรับ Layout Dashboard Cards)
  // =============================================================
  getMachinesWithTodayData: async (req, res) => {
    try {
      // ดึงวันที่จาก query หรือใช้วันปัจจุบัน
      const dateParam = req.query.date;
      const todayStr = getShiftDateUTC();
      const dateISO = dateParam || todayStr;
      const isToday = dateISO === todayStr;
      const targetDate = new Date(dateISO);

      // 1. ดึง machines ทั้งหมดที่ active (ใช้ cache list ถ้ามี)
      let machines = cacheService.getMachineList();
      if (machines.length === 0) {
        machines = await prisma.tbm_machine.findMany({
          where: { status: "active" },
          orderBy: [
            { machine_area: "asc" },
            { machine_type: "asc" },
            { machine_name: "asc" }
          ],
          select: {
            id: true,
            machine_area: true,
            machine_type: true,
            machine_name: true,
          }
        });
      }

      // 2. ดึง target ของวันนี้ (Layer 3 fallback: process_name + model fallback)
      const targets = await prisma.tb_output_target.findMany({
        where: {
          date: {
            gte: targetDate,
            lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)
          }
        },
        select: {
          machine_name: true,
          model_name: true,
          process_name: true,
        }
      });

      const targetMap = {};
      for (const t of targets) {
        if (!targetMap[t.machine_name]) targetMap[t.machine_name] = t; // ใช้ row แรก ไม่ overwrite
      }

      // 2b. Layer 2: ดึง model จาก tb_output_actual (Cron เขียนทุก 1 ชม.)
      const actualModelRows = await prisma.tb_output_actual.findMany({
        where: { date: { gte: targetDate, lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000) } },
        select: { machine_name: true, model_name: true }
      });
      const actualModelMap = {};
      for (const r of actualModelRows) {
        if (r.model_name && r.model_name !== "--") {
            if (!actualModelMap[r.machine_name]) {
                actualModelMap[r.machine_name] = [];
            }
            if (!actualModelMap[r.machine_name].includes(r.model_name)) {
                actualModelMap[r.machine_name].push(r.model_name);
            }
        }
      }
      for (const [mn, models] of Object.entries(actualModelMap)) {
          actualModelMap[mn] = models.join(", ");
      }

      // 2c. Layer 1: ดึง model ล่าสุดจาก InfluxDB (Actual production, วันนี้เท่านั้น)
      let influxModelMap = {};
      if (isToday) {
        try {
          const shiftStart = new Date(targetDate); // 00:00 UTC = 07:00 TH
          const nowForModel = new Date();
          influxModelMap = await influxService.queryAllMachinesModelsForHour(shiftStart, nowForModel);
        } catch (influxModelErr) {
          console.error("⚠️ getMachinesWithTodayData: InfluxDB model query failed (non-critical):", influxModelErr.message);
        }
      }

      // Build modelMap: Layer 1 (InfluxDB) → Layer 2 (actual) → Layer 3 (target)
      const modelMap = {};
      for (const m of machines) {
        const mn = m.machine_name;
        modelMap[mn] = influxModelMap[mn]        // Layer 1: InfluxDB actual (ล่าสุด)
          || actualModelMap[mn]                  // Layer 2: tb_output_actual
          || targetMap[mn]?.model_name           // Layer 3: tb_output_target
          || "--";
      }

      // 3. ดึง actual data — ใช้ cache ถ้าดูวันนี้
      let outputMap = {};
      let availMap = {};
      let cycleMap = {};

      // ✅ Fix: Cache อยู่ใน Worker Thread เท่านั้น (Worker Threads ไม่ share memory)
      // Main Thread ที่รัน API จะมี cache ว่างเสมอ → ต้อง fallback MSSQL
      let useCache = false;
      if (isToday) {
        const allCache = cacheService.getAllMachinesCache();
        if (Object.keys(allCache).length > 0) {
          // Cache มีข้อมูล → ใช้ cache (0 MSSQL queries)
          useCache = true;
          for (const [mn, data] of Object.entries(allCache)) {
            outputMap[mn] = data.overall.totalOutput || 0;
            // ❌ ไม่เอา efficiency จาก cache แล้ว
            cycleMap[mn] = data.overall.avgCycleTime || 0;
          }
        }
      }

      if (!useCache) {
        // Cache ว่าง (Main Thread) หรือดูวันอดีต → query MSSQL
        const [outputs, cycleTimes] = await Promise.all([
          prisma.tb_output_actual.findMany({
            where: { date: { gte: targetDate, lt: new Date(targetDate.getTime() + 86400000) } }
          }),
          prisma.tb_cycle_time_actual.findMany({
            where: { date: { gte: targetDate, lt: new Date(targetDate.getTime() + 86400000) } },
            select: { machine_name: true, cycle_time: true }
          }),
        ]);

        const rowsByMachineDate = groupActualRowsByMachineAndDate(
          outputs,
          (date) => date.toISOString().split("T")[0]
        );
        for (const [machineName, rowsByDate] of Object.entries(rowsByMachineDate)) {
          const rows = rowsByDate[dateISO] || [];
          const actualByHour = sumActualByHour(rows, SHIFT_HOURS);
          outputMap[machineName] = SHIFT_HOURS.reduce((sum, h) => sum + (actualByHour[`actual_${h}`] || 0), 0);
        }
        for (const c of cycleTimes) { cycleMap[c.machine_name] = c.cycle_time; }

        // ✅ Fix: เสริม current hour จาก InfluxDB (กรณีเครื่องหยุดกลางชั่วโมง)
        // MSSQL มีแค่ชั่วโมงที่จบแล้ว → current hour อยู่ใน InfluxDB
        if (isToday) {
          try {
            const now = new Date();
            const { start, thColumn } = getCurrentHourBoundaries(now);
            const influxData = await influxService.queryAllMachinesForHour(start, now);
            for (const [mn, data] of Object.entries(influxData)) {
              const currentHourOutput = data.output_count || 0;
              if (currentHourOutput > 0) {
                const rows = rowsByMachineDate[mn]?.[dateISO] || [];
                const actualByHour = sumActualByHour(rows, SHIFT_HOURS);
                const totalWithoutCurrentHour = SHIFT_HOURS
                  .filter((h) => h !== thColumn)
                  .reduce((sum, h) => sum + (actualByHour[`actual_${h}`] || 0), 0);
                outputMap[mn] = totalWithoutCurrentHour + currentHourOutput;
              }
            }
          } catch (influxErr) {
            console.error("⚠️ InfluxDB current hour query failed (non-critical):", influxErr.message);
          }
        }
      }

      // 🆕 [Phase 9] ดึง Availability จาก tb_oee เสมอ เพราะ cache ไม่ได้เก็บ Availability สรุปรายวัน
      const dailyOees = await prisma.tb_oee.findMany({
        where: { date: { gte: targetDate, lt: new Date(targetDate.getTime() + 86400000) } },
        select: { machine_name: true, availability: true }
      });
      for (const e of dailyOees) { availMap[e.machine_name] = e.availability; }

      // 4. สร้าง result
      const result = machines.map(m => ({
        id: m.id,
        area: m.machine_area,
        type: m.machine_type,
        name: m.machine_name,
        model: modelMap[m.machine_name] || "--",
        process: targetMap[m.machine_name]?.process_name || "--",
        output: outputMap[m.machine_name] ?? "--",
        availability: availMap[m.machine_name] ?? "--",
        cycleTime: cycleMap[m.machine_name] ?? "--",
      }));

      res.json({
        date: dateISO,
        results: result
      });

    } catch (e) {
      console.error("❌ getMachinesWithTodayData error:", e);
      res.status(500).json({ message: e.message });
    }
  },
};

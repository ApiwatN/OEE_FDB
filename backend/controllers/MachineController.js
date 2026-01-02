const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

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
  // 4) รายชื่อเครื่องใน Area + Type
  // =============================================================
  listMachines: async (req, res) => {
    try {
      const area = req.params.area?.trim();
      const type = req.params.type?.trim();

      if (!area || !type)
        return res.status(400).json({ message: "กรุณาระบุ area และ type" });

      const machines = await prisma.tbm_machine.findMany({
        where: {
          machine_area: area,
          machine_type: type,
          status: "active",
        },
        select: {
          id: true,
          machine_name: true,
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
      const now = new Date();
      const targetDate = dateParam
        ? new Date(dateParam)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      const dateISO = targetDate.toISOString().slice(0, 10);

      // 1. ดึง machines ทั้งหมดที่ active
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

      // 2. ดึง target ของวันนี้
      const targets = await prisma.tb_output_target.findMany({
        where: {
          date: {
            gte: new Date(dateISO),
            lt: new Date(new Date(dateISO).getTime() + 24 * 60 * 60 * 1000)
          }
        },
        select: {
          machine_name: true,
          model_name: true,
          process_name: true,
        }
      });

      // 3. ดึง output actual ของวันนี้
      const outputs = await prisma.tb_output_actual.findMany({
        where: {
          date: {
            gte: new Date(dateISO),
            lt: new Date(new Date(dateISO).getTime() + 24 * 60 * 60 * 1000)
          }
        }
      });

      // 4. ดึง efficiency ของวันนี้
      const efficiencies = await prisma.tb_efficiency_actual.findMany({
        where: {
          date: {
            gte: new Date(dateISO),
            lt: new Date(new Date(dateISO).getTime() + 24 * 60 * 60 * 1000)
          }
        },
        select: {
          machine_name: true,
          eff_actual: true,
        }
      });

      // 5. ดึง cycle time ของวันนี้
      const cycleTimes = await prisma.tb_cycle_time_actual.findMany({
        where: {
          date: {
            gte: new Date(dateISO),
            lt: new Date(new Date(dateISO).getTime() + 24 * 60 * 60 * 1000)
          }
        },
        select: {
          machine_name: true,
          cycle_time: true,
        }
      });

      // 6. Map ข้อมูลเข้าด้วยกัน
      const targetMap = {};
      for (const t of targets) {
        targetMap[t.machine_name] = t;
      }

      const outputMap = {};
      for (const o of outputs) {
        // รวม actual ทั้งหมด
        const totalOutput = (o.actual_07 || 0) + (o.actual_08 || 0) + (o.actual_09 || 0) +
          (o.actual_10 || 0) + (o.actual_11 || 0) + (o.actual_12 || 0) +
          (o.actual_13 || 0) + (o.actual_14 || 0) + (o.actual_15 || 0) +
          (o.actual_16 || 0) + (o.actual_17 || 0) + (o.actual_18 || 0) +
          (o.actual_19 || 0) + (o.actual_20 || 0) + (o.actual_21 || 0) +
          (o.actual_22 || 0) + (o.actual_23 || 0) + (o.actual_00 || 0) +
          (o.actual_01 || 0) + (o.actual_02 || 0) + (o.actual_03 || 0) +
          (o.actual_04 || 0) + (o.actual_05 || 0) + (o.actual_06 || 0);
        outputMap[o.machine_name] = totalOutput;
      }

      const effMap = {};
      for (const e of efficiencies) {
        effMap[e.machine_name] = e.eff_actual;
      }

      const cycleMap = {};
      for (const c of cycleTimes) {
        cycleMap[c.machine_name] = c.cycle_time;
      }

      // 7. สร้าง result
      const result = machines.map(m => ({
        id: m.id,
        area: m.machine_area,
        type: m.machine_type,
        name: m.machine_name,
        model: targetMap[m.machine_name]?.model_name || "--",
        process: targetMap[m.machine_name]?.process_name || "--",
        output: outputMap[m.machine_name] ?? "--",
        efficiency: effMap[m.machine_name] ?? "--",
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

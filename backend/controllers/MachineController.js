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
};

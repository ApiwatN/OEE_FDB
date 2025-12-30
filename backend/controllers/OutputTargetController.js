const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = {

  // 🟢 CREATE: สร้างแผนแบบช่วงเวลา (ใช้ Transaction Delete+Create เพื่อแก้ปัญหา Upsert)
  createOutputTargetRange: async (req, res) => {
    try {
      const {
        start_date, end_date, machine_name, model_name,
        model_type, process_name, // ✅ รับค่าเพิ่ม
        pc_target, cycle_time_target, eff_target, hours
      } = req.body;

      if (!start_date || !end_date || !machine_name)
        return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });

      const start = new Date(start_date);
      const end = new Date(end_date);

      // สร้าง list วันที่
      const dates = [];
      let d = new Date(start);
      while (d <= end) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }

      const baseData = {
        machine_name,
        model_name: model_name || "",
        model_type: model_type || null,   // ✅ บันทึก
        process_name: process_name || null, // ✅ บันทึก
        pc_target: Number(pc_target),
        cycle_time_target: Number(cycle_time_target),
        eff_target: Number(eff_target),
        ...hours,
      };

      // ✅ ใช้ Transaction: ลบของเก่าในวันนั้นๆ ของเครื่องนั้นๆ แล้วสร้างใหม่
      // วิธีนี้แก้ปัญหา Prisma Error และมั่นใจว่าข้อมูลไม่ซ้ำซ้อน
      await prisma.$transaction(async (tx) => {
        for (const dt of dates) {
          // 1. ลบแผนเก่าของเครื่องนี้ ในวันนี้ (ถ้ามี)
          await tx.tb_output_target.deleteMany({
            where: {
              date: dt,
              machine_name: machine_name
            }
          });

          // 2. สร้างใหม่
          await tx.tb_output_target.create({
            data: {
              date: dt,
              ...baseData
            }
          });
        }
      });

      res.json({ success: true, message: "บันทึกแผนสำเร็จ" });

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Create Error", error: err.message });
    }
  },

  // 🟡 UPDATE: อัปเดตช่วงเวลา (ใช้ Logic เดียวกับ Create เพื่อความชัวร์)
  updateOutputTargetRange: async (req, res) => {
    try {
      const {
        start_date, end_date, machine_name, model_name,
        model_type, process_name, // ✅ รับค่าเพิ่ม
        pc_target, cycle_time_target, eff_target, hours
      } = req.body;

      if (!start_date || !end_date || !machine_name)
        return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });

      const start = new Date(start_date);
      const end = new Date(end_date);

      const dates = [];
      let d = new Date(start);
      while (d <= end) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }

      const updateData = {
        machine_name,
        model_name,
        model_type,   // ✅ บันทึก
        process_name, // ✅ บันทึก
        pc_target: Number(pc_target),
        cycle_time_target: Number(cycle_time_target),
        eff_target: Number(eff_target),
        ...hours
      };

      // ✅ ใช้ Transaction
      await prisma.$transaction(async (tx) => {
        for (const dt of dates) {
          // 1. ลบเฉพาะของ Machine นี้ ในวันที่กำหนด
          await tx.tb_output_target.deleteMany({
            where: {
              date: dt,
              machine_name: machine_name,
              // model_name: model_name // เอาออก เพื่อให้แก้ทับได้เลยไม่ว่าเดิมจะเป็น Model อะไร
            },
          });

          // 2. สร้างใหม่
          await tx.tb_output_target.create({
            data: {
              date: dt,
              ...updateData
            }
          });
        }
      });

      res.json({ success: true, message: "อัปเดตช่วงเวลาสำเร็จ" });

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Update Error", error: err.message });
    }
  },

  // 🆕 NEW: หา Date สุดท้ายที่มีแผนของเครื่องจักรนั้น (เพื่อนำไปใส่ Default EndDate ตอน Edit)
  getLastTargetDate: async (req, res) => {
    try {
      const { machine_name } = req.query;
      if (!machine_name) return res.status(400).json({ message: "No machine name" });

      const lastRecord = await prisma.tb_output_target.findFirst({
        where: { machine_name: machine_name },
        orderBy: { date: "desc" },
        select: { date: true },
      });

      res.json({
        lastDate: lastRecord ? lastRecord.date : null
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Error fetching last date" });
    }
  },

  // ============================================================
  // 🔴 DELETE — ลบแผนรายวัน
  // ============================================================
  deleteOutputTarget: async (req, res) => {
    try {
      const { date, machine_name } = req.body;

      if (!date || !machine_name)
        return res.status(400).json({ message: "ต้องมี date และ machine_name" });

      const targetDate = new Date(date);

      await prisma.tb_output_target.deleteMany({
        where: {
          date: targetDate,
          machine_name: machine_name,
        }
      });

      res.json({ success: true, message: "ลบแผนสำเร็จ" });

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Delete Error", error: err.message });
    }
  },

  // ... getOutputTarget (เก็บไว้เหมือนเดิม)
  getOutputTarget: async (req, res) => {
    try {
      const { area, type, machine } = req.params;
      // ปรับให้รองรับ parameter แบบ path หรือ query แล้วแต่ setup เดิมของคุณ
      // แต่ใน frontend เรียก: /api/outputTarget/getOutputTarget/${area}/${type}/${machine}

      // Construct Where Clause
      const whereClause = {};
      if (machine !== "all") whereClause.machine_name = machine;
      // ถ้าต้องการ filter area/type ต้อง join กับ table machine 
      // แต่ถ้า frontend ส่ง machine_name มาแล้ว ก็ query ตรงๆได้เลย หรือถ้าจะเอาทั้งหมด

      // เนื่องจาก Prisma findMany โดย default จะดึงมาหมด
      // เราควร limit หรือ filter date ช่วงใกล้ๆ (เช่น +- 1 เดือน) เพื่อไม่ให้โหลดหนักเกินไป
      // แต่ถ้าต้องการทั้งหมดตาม Code เก่า:

      const results = await prisma.tb_output_target.findMany({
        where: whereClause,
        orderBy: { date: 'asc' }
      });

      // ... (Logic การรวม Model เหมือน Code เดิมใน frontend หรือจะส่งดิบไปก็ได้)
      // เพื่อให้ตรงกับ Frontend ที่เขียนใหม่ ผมแนะนำให้ส่ง model ออกไปตรงๆ

      // แต่ Frontend เดิมมีการ Group Model -> ดังนั้นต้อง map ให้ตรงโครงสร้าง
      // เพื่อความง่าย ผมจะส่ง output แบบที่ Frontend ปัจจุบัน process ได้ง่ายที่สุด

      // ตัวอย่างการจัดโครงสร้างให้ตรงกับที่ Frontend (allRows) คาดหวัง
      // (ต้องมีการ Join กับ Machine Table เพื่อเอา Area/Type ถ้าจำเป็น)

      // สมมติส่งกลับไปแบบ Raw และให้ Frontend Group เอง หรือทำตามโครงสร้างเดิม:
      const formatted = results.map(row => ({
        date: row.date.toISOString().split('T')[0],
        machine_name: row.machine_name,
        models: [{
          id: row.id,
          model_name: row.model_name,
          pc_target: row.pc_target,
          cycle_time_target: row.cycle_time_target,
          eff_target: row.eff_target,
          hourly_targets: row // ส่ง row ทั้งหมดที่มี target_xx ไป
        }]
      }));

      res.json({ results: formatted });

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Get Error" });
    }
  },
  // 📋 LIST: ดึงข้อมูลลงตาราง (Server-side Pagination)
  listOutputTarget: async (req, res) => {
    try {
      const { area, type, machine_name } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // 1. ดึงข้อมูลเครื่องจักรทั้งหมดมาก่อน เพื่อทำ Map (MachineName -> {Area, Type})
      const allMachines = await prisma.tbm_machine.findMany({
        select: { machine_name: true, machine_area: true, machine_type: true }
      });

      const machineInfoMap = new Map();
      allMachines.forEach(m => {
        machineInfoMap.set(m.machine_name, { area: m.machine_area, type: m.machine_type });
      });

      // 2. Filter เครื่องจักรที่จะค้นหา
      const machineFilter = { status: "active" };
      if (area && area !== "all") machineFilter.machine_area = area;
      if (type && type !== "all") machineFilter.machine_type = type;
      if (machine_name && machine_name !== "all") machineFilter.machine_name = machine_name;

      const validMachines = await prisma.tbm_machine.findMany({
        where: machineFilter,
        select: { machine_name: true },
      });
      const validMachineNames = validMachines.map((m) => m.machine_name);

      if (validMachineNames.length === 0) return res.json({ results: [], total: 0, page, limit });

      // 3. Count Total Records (สำหรับ Pagination)
      const totalRecords = await prisma.tb_output_target.count({
        where: { machine_name: { in: validMachineNames } }
      });

      // 4. Query Target (With Pagination)
      const targets = await prisma.tb_output_target.findMany({
        where: { machine_name: { in: validMachineNames } },
        orderBy: { date: "desc" },
        skip: skip,
        take: limit,
      });

      // 5. Group Data (Logic เดิม แต่ทำกับข้อมูลที่ตัดมาแล้ว)
      const grouped = [];
      const map = new Map();

      targets.forEach(t => {
        const key = `${t.date.toISOString()}_${t.machine_name}`;
        const mInfo = machineInfoMap.get(t.machine_name) || { area: '', type: '' };

        if (!map.has(key)) {
          map.set(key, {
            date: t.date.toISOString().split('T')[0],
            machine_name: t.machine_name,
            area: mInfo.area,
            type: mInfo.type,
            models: []
          });
          grouped.push(map.get(key));
        }
        const entry = map.get(key);
        entry.models.push({
          id: t.id,
          model_name: t.model_name,
          model_type: t.model_type,
          process_name: t.process_name,
          pc_target: t.pc_target,
          cycle_time_target: t.cycle_time_target,
          eff_target: t.eff_target,
          hourly_targets: {
            target_07: t.target_07, target_08: t.target_08, target_09: t.target_09,
            target_10: t.target_10, target_11: t.target_11, target_12: t.target_12,
            target_13: t.target_13, target_14: t.target_14, target_15: t.target_15,
            target_16: t.target_16, target_17: t.target_17, target_18: t.target_18,
            target_19: t.target_19, target_20: t.target_20, target_21: t.target_21,
            target_22: t.target_22, target_23: t.target_23, target_00: t.target_00,
            target_01: t.target_01, target_02: t.target_02, target_03: t.target_03,
            target_04: t.target_04, target_05: t.target_05, target_06: t.target_06,
          }
        });
      });

      res.json({ results: grouped, total: totalRecords, page, limit });

    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Error listing output targets" });
    }
  },
};
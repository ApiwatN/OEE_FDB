require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// 🏠 Socket.IO Room Management
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Client สามารถ join room ของเครื่องจักรที่สนใจ
  socket.on("joinRoom", (roomName) => {
    socket.join(roomName);
    console.log(`🏠 ${socket.id} joined room: ${roomName}`);
  });

  // Client ออกจาก room เมื่อเปลี่ยนหน้า
  socket.on("leaveRoom", (roomName) => {
    socket.leave(roomName);
    console.log(`🚪 ${socket.id} left room: ${roomName}`);
  });

  socket.on("disconnect", () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// 🟢 Attach IO to App for use in Controllers
app.set("io", io);
const cors = require("cors");
const fileUpload = require("express-fileupload");
const bodyParser = require("body-parser");
const port = process.env.PORT || 5005;

// 🆕 Services
const { initClient } = require("./services/influxService");
const { hydrateFromMSSQL } = require("./services/cacheService");
const { startCronJobs, backfillStartup, upsertOeeHourly, backfillOeeStartup } = require("./services/cronService");
const { startRealtimePolling } = require("./services/realtimeService");

// 1️⃣ ต้อง parse JSON ก่อน (สำคัญสุด)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2️⃣ เปิด CORS ก่อน routes
app.use(cors());

// 3️⃣ (ถ้าอยากใช้ body-parser เสริมก็ใส่ได้หลัง express.json)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 4️⃣ fileUpload ต้องมาทีหลังสุดเสมอ
app.use(fileUpload());

// 5️⃣ Static files
app.use("/image", express.static("image"));

// ✅ Serve Static Frontend
const path = require("path");
app.use(express.static(path.join(__dirname, "../fontend/out"), { extensions: ["html"] }));

// ✅ Controllers//
const oeeDashboardController = require("./controllers/OeeDashboardController");
const modelController = require("./controllers/ModelController");
const outputTargetController = require("./controllers/OutputTargetController");
const historyWorkingController = require("./controllers/HistoryWorkingController");
const machineController = require("./controllers/MachineController");
const reportController = require("./controllers/ReportController"); // 🆕
const mcStatusController = require("./controllers/MCStatusController"); // 🆕 Machine Status
const planConfigController = require("./controllers/PlanConfigController"); // 🆕 Plan Config
const holidayController = require("./controllers/HolidayController"); // 🆕 Holidays
const oeeUpdateController = require("./controllers/OeeUpdateController"); // 🆕 OEE Update

// =========================================
// 📦 OEE DASHBOARD ROUTES
// =========================================
app.get("/api/oee/getPicture/:emp_no", oeeDashboardController.getOperatorPicture);
app.get("/api/oee/getLastOEE", oeeDashboardController.getLastOEEByMachine);
app.get("/api/oee/getDataTable", oeeDashboardController.getDataTable);
app.get("/api/oee/getGraph1", oeeDashboardController.getActualGraph1);
app.get("/api/oee/getGraph2", oeeDashboardController.getActualGraph2);
app.get("/api/oee/getModelsByDate", oeeDashboardController.getModelsByDate);
// =========================================
// 🧩 MODEL ROUTES
// =========================================
app.get("/api/model/listModel", modelController.listModel);
app.get("/api/model/listModelType", modelController.listModelType); // ✅ Add Route

// =========================================
// 📦 OUTPUT TARGET ROUTES
// =========================================
app.post("/api/outputTarget/createOutputTargetRange", outputTargetController.createOutputTargetRange);
app.put("/api/outputTarget/updateOutputTargetRange", outputTargetController.updateOutputTargetRange);
app.delete("/api/outputTarget/deleteOutputTarget", outputTargetController.deleteOutputTarget);
app.get("/api/outputTarget/getOutputTarget", outputTargetController.getOutputTarget)
app.get("/api/outputTarget/getLastTargetDate", outputTargetController.getLastTargetDate);
app.get("/api/outputTarget/listOutputTarget/:area/:type/:machine_name", outputTargetController.listOutputTarget);

// =========================================
// 🆕 PLAN CONFIG ROUTES
// =========================================
app.get("/api/planConfig/get/:machine_name", planConfigController.getConfig);
app.post("/api/planConfig/upsert", planConfigController.upsertConfig);
app.get("/api/planConfig/list", planConfigController.listConfigs);
app.post("/api/planConfig/generatePlan", planConfigController.generatePlan);
app.post("/api/planConfig/updateDayShift", planConfigController.updateDayShift);
app.post("/api/planConfig/updateDayHours", planConfigController.updateDayHours);
app.post("/api/planConfig/updateDayEffCt", planConfigController.updateDayEffCt);

// =========================================
// 🆕 HOLIDAY ROUTES
// =========================================
app.get("/api/holiday/list/:machine_name", holidayController.listHolidays);
app.post("/api/holiday/toggle", holidayController.toggleHoliday);
app.post("/api/holiday/copy", holidayController.copyHolidays);

// =========================================
// 🆕 OEE UPDATE ROUTES
// =========================================
app.get("/api/oee-update/list", oeeUpdateController.list);
app.post("/api/oee-update/set-mode", oeeUpdateController.setMode);
app.post("/api/oee-update/manual-ng", oeeUpdateController.manualNg);
app.post("/api/oee-update/manual-ng-batch", oeeUpdateController.manualNgBatch);
app.post("/api/oee-update/manual-ng-multi-machine", oeeUpdateController.manualNgMultiMachine);
app.get("/api/oee-update/history/:machine", oeeUpdateController.history);
app.get("/api/oee-update/auto-ng/:machine", oeeUpdateController.autoNg);
// =========================================
// 🧍 History Working Routes
// =========================================
app.get("/api/historyWorking/getOperatorIdWorking/:machine_name", historyWorkingController.getOperatorIdWorking);
app.get("/api/historyWorking/getHistoryByDate", historyWorkingController.getHistoryByDate); // ✅ Add Route
app.get("/api/historyWorking/getActiveCrossDayOperator", historyWorkingController.getActiveCrossDayOperator); // ✅ Cross-Day Operator
app.post("/api/historyWorking/createStartTime", historyWorkingController.createStartTime);
app.put("/api/historyWorking/updateEndTime/:id", historyWorkingController.updateEndTime);

// =========================================
// 🛠️ ROUTES — MachineController
// =========================================
app.get("/api/machine/listArea", machineController.listArea);
app.get("/api/machine/listType/:area", machineController.listType);
app.get("/api/machine/listMachines/:area/:type", machineController.listMachines);
app.get("/api/machine/listTypeWithMachines/:area", machineController.listTypeWithMachines);
app.get("/api/machine/listProcess/:machine_type", machineController.listProcess);
app.get("/api/machine/listAllMachinesByArea", machineController.listAllMachinesByArea); // 🆕 Layout Dashboard
app.get("/api/machine/getMachinesWithTodayData", machineController.getMachinesWithTodayData); // 🆕 Layout Dashboard Cards

// ... REPORT ROUTES
app.get("/api/report/machine-report", reportController.getMachineReport); // 🆕 // ✅ Add Route

// =========================================
// 📊 MC STATUS ROUTES
// =========================================
app.get("/api/mcstatus/timeline", mcStatusController.getTimeline); // 🆕 Machine Status Timeline
app.get("/api/mcstatus/latest-all", mcStatusController.getLatestAll); // 🆕 Latest status for all machines

// 🆕 SERVER TIME ENDPOINT
app.get("/api/oee/getServerTime", (req, res) => {
  res.json({ serverTimeUTC: new Date().toISOString() });
});

// ✅ Catch-All Route for SPA (must be last)
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, "../fontend/out/index.html"));
});

// ✅ ASYNC STARTUP SEQUENCE
async function startup() {
  try {
    // 1. Initialize InfluxDB client
    initClient();

    // 2. Hydrate cache from MSSQL
    await hydrateFromMSSQL();

    // 2.1 Backfill missing data for current shift
    await backfillStartup();

    // 2.2 OEE: upsert availability + performance to tb_oee immediately
    await upsertOeeHourly();

    // 2.3 OEE Backfill: recalc availability + performance for past 5 days
    await backfillOeeStartup();

    // 3. Start cron jobs
    startCronJobs();

    // 4. Start real-time polling + Socket.IO
    startRealtimePolling(io);

    // 5. Listen
    server.listen(port, () => {
      console.log("🚀 API server running at port", port);
    });
  } catch (err) {
    console.error("❌ Startup failed:", err);
    // Still start server even if services fail
    server.listen(port, () => {
      console.log("⚠️ API server running at port", port, "(some services failed)");
    });
  }
}

startup();
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

// 🟢 Attach IO to App for use in Controllers
app.set("io", io);
const cors = require("cors");
const fileUpload = require("express-fileupload");
const bodyParser = require("body-parser");
const port = 5001;

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

// ✅ Controllers//
const oeeDashboardController = require("./controllers/OeeDashboardController");
const modelController = require("./controllers/ModelController");
const outputTargetController = require("./controllers/OutputTargetController");
const historyWorkingController = require("./controllers/HistoryWorkingController");
const machineController = require("./controllers/MachineController");
const reportController = require("./controllers/ReportController"); // 🆕

// =========================================
// 📦 OEE DASHBOARD ROUTES
// =========================================
app.get("/api/oee/getPicture/:emp_no", oeeDashboardController.getOperatorPicture);
app.get("/api/oee/getLastOEE", oeeDashboardController.getLastOEEByMachine);
app.get("/api/oee/getDataTable", oeeDashboardController.getDataTable);
app.get("/api/oee/getGraph1", oeeDashboardController.getActualGraph1);
app.get("/api/oee/getGraph2", oeeDashboardController.getActualGraph2);
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
// 🧍 History Working Routes
// =========================================
app.get("/api/historyWorking/getOperatorIdWorking/:machine_name", historyWorkingController.getOperatorIdWorking);
app.get("/api/historyWorking/getHistoryByDate", historyWorkingController.getHistoryByDate); // ✅ Add Route
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

// ... REPORT ROUTES
app.get("/api/report/machine-report", reportController.getMachineReport); // 🆕 // ✅ Add Route


// ✅ SERVER START
server.listen(port, () => {
  console.log("🚀 API server running at port", port);
});
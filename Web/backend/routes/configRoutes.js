const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");

/**
 * GET /api/config/machine-status
 * Returns the machine_status.json config for the frontend
 */
router.get("/machine-status", (req, res) => {
    try {
        const configPath = path.join(__dirname, "../config/machine_status.json");
        const raw = fs.readFileSync(configPath, "utf8");
        const config = JSON.parse(raw);
        return res.json({ success: true, data: config });
    } catch (e) {
        console.error("⚠️ [Config] Failed to load machine_status.json:", e.message);
        return res.status(500).json({ success: false, message: "Failed to load config" });
    }
});

module.exports = router;

/**
 * API Cache Middleware — In-memory cache สำหรับ Express routes
 * ใช้ลดภาระ Database เมื่อ Frontend ยิง request ซ้ำถี่ๆ
 * 
 * Usage:
 *   const { apiCache } = require("./middleware/apiCacheMiddleware");
 *   app.get("/api/oee/getDataTable", apiCache(5), controller.getDataTable);
 *   // → cache response ไว้ 5 วินาที (key = URL + query string)
 */

const cache = new Map();

/**
 * สร้าง middleware สำหรับ cache API response
 * @param {number} ttlSeconds - เวลาที่ cache จะมีอายุ (วินาที) default = 5
 * @returns {Function} Express middleware
 */
function apiCache(ttlSeconds = 5) {
    const ttlMs = ttlSeconds * 1000;

    return (req, res, next) => {
        // Cache key = full URL (path + query string)
        const key = req.originalUrl || req.url;
        const now = Date.now();

        // ตรวจ cache
        const cached = cache.get(key);
        if (cached && (now - cached.timestamp) < ttlMs) {
            // ✅ Cache hit → ส่งกลับทันที ไม่แตะ DB
            return res.status(cached.statusCode).json(cached.data);
        }

        // ❌ Cache miss → ดักจับ res.json เพื่อเก็บ response ไว้ใน cache
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            // เก็บ cache เฉพาะ response ที่สำเร็จ (status 2xx)
            if (res.statusCode >= 200 && res.statusCode < 300) {
                cache.set(key, {
                    data,
                    statusCode: res.statusCode,
                    timestamp: Date.now(),
                });
            }
            return originalJson(data);
        };

        next();
    };
}

// ── Auto-cleanup: ลบ entry ที่หมดอายุทุก 60 วินาที ──
setInterval(() => {
    const now = Date.now();
    const maxAge = 60 * 1000; // ลบทุก entry ที่อายุเกิน 60 วินาที
    for (const [key, value] of cache) {
        if (now - value.timestamp > maxAge) {
            cache.delete(key);
        }
    }
}, 60 * 1000);

module.exports = { apiCache };

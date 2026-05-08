/**
 * memoryOeeService.js
 * ─────────────────────────────────────────────────────
 * In-Memory OEE Stopwatch — ไม่ Query MSSQL ทุก 2 วินาที
 *
 * ระบบนี้เก็บ "ถังสะสมวินาที" ของแต่ละเครื่องไว้ใน RAM
 * แทนการวิ่งดึง tb_MCStatus จาก Database ทุกๆ รอบ
 *
 * API:
 *   processStatusChange(machine, status, datetime) → เรียกจาก mqttService เมื่อรับ Status ใหม่
 *   getDurationsNow(machine, now)                  → เรียกจาก realtimeService ทุก 2 วิ
 *   setManualNg(machine, qty)                      → เรียกจาก OeeUpdateController เมื่อ Operator กรอก NG
 *   hydrateFromMssql(shiftDate)                    → เรียกจาก worker.js ตอน boot
 *   resetShift(machine)                            → เรียกเมื่อ shift วันใหม่เริ่ม
 */

const { EXCLUDED_STATUSES, RUNNING_STATUS, isExcludedStatus } = require('./oeeCalcService');

// ──────────────────────────────────────────────
// State Map: machineName → ShiftState
// ──────────────────────────────────────────────
const stateMap = new Map();

/**
 * ดึง state ของเครื่อง (สร้างใหม่ถ้ายังไม่มี)
 * @param {string} machine
 * @returns {object} state
 */
function getOrCreate(machine) {
    if (!stateMap.has(machine)) {
        stateMap.set(machine, createBlankState());
    }
    return stateMap.get(machine);
}

function createBlankState() {
    return {
        runTimeSec: 0,        // วินาทีที่ MCStatus = "Run_Time"
        excludedSec: 0,       // วินาทีที่ MCStatus อยู่ใน EXCLUDED_STATUSES
        lastStatus: null,     // สถานะล่าสุดที่รับมา
        lastStatusTime: null, // Date — เวลาที่รับสถานะล่าสุด
        shiftDate: null,      // "YYYY-MM-DD" — ใช้ตรวจ shift rollover
        manualNgQty: 0,       // Qty ของเสียที่ Operator กรอก (Manual mode)
    };
}

// ──────────────────────────────────────────────
// ฟังก์ชันหลัก
// ──────────────────────────────────────────────

/**
 * เรียกเมื่อ mqttService รับ Status ใหม่เข้ามา
 * จะ "ปิดตัวเลข" ของ segment เก่า แล้วเริ่มนับ segment ใหม่
 *
 * @param {string} machine     - ชื่อเครื่อง
 * @param {string} newStatus   - สถานะใหม่ เช่น "Run_Time", "Plan_Stop"
 * @param {Date}   datetime    - เวลาที่สถานะเปลี่ยน (Pure UTC)
 */
function processStatusChange(machine, newStatus, datetime) {
    try {
        const state = getOrCreate(machine);
        const eventTime = datetime instanceof Date ? datetime : new Date(datetime);

        // ตรวจ shift rollover (ถ้าวันใหม่มาถึงให้ reset)
        const eventShiftDate = getShiftDateFromThai(eventTime);
        if (state.shiftDate && state.shiftDate !== eventShiftDate) {
            // 1. จำสถานะข้ามวัน (Carry-over status)
            const carryOverStatus = state.lastStatus;
            
            // 2. รีเซ็ตถังข้อมูลทั้งหมด
            _resetState(state, eventShiftDate);
            
            // 3. นำสถานะข้ามวันกลับมาใส่ โดยให้เริ่มนับที่เวลา 00:00 UTC ของกะใหม่
            if (carryOverStatus) {
                state.lastStatus = carryOverStatus;
                state.lastStatusTime = getShiftStartFromDate(eventShiftDate);
            }
        }
        if (!state.shiftDate) {
            state.shiftDate = eventShiftDate;
        }

        // ถ้ามี segment ที่กำลังนับอยู่ → ปิดมันก่อน
        if (state.lastStatus !== null && state.lastStatusTime !== null) {
            const segDurationSec = Math.max(0, (eventTime - state.lastStatusTime) / 1000);
            _addToSegment(state, state.lastStatus, segDurationSec);
        }

        // เริ่ม segment ใหม่
        state.lastStatus = newStatus;
        state.lastStatusTime = eventTime;

        stateMap.set(machine, state);
    } catch (err) {
        console.error(`[memoryOeeService] processStatusChange error (${machine}):`, err.message);
    }
}

/**
 * เรียกจาก realtimeService ทุก 2 วินาที เพื่อคำนวณ Availability
 * ไม่ทำลาย state — แค่เอาวินาทีที่ยังกำลังเดินอยู่มาคำนวณรวม "เสมือน"
 *
 * @param {string} machine
 * @param {Date}   now      - เวลา Pure UTC ปัจจุบัน
 * @returns {{ runTimeSec: number, excludedSec: number, totalSec: number }}
 */
function getDurationsNow(machine, now) {
    const state = stateMap.get(machine);
    if (!state || state.lastStatus === null) {
        return { runTimeSec: 0, excludedSec: 0, totalSec: 0 };
    }

    const nowTime = now instanceof Date ? now : new Date(now);

    // คำนวณ segment ที่ยังเดินอยู่โดยไม่แตะ state
    let virtualRunSec = state.runTimeSec;
    let virtualExcludedSec = state.excludedSec;

    if (state.lastStatusTime !== null) {
        // 🆕 ใช้ nowTime (Pure UTC) ลบกับ lastStatusTime (Pure UTC) โดยตรง (Zero Deficit)
        const tickingSec = Math.max(0, (nowTime - state.lastStatusTime) / 1000);
        if (state.lastStatus === RUNNING_STATUS) {
            virtualRunSec += tickingSec;
        } else if (isExcludedStatus(state.lastStatus)) {
            virtualExcludedSec += tickingSec;
        }
    }

    // totalSec = เวลาตั้งแต่เริ่ม shift (Pure UTC 00:00:00Z)
    const shiftStartUtc = getShiftStartFromDate(state.shiftDate);
    const totalSec = Math.max(0, (nowTime - shiftStartUtc) / 1000);

    return {
        runTimeSec: virtualRunSec,
        excludedSec: virtualExcludedSec,
        totalSec,
    };
}

/**
 * Operator กรอก NG qty จากหน้าเว็บ → อัปเดต RAM ทันที
 * ทำให้ Quality% ในหน้า Dashboard เปลี่ยนภายใน 2 วินาที
 *
 * @param {string} machine
 * @param {number} qty
 */
function setManualNg(machine, qty) {
    const state = getOrCreate(machine);
    state.manualNgQty = qty || 0;
    stateMap.set(machine, state);
}

/**
 * ดึง manual NG qty จาก memory
 * @param {string} machine
 * @returns {number}
 */
function getManualNg(machine) {
    return stateMap.get(machine)?.manualNgQty || 0;
}

/**
 * Cold-Boot Recovery: อ่าน MCStatus ทั้งวันจาก MSSQL แล้ว replay ลง RAM
 * เรียกจาก worker.js ตอน startup — รับประกันว่า Stopwatch นิ่งหลัง reboot
 *
 * @param {string} shiftDate - "YYYY-MM-DD" (shift date ในรูป UTC)
 */
async function hydrateFromMssql(shiftDate) {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();

        // shift start = วันนั้น 07:00 Thai = 00:00 UTC
        const [year, month, day] = shiftDate.split('-').map(Number);
        const shiftStartUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0)); // 07:00 TH = 00:00 UTC
        const shiftStartThai = new Date(shiftStartUTC.getTime() + 7 * 60 * 60 * 1000); // 07:00 TH
        const nowThai = new Date(Date.now() + 7 * 60 * 60 * 1000);

        // ดึงประวัติ MCStatus ของวันนี้
        const records = await prisma.tb_MCStatus.findMany({
            where: {
                Datetime: { gte: shiftStartThai, lte: nowThai },
            },
            orderBy: { Datetime: 'asc' },
            select: { MC: true, MCStatus: true, Datetime: true },
        });

        // ดึง carryover (สถานะล่าสุดก่อนเริ่ม shift)
        const carryoverRows = await prisma.$queryRaw`
            SELECT MC, MCStatus, Datetime FROM (
                SELECT MC, MCStatus, Datetime,
                       ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn
                FROM tb_MCStatus WHERE Datetime < ${shiftStartThai}
            ) t WHERE rn = 1
        `;

        await prisma.$disconnect();

        // จัดกลุ่มตามเครื่อง
        const machinesWithTodayRecords = new Set(records.map(r => r.MC));
        const STALE_CARRYOVER_MS = 24 * 60 * 60 * 1000; // 24 hours

        const byMachine = {};
        for (const row of carryoverRows) {
            if (!byMachine[row.MC]) byMachine[row.MC] = [];
            // Stale Carryover Guard: ถ้า carry-over เก่าเกิน 24h และไม่มี record วันนี้
            // → ไม่ใส่ carryover เพื่อป้องกัน Plan_Stop เก่า monopolize excluded time
            const carryoverAgeMs = shiftStartThai - new Date(row.Datetime);
            if (!machinesWithTodayRecords.has(row.MC) && carryoverAgeMs > STALE_CARRYOVER_MS) {
                continue;
            }
            // ใส่ carryover เป็น record แรก โดยเริ่มนับจาก shiftStart
            byMachine[row.MC].push({ Datetime: shiftStartThai, MCStatus: row.MCStatus });
        }
        for (const rec of records) {
            if (!byMachine[rec.MC]) byMachine[rec.MC] = [];
            byMachine[rec.MC].push(rec);
        }

        // Replay ทุก record เข้า state
        let machineCount = 0;
        for (const [machine, recs] of Object.entries(byMachine)) {
            const state = createBlankState();
            state.shiftDate = shiftDate;

            for (let i = 0; i < recs.length; i++) {
                const rec = recs[i];
                const segStart = new Date(Math.max(rec.Datetime.getTime(), shiftStartThai.getTime()));
                const segEnd = i + 1 < recs.length
                    ? new Date(Math.min(recs[i + 1].Datetime.getTime(), nowThai.getTime()))
                    : nowThai;

                const durationSec = Math.max(0, (segEnd - segStart) / 1000);

                // บวกวินาทีลงถัง (ยกเว้น segment สุดท้ายที่ยังเดินอยู่)
                if (i + 1 < recs.length) {
                    _addToSegment(state, rec.MCStatus, durationSec);
                } else {
                    // segment สุดท้าย: เก็บไว้เป็น "กำลังเดินอยู่" (lastStatus/lastStatusTime)
                    state.lastStatus = rec.MCStatus;
                    // 🆕 Convert Fake UTC (from Prisma's Local Time) back to Pure UTC by subtracting 7 hours
                    state.lastStatusTime = new Date(segStart.getTime() - 7 * 60 * 60 * 1000);
                }
            }

            stateMap.set(machine, state);
            machineCount++;
        }

        console.log(`✅ [memoryOeeService] Hydrated ${machineCount} machines from MSSQL (shift: ${shiftDate})`);
    } catch (err) {
        console.error(`⚠️ [memoryOeeService] hydrateFromMssql failed:`, err.message);
    }
}

/**
 * รีเซ็ต state ของเครื่องเดียว (ใช้ตอน shift rollover)
 * @param {string} machine
 * @param {string} newShiftDate
 */
function resetShift(machine, newShiftDate) {
    const state = createBlankState();
    state.shiftDate = newShiftDate;
    stateMap.set(machine, state);
}

// ──────────────────────────────────────────────
// Internal Helpers
// ──────────────────────────────────────────────

function getStateMap() {
    return stateMap;
}

function restoreStateMap(snapshotObj) {
    stateMap.clear();
    for (const [key, value] of Object.entries(snapshotObj)) {
        if (value.lastStatusTime) value.lastStatusTime = new Date(value.lastStatusTime);
        stateMap.set(key, value);
    }
}

function _addToSegment(state, status, durationSec) {
    if (status === RUNNING_STATUS) {
        state.runTimeSec += durationSec;
    } else if (isExcludedStatus(status)) {
        state.excludedSec += durationSec;
    }
    // สถานะอื่น = downtime → ไม่บวกที่ไหน (แต่นับใน totalSec อยู่แล้ว)
}

function _resetState(state, newShiftDate) {
    state.runTimeSec = 0;
    state.excludedSec = 0;
    state.lastStatus = null;
    state.lastStatusTime = null;
    state.shiftDate = newShiftDate;
    state.manualNgQty = 0;
}

/**
 * แปลง Date (Thai Local) เป็น shiftDate string "YYYY-MM-DD"
 * Shift เริ่ม 07:00 → ถ้าเวลาก่อน 07:00 ให้ใช้วันก่อนหน้า
 */
function getShiftDateFromThai(thaiDate) {
    const h = thaiDate.getHours();
    const date = new Date(thaiDate);
    if (h < 7) date.setDate(date.getDate() - 1);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * สร้าง shift start time (00:00 UTC = 07:00 Thai Local) จาก shiftDate string
 * @param {string} shiftDate - "YYYY-MM-DD"
 * @returns {Date}
 */
function getShiftStartFromDate(shiftDate) {
    if (!shiftDate) return new Date(0);
    const [year, month, day] = shiftDate.split('-').map(Number);
    // Shift เริ่ม 07:00 Thai time -> 00:00 UTC
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

module.exports = {
    processStatusChange,
    getDurationsNow,
    setManualNg,
    getManualNg,
    getStateMap,
    restoreStateMap,
    hydrateFromMssql,
    resetShift,
};

/**
 * Time Utilities — UTC-based
 * ใช้ UTC เป็นหลักทั้งระบบ
 * Shift: 00:00 UTC (= 07:00 TH) ถึง 23:59 UTC (= 06:59 TH วันถัดไป)
 */

// ลำดับชั่วโมง shift (07:00 - 06:00 TH = 00:00 - 23:00 UTC mapped to TH columns)
const SHIFT_HOURS = [
    "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
    "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06",
];

/**
 * UTC hour → TH hour (column name)
 * UTC 0 → TH 7 → "07"
 * UTC 17 → TH 24 → 0 → "00"
 */
function utcHourToThColumn(utcHour) {
    const thHour = (utcHour + 7) % 24;
    return String(thHour).padStart(2, "0");
}

/**
 * TH column → UTC hour
 * "07" → UTC 0, "00" → UTC 17
 */
function thColumnToUtcHour(thCol) {
    const th = parseInt(thCol, 10);
    return (th - 7 + 24) % 24;
}

/**
 * Get shift date (YYYY-MM-DD) based on UTC time
 * Shift เริ่ม 00:00 UTC = 07:00 TH → shift date = UTC date
 */
function getShiftDateUTC(utcDate = new Date()) {
    return utcDate.toISOString().split("T")[0];
}

/**
 * Get field name for a specific UTC hour
 * e.g., prefix="actual", utcHour=0 → "actual_07"
 */
function getFieldName(prefix, utcHour) {
    const col = utcHourToThColumn(utcHour);
    return `${prefix}_${col}`;
}

/**
 * Get UTC hour boundaries for a given UTC hour
 * e.g., utcHour=5, date="2026-02-19" → { start: 2026-02-19T05:00:00Z, end: 2026-02-19T06:00:00Z }
 */
function getHourBoundariesUTC(dateStr, utcHour) {
    const start = new Date(`${dateStr}T${String(utcHour).padStart(2, "0")}:00:00.000Z`);
    const end = new Date(start.getTime() + 3600000); // +1 hour
    return { start, end };
}

/**
 * Get the previous hour's UTC boundaries
 */
function getPreviousHourBoundaries(now = new Date()) {
    const prevHour = new Date(now.getTime() - 3600000);
    const utcHour = prevHour.getUTCHours();
    const dateStr = prevHour.toISOString().split("T")[0];
    return {
        dateStr,
        utcHour,
        thColumn: utcHourToThColumn(utcHour),
        ...getHourBoundariesUTC(dateStr, utcHour),
    };
}

/**
 * Get current hour's UTC boundaries
 */
function getCurrentHourBoundaries(now = new Date()) {
    const utcHour = now.getUTCHours();
    const dateStr = now.toISOString().split("T")[0];
    return {
        dateStr,
        utcHour,
        thColumn: utcHourToThColumn(utcHour),
        ...getHourBoundariesUTC(dateStr, utcHour),
    };
}

/**
 * Get shift index (0-23) for a given TH column
 */
function getShiftIndex(thColumn) {
    return SHIFT_HOURS.indexOf(thColumn);
}

/**
 * Get elapsed seconds in the current hour
 */
function getElapsedSecondsInHour(now = new Date()) {
    return now.getUTCMinutes() * 60 + now.getUTCSeconds();
}

module.exports = {
    SHIFT_HOURS,
    utcHourToThColumn,
    thColumnToUtcHour,
    getShiftDateUTC,
    getFieldName,
    getHourBoundariesUTC,
    getPreviousHourBoundaries,
    getCurrentHourBoundaries,
    getShiftIndex,
    getElapsedSecondsInHour,
};

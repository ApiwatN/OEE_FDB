const { SHIFT_HOURS, getCurrentHourBoundaries } = require("../utils/timeUtils");

function buildPseudoActualRow(machineName, date, cachedData) {
    const row = { machine_name: machineName, date, model_name: "--" };
    for (const h of SHIFT_HOURS) {
        row[`actual_${h}`] = cachedData?.output?.[`actual_${h}`] || 0;
    }
    return row;
}

function sumActualByHour(rows, hours = SHIFT_HOURS) {
    const result = {};

    for (const h of hours) {
        const field = `actual_${h}`;
        const realTotal = rows
            .filter((row) => row.model_name !== "--" && (row[field] || 0) > 0)
            .reduce((sum, row) => sum + (row[field] || 0), 0);

        if (realTotal > 0) {
            result[field] = realTotal;
            continue;
        }

        result[field] = rows
            .filter((row) => row.model_name === "--")
            .reduce((sum, row) => sum + (row[field] || 0), 0);
    }

    return result;
}

function sumActualTotal(rows, hours = SHIFT_HOURS) {
    const hourly = sumActualByHour(rows, hours);
    return hours.reduce((sum, h) => sum + (hourly[`actual_${h}`] || 0), 0);
}

function groupActualRowsByMachineAndDate(rows, getDateKey) {
    const grouped = {};
    for (const row of rows) {
        const machineName = row.machine_name;
        const dateKey = getDateKey(row.date);
        if (!grouped[machineName]) grouped[machineName] = {};
        if (!grouped[machineName][dateKey]) grouped[machineName][dateKey] = [];
        grouped[machineName][dateKey].push(row);
    }
    return grouped;
}

function applyCurrentHourOverride(rows, machineName, date, thColumn, outputCount) {
    if (!outputCount || outputCount <= 0) return rows;

    const field = `actual_${thColumn}`;
    const nextRows = rows.length > 0 ? rows : [{ machine_name: machineName, date, model_name: "--" }];
    nextRows[0][field] = outputCount;
    return nextRows;
}

async function applyCurrentHourInfluxOverride(rows, {
    influxService,
    machineName,
    date,
    now = new Date(),
}) {
    const { start, thColumn } = getCurrentHourBoundaries(now);
    const influxData = await influxService.queryMachineForHour(machineName, start, now);
    return applyCurrentHourOverride(rows, machineName, date, thColumn, influxData?.output_count || 0);
}

function applyCurrentHourMapOverride(outputMap, influxData) {
    for (const [machineName, data] of Object.entries(influxData || {})) {
        const currentHourOutput = data.output_count || 0;
        if (currentHourOutput > 0) {
            outputMap[machineName] = (outputMap[machineName] || 0) + currentHourOutput;
        }
    }
    return outputMap;
}

module.exports = {
    buildPseudoActualRow,
    sumActualByHour,
    sumActualTotal,
    groupActualRowsByMachineAndDate,
    applyCurrentHourOverride,
    applyCurrentHourInfluxOverride,
    applyCurrentHourMapOverride,
};

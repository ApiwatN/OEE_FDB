const assert = require("node:assert/strict");

const {
    calcAutoOeeMetrics,
    calcManualNgMetrics,
    calcRejectSummary,
    sumHourlyFields,
} = require("../services/oeeCalcService");
const { sumActualByHour, sumActualTotal } = require("../services/actualOutputService");

const targetRow = {
    target_07: 10,
    target_08: 20,
    target_09: null,
};
assert.equal(sumHourlyFields(targetRow, "target", ["07", "08", "09"]), 30);

assert.deepEqual(calcRejectSummary(100, 12), {
    rejectQty: 12,
    totalOutput: 88,
    rejectPercent: 12,
});
assert.deepEqual(calcRejectSummary(0, 12), {
    rejectQty: 12,
    totalOutput: 0,
    rejectPercent: 0,
});

assert.deepEqual(calcManualNgMetrics(100, 5, 80, 90), {
    quality: 95,
    oeeValue: 68.4,
});
assert.deepEqual(calcManualNgMetrics(0, 5, 80, 90), {
    quality: 0,
    oeeValue: 0,
});

assert.deepEqual(
    calcAutoOeeMetrics({
        totalOutput: 100,
        ngQty: 10,
        availability: 80,
        idealCT: 2,
        runTimeSeconds: 200,
        ngMode: "visual_ng",
    }),
    {
        outputForOee: 100,
        performance: 100,
        quality: 90,
        oeeValue: 72,
    }
);

assert.deepEqual(
    calcAutoOeeMetrics({
        totalOutput: 100,
        ngQty: 10,
        availability: 80,
        idealCT: 2,
        runTimeSeconds: 200,
        ngMode: "over_reject",
    }),
    {
        outputForOee: 90,
        performance: 90,
        quality: 100,
        oeeValue: 72,
    }
);

const actualRows = [
    { model_name: "--", actual_07: 5, actual_08: 7 },
    { model_name: "MODEL-A", actual_07: 2, actual_08: 0 },
    { model_name: "MODEL-B", actual_07: 3, actual_08: 0 },
];
assert.deepEqual(sumActualByHour(actualRows, ["07", "08"]), {
    actual_07: 5,
    actual_08: 7,
});
assert.equal(sumActualTotal(actualRows, ["07", "08"]), 12);

console.log("oeeCalcService unit tests passed");

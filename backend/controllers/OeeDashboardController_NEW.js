// Helper function to use batch data (add before fetchAllData)
const useBatchData = () => {
    if (!preloadedData) return false;

    console.log(`[${machineName}] Using preloaded batch data`);

    // Set models
    const models = preloadedData.models.map((m: any) => m.model_name);
    setModelsList(models);
    setSelectedModel(models[0] || "");

    // Set table data
    const table = preloadedData.table || {};
    const achieve = table.pc_target > 0 ?
        Math.round((table.pc_actual / table.pc_target) * 100) :
        0;

    setTableData({
        model: table.model_name || "-",
        achieve: achieve,
        oee: preloadedData.oee?.oee_value || 0,
        pcTarget: table.pc_target || 0,
        pcActual: table.pc_actual || 0,
        cycleTarget: table.cycle_time_target || 0,
        cycleActual: table.cycle_time_actual || 0,
        effTarget: table.target_eff || 0,
        effActual: table.actual_eff || 0
    });

    // Set graph1 data
    setGraph1Data(preloadedData.graph1 || {});

    // Set graph2 data
    setGraph2Data({
        cycle: preloadedData.graph2?.cycle || {},
        eff: preloadedData.graph2?.eff || {}
    });

    // Set operator
    const operators = preloadedData.operator?.history || [];
    const activeOp = operators.find((op: any) => !op.stop_time);
    if (activeOp) {
        setOperatorData({
            emp_no: activeOp.emp_no || "-",
            emp_name: activeOp.tbm_operator?.emp_name || "-",
            hasOperator: true
        });
    } else {
        setOperatorData({ emp_no: "-", emp_name: "-", hasOperator: false });
    }

    return true;
};

// Then in fetchAllData, add at start:
// if (preloadedData && useBatchData()) {
//     return; // Skip individual API calls
// }

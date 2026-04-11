require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const influxService = require("./services/influxService");

const SHIFT_HOURS = [
  "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
  "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06",
];

async function main() {
  console.log("Starting data verification...");
  influxService.initClient();

  const now = new Date();
  
  // Last 4 days (not counting today, or counting today? Let's do past 4 days including today)
  for (let i = 4; i >= 0; i--) {
    const targetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const targetDateISO = targetDate.toISOString().split("T")[0];
    
    const startUTC = `${targetDateISO}T00:00:00.000Z`;
    const endUTC = new Date(targetDate.getTime() + 86400000).toISOString().split("T")[0] + "T00:00:00.000Z";

    console.log(`\n================================`);
    console.log(`Verifying Date: ${targetDateISO}`);
    console.log(`================================`);

    // Fetch MSSQL
    const [outputs, cycleTimes, ngs] = await Promise.all([
      prisma.tb_output_actual.findMany({ where: { date: targetDate } }),
      prisma.tb_cycle_time_actual.findMany({ where: { date: targetDate } }),
      prisma.tb_machine_ng.findMany({ where: { date: targetDate } })
    ]);

    // Aggregate MSSQL Output & Cycle Time
    const mssqlData = {};
    for (const o of outputs) {
      let totalOutput = 0;
      for (const h of SHIFT_HOURS) {
         totalOutput += (o[`actual_${h}`] || 0);
      }
      if (!mssqlData[o.machine_name]) mssqlData[o.machine_name] = { output: 0, cycle: 0, ng: 0, fromMssql: true };
      mssqlData[o.machine_name].output = totalOutput;
    }
    for (const c of cycleTimes) {
      if (!mssqlData[c.machine_name]) mssqlData[c.machine_name] = { output: 0, cycle: 0, ng: 0, fromMssql: true };
      mssqlData[c.machine_name].cycle = Number(c.cycle_time || 0).toFixed(2);
    }
    for (const ng of ngs) {
       if (ng.station_id !== 0) continue; // Skip individual stations to only count "True NG Parts"
       if (!mssqlData[ng.machine_name]) mssqlData[ng.machine_name] = { output: 0, cycle: 0, ng: 0, fromMssql: true };
       let totalNg = 0;
       for (const h of SHIFT_HOURS) totalNg += (ng[`ng_${h}`] || 0);
       mssqlData[ng.machine_name].ng += totalNg;
    }

    // Fetch InfluxDB
    const influxStats = await influxService.queryAllMachinesForHour(startUTC, endUTC);
    const influxNg = await influxService.queryAllMachinesNgCount(startUTC, endUTC);

    // Merge & Compare
    let discrepancies = 0;
    const allMachines = new Set([...Object.keys(mssqlData), ...Object.keys(influxStats), ...Object.keys(influxNg)]);

    for (const mn of allMachines) {
      const msQ = mssqlData[mn] || { output: 0, cycle: 0, ng: 0, fromMssql: false };
      const inxOutput = influxStats[mn]?.output_count || 0;
      const inxCycle = Number(influxStats[mn]?.avg_cycle_time || 0).toFixed(2);
      const inxNg = influxNg[mn] || 0;

      // Ensure zero fallback
      const mQOut = Number(msQ.output);
      const mQCycle = Number(msQ.cycle);
      const mQNg = Number(msQ.ng);
      
      const inOut = Number(inxOutput);
      const inCycle = Number(inxCycle);
      const inNg = Number(inxNg);

      if (mQOut !== inOut || mQNg !== inNg) {
        // Cycle time might have slightly different average math depending on hour-by-hour grouping vs flat grouping, so only alert if big diff
        console.log(`[Diff] Machine: ${mn}`);
        if (mQOut !== inOut) console.log(`       Output -> MSSQL: ${mQOut}, Influx: ${inOut}`);
        //if (Math.abs(mQCycle - inCycle) > 1.0) console.log(`       Cycle  -> MSSQL: ${mQCycle}, Influx: ${inCycle}`);
        if (mQNg !== inNg) console.log(`       NG     -> MSSQL: ${mQNg}, Influx: ${inNg}`);
        discrepancies++;
      }
    }

    if (discrepancies === 0) {
      console.log(`✅ All output and NG counts match perfectly between MSSQL and InfluxDB!`);
    } else {
      console.log(`⚠️ Found ${discrepancies} machines with mismatched data.`);
    }
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

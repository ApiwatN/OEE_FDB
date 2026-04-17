import sys
import re

with open('services/cronService.js', 'r', encoding='utf-8') as f:
    content = f.read()

events_repl = """async function syncEventsFromInfluxDb(startUTC, endUTC) {
    const statusData = await influxService.queryStatusRange(startUTC, endUTC);
    const alarmData = await influxService.queryAlarmRange(startUTC, endUTC);

    const TH_OFFSET_MS = 7 * 60 * 60 * 1000;

    // MSSQL expects Thai Local Time physically stored in Datetime column.
    // So query range must also shift +7
    const startTH = new Date(startUTC.getTime() + TH_OFFSET_MS);
    const endTH = new Date(endUTC.getTime() + TH_OFFSET_MS);

    let statusRecovered = 0;
    let alarmRecovered = 0;

    if (statusData.length > 0) {
        const existingStatus = await prisma.tb_MCStatus.findMany({
            where: { Datetime: { gte: startTH, lt: endTH } },
            select: { MC: true, Datetime: true }
        });
        const existingSet = new Set(existingStatus.map(r => `${r.MC}_${r.Datetime.getTime()}`));

        // When inserting, map Influx UTC time -> Thai local time (+7)
        const newStatus = statusData.filter(d => {
            const thTime = new Date(d.time.getTime() + TH_OFFSET_MS);
            return !existingSet.has(`${d.machine_name}_${thTime.getTime()}`);
        });

        if (newStatus.length > 0) {
            await prisma.tb_MCStatus.createMany({
                data: newStatus.map(d => ({
                    Datetime: new Date(d.time.getTime() + TH_OFFSET_MS),
                    MC: d.machine_name,
                    MCStatus: d.status
                }))
            });
            statusRecovered = newStatus.length;
        }
    }

    if (alarmData.length > 0) {
        const existingAlarm = await prisma.tb_MCAlarm.findMany({
            where: { Datetime: { gte: startTH, lt: endTH } },
            select: { MC: true, Datetime: true }
        });
        const existingSet = new Set(existingAlarm.map(r => `${r.MC}_${r.Datetime.getTime()}`));

        const newAlarm = alarmData.filter(d => {
            const thTime = new Date(d.time.getTime() + TH_OFFSET_MS);
            return !existingSet.has(`${d.machine_name}_${thTime.getTime()}`);
        });

        if (newAlarm.length > 0) {
            await prisma.tb_MCAlarm.createMany({
                data: newAlarm.map(d => ({
                    Datetime: new Date(d.time.getTime() + TH_OFFSET_MS),
                    MC: d.machine_name,
                    MCAlarm: d.alarm
                }))
            });
            alarmRecovered = newAlarm.length;
        }
    }

    if (statusRecovered > 0 || alarmRecovered > 0) {
        console.log(`   ✅ Recovered ${statusRecovered} Status and ${alarmRecovered} Alarm records from InfluxDB.`);
    }
}"""

# Use regex to replace the function block
events_pattern = re.compile(
    r'async function syncEventsFromInfluxDb\(startUTC, endUTC\).*?console\.log\(`   ✅ Recovered \$\{statusRecovered\}.*?\n\}',
    re.DOTALL
)

new_content = events_pattern.sub(events_repl, content)

with open('services/cronService.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Replaced successfully')

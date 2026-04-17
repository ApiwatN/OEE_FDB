import sys
import re

# 1. FIX mqttService.js
with open('services/mqttService.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the TH_OFFSET logic in mqttService
def replace_mqtt(match):
    return """                        // ตรวจสอบว่า Time เป็น UTC (ABR) หรือ Local (AHV)
                        // ถ้าระยะเวลาใกล้เคียงกับเวลาปัจจุบัน (True UTC) ให้บวก 7 ชั่วโมง
                        // แต่ถ้าล่วงหน้าไปแล้วราวๆ 7 ชั่วโมง (เพราะ AHV ส่งเป็นเวลาไทยโดยตรง) ไม่ต้องบวกเพิ่ม
                        let thaiDataTimeMs = dataTime.getTime();
                        if (thaiDataTimeMs - Date.now() < 3 * 3600 * 1000) {
                            thaiDataTimeMs += 7 * 60 * 60 * 1000; // ABR: Convert UTC to Local Thai Time
                        }
                        const thaiDataTime = new Date(thaiDataTimeMs);"""

content = re.sub(
    r'                        const TH_OFFSET_MS = 7 \* 60 \* 60 \* 1000;\n                        const thaiDataTime = new Date\(dataTime\.getTime\(\) \+ TH_OFFSET_MS\);',
    replace_mqtt,
    content
)

# Replace the payload conversion logic (reverse to real UTC)
def replace_payload(match):
    return """                            // ถ้าเวลาล่าสุดมันเป็น Local Thai (เดินหน้าไป 7 ชม.) 
                            // เราต้องลบ 7 กลับเป็น UTC ก่อนใช้แสดงในไทม์ไลน์หน้าบ้าน
                            let realUtcMs = latestStatus.Datetime.getTime();
                            if (realUtcMs - Date.now() > 3 * 3600 * 1000) {
                                realUtcMs -= 7 * 60 * 60 * 1000;
                            }
                            const realUtcTime = new Date(realUtcMs);"""

content = re.sub(
    r'                            const realUtcTime = new Date\(latestStatus\.Datetime\.getTime\(\) - TH_OFFSET_MS\);',
    replace_payload,
    content
)

# And for alarm payload
def replace_payload_alarm(match):
    return """                            let realUtcMs = latestAlarm.Datetime.getTime();
                            if (realUtcMs - Date.now() > 3 * 3600 * 1000) {
                                realUtcMs -= 7 * 60 * 60 * 1000;
                            }
                            const realUtcTime = new Date(realUtcMs);"""

content = re.sub(
    r'                            const realUtcTime = new Date\(latestAlarm\.Datetime\.getTime\(\) - TH_OFFSET_MS\);',
    replace_payload_alarm,
    content
)

with open('services/mqttService.js', 'w', encoding='utf-8') as f:
    f.write(content)


# 2. FIX cronService.js
with open('services/cronService.js', 'r', encoding='utf-8') as f:
    cron_content = f.read()

# Replace inner loop of syncEventsFromInfluxDb
cron_repl = """async function syncEventsFromInfluxDb(startUTC, endUTC) {
    const statusData = await influxService.queryStatusRange(startUTC, endUTC);
    const alarmData = await influxService.queryAlarmRange(startUTC, endUTC);

    const TH_OFFSET_MS = 7 * 60 * 60 * 1000;

    // MSSQL expects Thai Local Time physically stored in Datetime column.
    // So query range must also shift +7
    const startTH = new Date(startUTC.getTime() + TH_OFFSET_MS);
    const endTH = new Date(endUTC.getTime() + TH_OFFSET_MS);

    let statusRecovered = 0;
    let alarmRecovered = 0;

    const getThaiTime = (utcDate) => {
        let ms = utcDate.getTime();
        // If it's true UTC (ABR), it's close to Date.now (or past).
        // If it's already Thai time (AHV), influx parsed it as future (+7 hours).
        if (ms - Date.now() < 3 * 3600 * 1000) {
            ms += TH_OFFSET_MS;
        }
        return new Date(ms);
    };

    if (statusData.length > 0) {
        const existingStatus = await prisma.tb_MCStatus.findMany({
            where: { Datetime: { gte: startTH, lt: endTH } },
            select: { MC: true, Datetime: true }
        });
        const existingSet = new Set(existingStatus.map(r => `${r.MC}_${r.Datetime.getTime()}`));

        const newStatus = statusData.filter(d => {
            return !existingSet.has(`${d.machine_name}_${getThaiTime(d.time).getTime()}`);
        });

        if (newStatus.length > 0) {
            await prisma.tb_MCStatus.createMany({
                data: newStatus.map(d => ({
                    Datetime: getThaiTime(d.time),
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
            return !existingSet.has(`${d.machine_name}_${getThaiTime(d.time).getTime()}`);
        });

        if (newAlarm.length > 0) {
            await prisma.tb_MCAlarm.createMany({
                data: newAlarm.map(d => ({
                    Datetime: getThaiTime(d.time),
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

cron_pattern = re.compile(
    r'async function syncEventsFromInfluxDb\(startUTC, endUTC\).*?console\.log\(`   ✅ Recovered \$\{statusRecovered\}.*?\n\}',
    re.DOTALL
)

new_cron = cron_pattern.sub(cron_repl, cron_content)

with open('services/cronService.js', 'w', encoding='utf-8') as f:
    f.write(new_cron)

print('Replaced Time Conversion Logic successfully')

import sys
import re

with open('services/mqttService.js', 'r', encoding='utf-8') as f:
    content = f.read()

status_repl = """                        // 1. เขียนลง MSSQL (ต้องบวก 7 ชั่วโมงเพราะ MSSQL เก็บเวลา Local ไทยตรงๆ แกล้งเป็น UTC)
                        const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
                        const thaiDataTime = new Date(dataTime.getTime() + TH_OFFSET_MS);

                        try {
                            await prisma.tb_MCStatus.create({
                                data: {
                                    Datetime: thaiDataTime,
                                    MC: machineName,
                                    MCStatus: statusStr
                                }
                            });
                        } catch (e) {
                            console.error(`[MQTT] tb_MCStatus Insert Error for ${machineName}:`, e.message);
                        }

                        // 2. เมื่อเขียนเสร็จให้ไปดึงจาก MSSQL มาแสดง เพื่อ update ปัจจุบัน
                        const latestStatus = await prisma.tb_MCStatus.findFirst({
                            where: { MC: machineName },
                            orderBy: { Datetime: 'desc' },
                            select: { MCStatus: true, Datetime: true }
                        });
                        
                        if (latestStatus) {
                            currentState.live_status = latestStatus.MCStatus;
                            currentState.last_update = now;
                            machineStateMem.set(machineName, currentState);

                            // แปลงกลับเป็น UTC จริง (ลบ 7 ชั่วโมง) ก่อนแจ้งให้ Frontend
                            const realUtcTime = new Date(latestStatus.Datetime.getTime() - TH_OFFSET_MS);

                            try {
                                const rtService = require("./realtimeService");
                                if (rtService && typeof rtService.pushRealtimeMcStatus === "function") {
                                    rtService.pushRealtimeMcStatus(machineName, latestStatus.MCStatus, realUtcTime);
                                }
                            } catch (err) {}

                            const mcUpdatePayload = { machine_name: machineName, status: latestStatus.MCStatus, datetime: realUtcTime.toISOString() };
                            if (localEmitToRoomFn) localEmitToRoomFn(`machine:${machineName}`, "mc_status_updated", mcUpdatePayload);
                            if (localBroadcastFn) localBroadcastFn("mc_status_updated", mcUpdatePayload);
                        }"""

alarm_repl = """                        // 1. เขียนลง MSSQL (ต้องบวก 7 ชั่วโมงเพราะ MSSQL เก็บเวลา Local ไทยตรงๆ แกล้งเป็น UTC)
                        const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
                        const thaiDataTime = new Date(dataTime.getTime() + TH_OFFSET_MS);

                        try {
                            await prisma.tb_MCAlarm.create({
                                data: {
                                    Datetime: thaiDataTime,
                                    MC: machineName,
                                    MCAlarm: alarmStr
                                }
                            });
                        } catch (e) {
                            console.error(`[MQTT] tb_MCAlarm Insert Error for ${machineName}:`, e.message);
                        }

                        // 2. ไปดึงจาก MSSQL มาแสดง
                        const latestAlarm = await prisma.tb_MCAlarm.findFirst({
                            where: { MC: machineName },
                            orderBy: { Datetime: 'desc' },
                            select: { MCAlarm: true, Datetime: true }
                        });
                        
                        if (latestAlarm) {
                            currentState.live_alarm = latestAlarm.MCAlarm;
                            currentState.last_update = now;
                            machineStateMem.set(machineName, currentState);

                            const realUtcTime = new Date(latestAlarm.Datetime.getTime() - TH_OFFSET_MS);

                            const alarmUpdatePayload = { machine_name: machineName, alarm: latestAlarm.MCAlarm, datetime: realUtcTime.toISOString() };
                            if (localEmitToRoomFn) localEmitToRoomFn(`machine:${machineName}`, "mc_status_updated", alarmUpdatePayload);
                            if (localBroadcastFn) localBroadcastFn("mc_status_updated", alarmUpdatePayload);
                        }"""

status_pattern = re.compile(
    r'                        try \{\n                            await prisma\.tb_MCStatus\.create.*?if \(localBroadcastFn\) localBroadcastFn\("mc_status_updated", mcUpdatePayload\);\n                        \}',
    re.DOTALL
)

alarm_pattern = re.compile(
    r'                        try \{\n                            await prisma\.tb_MCAlarm\.create.*?if \(localBroadcastFn\) localBroadcastFn\("mc_status_updated", alarmUpdatePayload\);\n                        \}',
    re.DOTALL
)

new_content = status_pattern.sub(status_repl, content)
new_content = alarm_pattern.sub(alarm_repl, new_content)

with open('services/mqttService.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Replaced successfully')

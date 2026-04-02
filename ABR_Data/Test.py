import pymcprotocol
import time
import os
import json
import threading
import socket
from datetime import datetime, timezone, timedelta

# set timeout to prevent socket freezing when LAN connection is abruptly dropped
socket.setdefaulttimeout(3.0)


BASE_DIR = r"c:\Project\OEE_FDB\ABR_Data"
JSON_PATH = os.path.join(BASE_DIR, "ABR-003.config.json")

def get_utc_date_str():
    """คืนค่า string วันที่ UTC ปัจจุบัน เช่น '2026_03_30'"""
    return datetime.now(timezone.utc).strftime("%Y_%m_%d")

def log_to_dat(machine_name, folder, message, custom_utc=None, custom_local=None):
    """บันทึกลงไฟล์ตามวัน UTC เปลี่ยนวันจะขึ้นไฟล์ใหม่อัตโนมัติ โดยแยกห้องตามชื่อ PLC (machine_name)"""
    date_str = get_utc_date_str()
    # เพิ่ม machine_name เข้าไปใน path ชั้นแรก
    dir_path = os.path.join(BASE_DIR, machine_name, folder)
    os.makedirs(dir_path, exist_ok=True)
    filepath = os.path.join(dir_path, f"{date_str}.dat")
    
    timestamp_utc = custom_utc if custom_utc else datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    timestamp_local = custom_local if custom_local else datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    with open(filepath, mode='a', encoding='utf-8') as f:
        f.write(f"{timestamp_utc};{timestamp_local};{message}\n")

def load_tags_from_json():
    """อ่านคอนฟิก Tags ทั้งหมดจากไฟล์ JSON"""
    if not os.path.exists(JSON_PATH):
        raise FileNotFoundError(f"ไม่พบไฟล์คอนฟิก {JSON_PATH}")
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def run_plc_thread(plc_config, tags):
    """ฟังก์ชันสำหรับแต่ละ Thread ของ PLC (ทำงานคูขนานกัน 1 เครื่อง ต่อ 1 Thread)"""
    machine_name = plc_config.get("name", "Unknown_Machine")
    plc_ip = plc_config.get("ip")
    plc_port = plc_config.get("port")
    
    # === สร้างตัวแปร State เอาไว้นอกสุด (เหนือ Loop Reconnect) ===
    # จุดนี้คือคำตอบว่า "ถ้ายกเลิก/หลุดไป แล้วกลับมาทำงานใหม่" ค่าจะไม่สูญหาย!
    # เพราะตัวแปร Tracking เดิม เช่น ชิ้นงานครั้งล่าสุุด (prev_total) จะถูกจำเอาไว้ตลอด 
    prev_model = None
    prev_total = None
    prev_ok = None
    prev_ng = None
    prev_status = {}
    prev_alarm = {}
    prev_station_ng = {dev: 0 for dev in tags["station_ng"].values()}
    pending_stations = {dev: False for dev in tags["station_ng"].values()}
    event_id = 0

    while True: # ลูปนอกสำหรับจัดการ Reconnect หรือ Auto-Recovery
        pymc3e = pymcprotocol.Type3E()
        try:
            print(f"[{machine_name}] กำลังพยายามเชื่อมต่อ {plc_ip}:{plc_port}...")
            pymc3e.connect(plc_ip, plc_port)
            print(f"[{machine_name}] เชื่อมต่อสำเร็จ! เริ่มดึงข้อมูลตามปกติ ✅")
            just_reconnected = True
            
            while True: # ลูปในสำหรับดึงข้อมูลปกติทุกๆ 1 วินาที
                has_error = False
                
                # --- 1. Model ---
                if tags["model"]:
                    try:
                        val = pymc3e.batchread_wordunits(headdevice=tags["model"], readsize=1)
                        if val is not None and len(val) > 0:
                            raw_model_str = str(val[0])
                            current_model = tags.get("model_map", {}).get(raw_model_str, raw_model_str)
                            
                            if prev_model is not None and current_model != prev_model:
                                log_to_dat(machine_name, "model", f"{current_model}")
                                print(f"[{machine_name}] [MODEL CHANGED] {current_model}")
                            prev_model = current_model
                    except Exception as e:
                        has_error = True

                # --- 2. Station NG (L bits) ---
                if not has_error:
                    for comment, dev in tags["station_ng"].items():
                        try:
                            val = pymc3e.batchread_bitunits(headdevice=dev, readsize=1)
                            if val is not None and len(val) > 0:
                                current_l = val[0]
                                if current_l == 1 and prev_station_ng.get(dev, 0) == 0:
                                    pending_stations[dev] = True
                                    print(f"[{machine_name}] [{comment}] PENDING_BUFFER=TRUE รอ Total เปลี่ยน...")
                                prev_station_ng[dev] = current_l
                        except Exception as e:
                            has_error = True
                            break

                # --- 3. Output (Total, OK, NG) ---
                if not has_error:
                    try:
                        current_output = {}
                        for comment, dev in tags["output"].items():
                            val = pymc3e.batchread_wordunits(headdevice=dev, readsize=1)
                            if val is not None and len(val) > 0:
                                current_output[comment] = val[0]
                        
                        if "Total" in current_output and "OK" in current_output and "NG" in current_output:
                            curr_t = current_output["Total"]
                            curr_ok = current_output["OK"]
                            curr_ng = current_output["NG"]
                            
                            if prev_total is not None and curr_t != prev_total:
                                total_diff = 0
                                is_gap_recovery = just_reconnected
                                
                                if curr_t < prev_total:
                                    # Counter reset
                                    total_diff = curr_t
                                    is_gap_recovery = True
                                else:
                                    total_diff = curr_t - prev_total
                                    
                                if total_diff > 0:
                                    event_id += 1
                                    
                                    ok_diff = curr_ok - (prev_ok if prev_ok is not None else 0)
                                    ng_diff = curr_ng - (prev_ng if prev_ng is not None else 0)
                                    
                                    if curr_ok < (prev_ok if prev_ok is not None else 0): ok_diff = curr_ok
                                    if curr_ng < (prev_ng if prev_ng is not None else 0): ng_diff = curr_ng
                                    
                                    if is_gap_recovery:
                                        # Force all to be OK if it's a gap or reset
                                        ng_needed = 0
                                    else:
                                        ng_needed = max(0, ng_diff)
                                        # Limit NG to total diff just in case
                                        if ng_needed > total_diff: ng_needed = total_diff
                                        
                                    model_val = prev_model if prev_model is not None else "-"
                                    
                                    # อ่าน Cycle Time
                                    ct_val = "-"
                                    if tags.get("cycle_time"):
                                        val_ct = pymc3e.batchread_wordunits(headdevice=tags["cycle_time"], readsize=1)
                                        if val_ct is not None and len(val_ct) > 0:
                                            raw_ct = str(val_ct[0])
                                            if len(raw_ct) == 1:
                                                ct_val = f"{raw_ct}.00"
                                            elif len(raw_ct) == 2:
                                                ct_val = f"{raw_ct[0]}.{raw_ct[1]}"
                                            else:
                                                ct_val = f"{raw_ct[:-2]}.{raw_ct[-2:]}"
                                                
                                    base_utc = datetime.now(timezone.utc)
                                    base_loc = datetime.now()
                                    
                                    for i in range(total_diff):
                                        # Determine if this unit is NG
                                        is_ng_unit = False
                                        if ng_needed > 0:
                                            is_ng_unit = True
                                            ng_needed -= 1
                                            
                                        sta_val = "OK"
                                        stb_val = "OK"
                                        if is_ng_unit:
                                            for c, dev in tags["station_ng"].items():
                                                if c.upper().endswith("A") and pending_stations.get(dev):
                                                    sta_val = "NG"
                                                if c.upper().endswith("B") and pending_stations.get(dev):
                                                    stb_val = "NG"
                                        
                                        # Calculate Staggered Time (100ms apart)
                                        utc_time = base_utc + timedelta(milliseconds=100*i)
                                        loc_time = base_loc + timedelta(milliseconds=100*i)
                                        
                                        utc_str = utc_time.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                                        loc_str = loc_time.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                                        
                                        # จำลองเลข Total ให้ค่อยๆ วิ่งทีละ 1 ตามลำดับ
                                        calc_t = curr_t - total_diff + i + 1
                                        message_data = f"{model_val};{calc_t};{curr_ok};{curr_ng};{sta_val};{stb_val};{ct_val};{event_id}"
                                        
                                        log_to_dat(machine_name, "output", message_data, custom_utc=utc_str, custom_local=loc_str)
                                        print(f"[{machine_name}] [OUTPUT] {utc_str};{loc_str};{message_data}")
                                        
                                # รีเซ็ต pending หลังเก็บบันทึก
                                for k in pending_stations:
                                    pending_stations[k] = False
                                    
                            prev_total = curr_t
                            prev_ok = curr_ok
                            prev_ng = curr_ng
                            just_reconnected = False
                    except Exception as e:
                        has_error = True

                # --- 4. Machine Status ---
                if not has_error:
                    for tag in tags["status"]:
                        try:
                            val = pymc3e.batchread_bitunits(headdevice=tag["device"], readsize=1)
                            if val is not None and len(val) > 0:
                                current_val = val[0]
                                if current_val == 1 and prev_status.get(tag["device"], 0) == 0:
                                    log_to_dat(machine_name, "machine_status", f"{tag['comment']}")
                                    print(f"[{machine_name}] [STATUS] {tag['comment']}")
                                prev_status[tag["device"]] = current_val
                        except Exception as e:
                            has_error = True
                            break

                # --- 5. Machine Alarm ---
                if not has_error:
                    for tag in tags["alarm"]:
                        try:
                            val = pymc3e.batchread_bitunits(headdevice=tag["device"], readsize=1)
                            if val is not None and len(val) > 0:
                                current_val = val[0]
                                if current_val == 1 and prev_alarm.get(tag["device"], 0) == 0:
                                    log_to_dat(machine_name, "machine_alarm", f"{tag['comment']};{tag['device']}")
                                    
                                    if tag['comment'] != "-":
                                        print(f"[{machine_name}] [ALARM] {tag['comment']}")
                                prev_alarm[tag["device"]] = current_val
                        except Exception as e:
                            has_error = True
                            break

                # เมื่อเจอ Socket หลุด หรือ Error ใดๆ ให้ดีดออกจากลูปในเพื่อเข้ากระบวนการ Restart ในลูปนอก
                if has_error:
                    print(f"[{machine_name}] ⚠️ หลุดการเชื่อมต่อหรือข้อมูลเน็ตเวิร์กผิดพลาด!")
                    break 

                time.sleep(0.5)

        except Exception as e:
            print(f"[{machine_name}] ❌ เชื่อมต่อล้มเหลว: {e}")
            
        finally:
            # ไม่ว่าจะหลุดจาก Error แบบไหน ต้องล้าง Socket เดิมทิ้งเสมอ ไม่งั้น PLC พัง
            try:
                pymc3e.close()
            except:
                pass
            print(f"[{machine_name}] ⏳ รอ 5 วินาทีก่อนพยายามเชื่อมต่อใหม่...")
            time.sleep(5)

def main():
    print("กำลังโหลด Tags และ Setting จาก JSON...")
    try:
        config_data = load_tags_from_json()
    except Exception as e:
        print(f"อ่านไฟล์ JSON ไม่สำเร็จ: {e}")
        return

    plcs = config_data.get("plcs", [])
    if not plcs:
        print("❌ ไม่พบการตั้งค่า 'plcs': [] (รายชื่อเครือข่าย PLC) ในไฟล์ Config.json")
        return
        
    print(f"พบเชื่อมโยง PLC ทั้งหมด {len(plcs)} เครื่อง เริ่มต้นระบบ Multi-Threading...\n" + "-"*40)
    
    threads = []
    # กระจาย Thread ให้แต่ละ PLC
    for plc in plcs:
        t = threading.Thread(target=run_plc_thread, args=(plc, config_data), daemon=True)
        t.start()
        threads.append(t)
        
    try:
        # ให้ Thread หลักมีชีวิตต่อไปเพื่อให้ Thread ย่อยทำงานได้
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n🛑 หยุดการทำงานโดยผู้ใช้ (กด Ctrl+C)")
        print("ปิดระบบเรียบร้อย")

if __name__ == "__main__":
    main()
"use client"
import MyModal from "../components/MyModal";
import { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import axios from "axios";
import config from "@/app/config";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { io } from "socket.io-client";

export default function page() {
    const router = useRouter();
    const [machine, setMachine] = useState("");
    const [operatorCode, setOperatorCode] = useState("");
    const [types, setTypes] = useState([]);
    const [areaSelected, setAreaSelected] = useState("");
    const [areas, setAreas] = useState([]);

    // ✅ 1. เพิ่ม State สำหรับป้องกันการกดซ้ำ
    const [isSubmitting, setIsSubmitting] = useState(false);

    // ✅ 2. เพิ่ม State สำหรับเช็คว่ามีคนทำงานอยู่หรือไม่ (เพื่อ Disable Scan Mode)
    const [hasActiveOperator, setHasActiveOperator] = useState(false);

    const now = new Date();
    // ✅ Helper สำหรับแปลง Date เป็น String YYYY-MM-DD (ใช้ Local Time หรือ UTC ตาม requirement)
    // ถ้าต้องการ Local Client Time จริงๆ แนะนำให้ใช้แบบนี้:
    // const formatDate = (d: Date) => d.toLocaleDateString('en-CA'); 
    // แต่ถ้าต้องการ UTC ตามโค้ดเดิมใช้:
    const formatDate = (d: Date) => d.toISOString().split("T")[0];

    const [selectedDate, setSelectedDate] = useState(formatDate(now));
    const [selectedShift, setSelectedShift] = useState("A");
    const [activeTab, setActiveTab] = useState<'scan' | 'history'>('scan'); // ✅ Tab State

    const empInputRef = useRef<HTMLInputElement>(null);

    const [countdown, setCountdown] = useState(300);
    const [refreshTime, setRefreshTime] = useState(300);

    // ✅ State และ Ref สำหรับคำนวณความกว้างสูงสุดของปุ่ม machine_type
    const [maxButtonWidth, setMaxButtonWidth] = useState<number | null>(null);
    const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        const init = async () => {
            if (localStorage.getItem("operatorLocal")) {
                router.push("/machine_working");
                return;
            }

            await fetchDataMachineArea();
            const savedArea = localStorage.getItem("machineAreaLocal");
            if (savedArea) {
                setAreaSelected(savedArea);
                await fetchDataMachineTypesWithName(savedArea);
            }

            const hour = now.getHours();
            if (hour >= 7 && hour < 15) setSelectedShift("A");
            else if (hour >= 15 && hour < 23) setSelectedShift("B");
            else setSelectedShift("C");
        };
        init();

        const modalEl = document.getElementById("modalMachine");
        if (modalEl) {
            modalEl.addEventListener("shown.bs.modal", () => {
                empInputRef.current?.focus();
            });
            // Reset submitting status when modal opens just in case
            modalEl.addEventListener("hidden.bs.modal", () => {
                setIsSubmitting(false);
                setOperatorCode("");
            });
        }

        return () => {
            if (modalEl) {
                modalEl.removeEventListener("shown.bs.modal", () => {
                    empInputRef.current?.focus();
                });
            }
        };
    }, []);

    useEffect(() => {
        const countdownTimer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    if (areaSelected) {
                        fetchDataMachineTypesWithName(areaSelected);
                    }
                    return refreshTime;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(countdownTimer);
        return () => clearInterval(countdownTimer);
    }, [refreshTime, areaSelected]);

    // ✅ Real-time Updates with Socket.io
    useEffect(() => {
        const socket = io(config.apiServer);

        socket.on("connect", () => {
            console.log("✅ Connected to Socket.io Server");
        });

        socket.on("machine_updated", (data: any) => {
            console.log("🔔 Real-time update received:", data);
            if (areaSelected) {
                fetchDataMachineTypesWithName(areaSelected);
            }
        });

        return () => {
            socket.disconnect();
        };
    }, [areaSelected]);

    // ✅ เพิ่ม Debounce Effect สำหรับ Auto Submit
    useEffect(() => {
        // ถ้ากำลัง submit หรือ code สั้นเกินไป ไม่ต้องทำอะไร
        if (isSubmitting || !operatorCode || operatorCode.length < 5) return;

        const timer = setTimeout(() => {
            console.log("Auto submitting code:", operatorCode);
            handleScanComplete(operatorCode, true);
        }, 800); // รอ 0.8 วินาที

        return () => clearTimeout(timer);
    }, [operatorCode]);

    // ✅ Effect สำหรับคำนวณความกว้างสูงสุดของปุ่ม machine_type
    useEffect(() => {
        // Reset maxButtonWidth เมื่อ types เปลี่ยน
        setMaxButtonWidth(null);
        
        // รอให้ DOM render เสร็จก่อน
        const timer = setTimeout(() => {
            if (buttonRefs.current.length > 0) {
                const validButtons = buttonRefs.current.filter(btn => btn !== null);
                if (validButtons.length > 0) {
                    // ใช้ offsetWidth เพื่อวัดความกว้างจริงของปุ่ม
                    const widths = validButtons.map(btn => btn!.offsetWidth);
                    const maxWidth = Math.max(...widths);
                    // Cap maxWidth ไว้ไม่ให้เกิน 600px เพื่อไม่ให้ล้น
                    setMaxButtonWidth(Math.min(maxWidth, 600));
                }
            }
        }, 150);
        return () => clearTimeout(timer);
    }, [types]);

    const fetchDataMachineTypesWithName = async (area: any) => {
        try {
            if (!area || area === "") {
                setTypes([]);
                return;
            }
            const res = await axios.get(
                config.apiServer + "/api/machine/listTypeWithMachines/" + area
            );
            setTypes(res.data.results);
        } catch (e: any) {
            Swal.fire({
                title: "Error fetching data",
                text: e.message,
                icon: "error",
            });
        }
    };

    const fetchDataMachineArea = async () => {
        try {
            const rows = await axios.get(config.apiServer + "/api/machine/listArea")
            setAreas(rows.data.results)
        } catch (e: any) {
            Swal.fire({
                title: "error fetchData",
                text: e.message,
                icon: "error",
            });
        }
    };

    const handleAreaChange = (e: any) => {
        const selectedArea = e.target.value;
        setAreaSelected(selectedArea);
        localStorage.setItem("machineAreaLocal", selectedArea)
        fetchDataMachineTypesWithName(selectedArea);
    }

    const handleCheckBeforeScan = async (item: any): Promise<boolean> => {
        try {
            setMachine(item.name);
            const res = await axios.get(config.apiServer + "/api/historyWorking/getOperatorIdWorking/" + item.name);
            const historyWorking = res.data?.results || null;

            if (!historyWorking) {
                return true;
            } else {
                const machineDate = historyWorking.date;
                const machineName = historyWorking.machine_name;
                localStorage.setItem("machineDateLocal", machineDate);
                localStorage.setItem("machineNameLocal", machineName);

                // ✅ ถ้ามีคนทำงานอยู่ ให้เปิด Modal แต่บังคับเป็นโหมด History
                // router.push("/machine_working");
                // return false; 
                return true; // อนุญาตให้เปิด Modal
            }
        } catch (e: any) {
            Swal.fire({
                title: "Error",
                text: e.message,
                icon: "error",
            });
            return false;
        }
    };

    // ✅ ฟังก์ชันเมื่อสแกนเสร็จ (แก้ไขเพิ่ม Logic ป้องกัน Double Submit)
    const handleScanComplete = async (code: string, isAutoSubmit = false) => {
        // 1. ถ้ากำลังส่งข้อมูลอยู่ ให้หยุดทำงานทันที (ป้องกัน Enter รัว)
        if (isSubmitting) return;

        try {
            if (!code || !machine) {
                // ถ้าเป็น auto submit ไม่ต้องแจ้งเตือนว่าเลือกเครื่องหรือยัง เพราะมันจะน่ารำคาญ
                if (!isAutoSubmit) {
                    Swal.fire({
                        title: "Please select a machine first.",
                        icon: "warning",
                    });
                }
                return;
            }

            // 2. ล็อคสถานะทันที
            setIsSubmitting(true);

            console.log("selectedDate: " + selectedDate);
            const payload = {
                machine_name: machine,
                emp_no: code,
                date: selectedDate,
                shift: selectedShift,
            }

            const res = await axios.post(
                config.apiServer + "/api/historyWorking/createStartTime",
                payload
            );
            // 🛠️ แก้ไขตรงนี้: อ่านค่าจาก .data (ตามที่ Backend ส่งมา) หรือ .results (เผื่อไว้)
            const historyWorking = res.data?.data || res.data?.results || null;

            // 🛡️ ป้องกัน Error: เช็คว่ามีข้อมูลหรือไม่ก่อนดึงค่า date
            if (!historyWorking) {
                throw new Error("No history data received from server.");
            }
            const machineDate = historyWorking.date;
            const machineName = historyWorking.machine_name;
            const operatorId = historyWorking.emp_no
            Swal.fire({
                title: "Entering Production Page...",
                text: `Machine: ${machine}, Employee ID: ${code}`,
                icon: "success",
                timer: 800,
                showConfirmButton: false,
            }).then(() => {
                localStorage.setItem("machineDateLocal", selectedDate);
                localStorage.setItem("machineNameLocal", machineName);
                localStorage.setItem("operatorLocal", operatorId);
                Swal.close();
                document.body.classList.remove("modal-open");
                document.querySelectorAll(".modal-backdrop, .swal2-container").forEach(el => el.remove());

                router.push("/machine_working");
                // ไม่ต้องปลดล็อค setIsSubmitting(false) ที่นี่ เพราะเราจะเปลี่ยนหน้าแล้ว
            });
        } catch (e: any) {
            // 3. ปลดล็อคเมื่อเกิด Error เพื่อให้สแกนใหม่ได้
            setIsSubmitting(false);

            // ✅ ใช้ Toast Notification แทน Alert ใหญ่ เพื่อไม่ให้ขัดจังหวะการพิมพ์
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true
            });

            if (e.response?.status === 400) {
                Toast.fire({
                    icon: 'warning',
                    title: e.response?.data?.message || e.message
                });
            } else {
                Toast.fire({
                    icon: 'error',
                    title: e.response?.data?.message || e.message
                });
            }

            // ❌ เอาออก: ไม่ล้างข้อมูล เพื่อให้ User พิมพ์ต่อได้เลย
            // clearData(); 
        }
    };

    const clearData = () => {
        setOperatorCode("");
    };

    return (
        <>
            <div className="card mt-3">
                <div
                    className="card-header position-relative fs-2 text-dark"
                    style={{
                        background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)",
                        borderBottom: "1px solid #e0e0e0",
                        fontWeight: 600,
                        fontSize: "1.8rem",
                    }}
                >
                    <div className="d-flex align-items-center gap-2">
                        <i className="fa fa-tachometer-alt fs-4 text-primary"></i>
                        <span>OEE Dashboard</span>
                    </div>

                    <div
                        className="position-absolute top-50 end-0 translate-middle-y d-flex align-items-center gap-2 me-3"
                        style={{ fontSize: "0.9rem" }}
                    >
                        <div
                            className="d-flex align-items-center px-3 py-1 rounded-pill shadow-sm"
                            style={{
                                background: "linear-gradient(90deg, #0d6efd 0%, #0b5ed7 100%)",
                                color: "white",
                                fontWeight: 500,
                                boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                                minWidth: "160px",
                                justifyContent: "center",
                            }}
                        >
                            <i className="fas fa-sync-alt me-2"></i>
                            <span>Refresh in:</span>
                            <span
                                className="ms-2 fw-bold"
                                style={{
                                    fontVariantNumeric: "tabular-nums",
                                    letterSpacing: "1px",
                                }}
                            >
                                {Math.floor(countdown / 60)}:
                                {String(countdown % 60).padStart(2, "0")}
                            </span>
                        </div>
                    </div>

                </div>
                <div className="card-body">
                    <div className="fs-5">Select Working Area</div>
                    <select
                        className="form-select"
                        value={areaSelected}
                        onChange={handleAreaChange}
                    >
                        <option value="">-- Select Working Area --</option>
                        {areas.map((item: any) => (
                            <option key={item.machine_area} value={item.machine_area}>
                                {item.machine_area}
                            </option>
                        ))}
                    </select>

                    <div className="d-flex flex-column gap-3">
                        {types.map((itemType: any, index: number) => (
                            <div
                                key={itemType.machine_type}
                                className="d-flex flex-column mt-3 gap-3 p-3 rounded-3 shadow-sm"
                                style={{
                                    background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)",
                                    border: "1px solid #e0e0e0",
                                }}
                            >
                                <button
                                    ref={(el) => { buttonRefs.current[index] = el; }}
                                    className="btn fw-bold d-flex justify-content-center align-items-center rounded-3 border-0"
                                    style={{
                                        width: maxButtonWidth ? `${maxButtonWidth}px` : "fit-content",
                                        height: "52px",
                                        background: "linear-gradient(135deg, #007bff 0%, #0056b3 100%)",
                                        color: "white",
                                        boxShadow: "0 3px 6px rgba(0,0,0,0.15)",
                                        letterSpacing: "0.5px",
                                        cursor: "pointer",
                                        whiteSpace: "nowrap",
                                        paddingLeft: "24px",
                                        paddingRight: "24px",
                                    }}
                                    onClick={() => {
                                        if (!selectedDate) {
                                            Swal.fire("Please select a date first.", "", "warning");
                                            return;
                                        }
                                        const currentUtcDate = new Date().toISOString().split('T')[0];
                                        router.push(`/overall_machine_working?area=${areaSelected}&type=${itemType.machine_type}&date=${currentUtcDate}`);
                                    }}
                                >
                                    {itemType.machine_type} {itemType.full_machine_type ? `(${itemType.full_machine_type})` : ''} <i className="fas fa-external-link-alt ms-2"></i>
                                </button>

                                <div className="d-flex flex-wrap gap-3">
                                    {itemType.machines.map((m: any) => {
                                        const hasOperator = !!m.operator;
                                        const isInactive = m.status === "inactive";
                                        const bgColor = isInactive
                                            ? "linear-gradient(145deg, #e0e0e0, #e2c9c9ff)"
                                            : hasOperator
                                                ? "linear-gradient(145deg, #17df10ff, #04b648ff)"
                                                : "linear-gradient(145deg, #f7d162ff, #f0f33cff)";

                                        const textColor = isInactive ? "#555" : "#000000ff";

                                        return (
                                            <button
                                                key={m.id}
                                                className="rounded-4 border-0 shadow-sm position-relative"
                                                style={{
                                                    background: bgColor,
                                                    color: textColor,
                                                    minWidth: "180px",
                                                    maxWidth: "200px",
                                                    height: "80px",
                                                    cursor: isInactive ? "not-allowed" : "pointer",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    justifyContent: "center",
                                                    alignItems: "center",
                                                    boxShadow: isInactive
                                                        ? "inset 0 2px 4px rgba(0,0,0,0.1)"
                                                        : "0 4px 10px rgba(0,0,0,0.15)",
                                                    transition: "all 0.2s ease-in-out",
                                                }}
                                                disabled={isInactive}
                                                onMouseEnter={(e) => {
                                                    if (!isInactive)
                                                        (e.currentTarget.style.transform = "scale(1.03)");
                                                }}
                                                onMouseLeave={(e) => {
                                                    (e.currentTarget.style.transform = "scale(1)");
                                                }}
                                                onClick={async () => {
                                                    const allowOpen = await handleCheckBeforeScan(m);
                                                    if (allowOpen) {
                                                        const modalEl = document.getElementById("modalMachine");
                                                        if (modalEl) {
                                                            clearData();
                                                            // ✅ Logic เลือก Tab เริ่มต้น
                                                            if (m.operator) {
                                                                // ถ้ามีคนทำงานอยู่ -> ไป History Mode
                                                                setActiveTab('history');
                                                                setHasActiveOperator(true); // ✅ Set Active Operator State
                                                                // Set วันที่ใน Modal เป็นวันที่ของ Job นั้น
                                                                // (อาจจะต้องเก็บ date จาก api check หรือใช้ selectedDate ปกติ)
                                                            } else {
                                                                // ถ้าไม่มี -> ไป Scan Mode
                                                                setActiveTab('scan');
                                                                setHasActiveOperator(false); // ✅ Set Active Operator State
                                                                setSelectedDate(formatDate(now)); // Reset วันที่เป็นปัจจุบัน
                                                            }

                                                            const modal = new (await import("bootstrap")).Modal(modalEl);
                                                            modal.show();
                                                        }
                                                    }
                                                }}
                                            >
                                                <span className="fw-bold fs-6">{m.name}</span>
                                                <small
                                                    className="fw-semibold"
                                                    style={{ color: hasOperator ? "#12067eff" : "#666" }}
                                                >
                                                    {hasOperator ? `(${m.operator.emp_no}: ${m.operator.name})` : "(stand by)"}
                                                </small>

                                                {!isInactive && (
                                                    <span
                                                        className="position-absolute bottom-0 end-0 px-2 py-0.5 rounded-top-start text-uppercase fw-bold"
                                                        style={{
                                                            fontSize: "10px",
                                                            backgroundColor: hasOperator ? "#145a32" : "",
                                                            color: "#fff",
                                                        }}
                                                    >
                                                        {hasOperator ? "ACTIVE" : ""}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div >
            <MyModal id="modalMachine" title="Login to Work">
                <div style={{ minHeight: "200px" }}>
                    {/* ✅ Header แสดงชื่อเครื่อง */}
                    <div className="fs-5 mb-3 text-center">
                        Scan to use machine:
                        <span className="fw-bold text-primary"> {machine}</span>
                    </div>

                    {/* ✅ Tabs Selection */}
                    <ul className="nav nav-tabs nav-fill mb-4">
                        <li className="nav-item">
                            <button
                                className={`nav-link ${activeTab === 'scan' ? 'active fw-bold' : ''}`}
                                onClick={() => setActiveTab('scan')}
                                disabled={hasActiveOperator} // ✅ Disable if active operator exists
                            >
                                <i className="fas fa-qrcode me-2"></i> Scan Working
                            </button>
                        </li>
                        <li className="nav-item">
                            <button
                                className={`nav-link ${activeTab === 'history' ? 'active fw-bold' : ''}`}
                                onClick={() => setActiveTab('history')}
                            >
                                <i className="fas fa-history me-2"></i> History Working
                            </button>
                        </li>
                    </ul>

                    {/* ✅ Content - Scan Mode */}
                    {activeTab === 'scan' && (
                        <div className="d-flex flex-column justify-content-center align-items-center text-center fade-in">
                            <div className="d-flex gap-2 mb-3">
                                <div>
                                    <label className="form-label mb-1 fw-semibold text-muted" style={{ fontSize: '0.85rem' }}>Date (UTC)</label>
                                    <input
                                        type="date"
                                        className="form-control text-center bg-light"
                                        style={{ width: "160px" }}
                                        value={formatDate(new Date())} // ✅ Fixed to Current Date
                                        disabled={true} // ✅ Readonly
                                    />
                                </div>

                                <div>
                                    <label className="form-label mb-1 fw-semibold text-muted" style={{ fontSize: '0.85rem' }}>Shift</label>
                                    <select
                                        className="form-select text-center"
                                        style={{ width: "100px" }}
                                        value={selectedShift}
                                        onChange={(e) => setSelectedShift(e.target.value)}
                                    >
                                        <option value="A">A</option>
                                        <option value="B">B</option>
                                        <option value="C">C</option>
                                        <option value="M">M</option>
                                        <option value="N">N</option>
                                    </select>
                                </div>
                            </div>

                            <input
                                ref={empInputRef}
                                className="form-control text-center mb-2"
                                style={{ width: "250px", textTransform: "uppercase", fontSize: "1.1rem" }}
                                placeholder={isSubmitting ? "Verifying..." : "Scan Employee ID..."}
                                value={operatorCode}
                                disabled={isSubmitting}
                                onChange={(e) => setOperatorCode(e.target.value.toUpperCase())}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleScanComplete(operatorCode);
                                    }
                                }}
                            />

                            <button
                                className="btn btn-primary mt-2 w-50"
                                onClick={() => handleScanComplete(operatorCode)}
                                disabled={isSubmitting || operatorCode.length < 3}
                            >
                                <i className="fas fa-sign-in-alt me-2"></i>
                                Login
                            </button>
                        </div>
                    )}

                    {/* ✅ Content - History Mode */}
                    {activeTab === 'history' && (
                        <div className="d-flex flex-column justify-content-center align-items-center text-center fade-in">

                            <div className="mb-4">
                                <label className="form-label mb-1 fw-bold">Select date to view data</label>
                                <input
                                    type="date"
                                    className="form-control text-center border-primary"
                                    style={{ width: "220px", fontSize: "1.1rem" }}
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                />
                            </div>

                            <button
                                className="btn btn-outline-primary w-50 fw-bold"
                                onClick={() => {
                                    // Redirect to Machine Working with Selected Date
                                    // Close Modal
                                    const modalEl = document.getElementById("modalMachine");
                                    const modal = (window as any).bootstrap.Modal.getInstance(modalEl);
                                    if (modal) modal.hide();
                                    document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());

                                    // ต้อง Clear LocalStorage ที่เกี่ยวข้องกับ Operator ทิ้ง เพื่อให้เป็นโหมดดูอย่างเดียว
                                    localStorage.removeItem("operatorLocal");
                                    localStorage.setItem("machineNameLocal", machine);
                                    localStorage.setItem("machineDateLocal", selectedDate);

                                    router.push(`/machine_working?machine_name=${machine}&date=${selectedDate}`);
                                }}
                            >
                                <i className="fas fa-eye me-2"></i>
                                View Data
                            </button>
                        </div>
                    )}

                    {isSubmitting && <div className="spinner-border text-primary mt-3" role="status"></div>}
                </div>
            </MyModal>
        </>
    )
};
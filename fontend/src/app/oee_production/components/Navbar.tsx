"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Navbar() {
    const router = useRouter();

    useEffect(() => {
        const collapsed = localStorage.getItem("sidebarCollapsed") === "1";
        if (collapsed) document.body.classList.add("sidebar-collapse");
    }, []);

    const toggleSidebar = () => {
        document.body.classList.toggle("sidebar-collapse");
        const collapsed = document.body.classList.contains("sidebar-collapse");
        localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
    };

    return (
        <nav
            className="main-header navbar navbar-expand shadow-sm"
            style={{
                backgroundColor: "#1E293B", // 🔹 สีพื้นหลังเหมือน Sidebar
                borderBottom: "1px solid #334155", // 🔹 เส้นแบ่งล่างสีเทาเข้ม
                color: "#E2E8F0", // 🔹 สีตัวอักษรเทาอ่อน
            }}
        >
            {/* 🔹 ปุ่ม Toggle Sidebar + หน้าหลัก */}
            <ul className="navbar-nav">
                <li className="nav-item">
                    <a
                        className="nav-link"
                        href="#"
                        data-widget="pushmenu"  // ✅ บอก AdminLTE ว่านี่คือปุ่ม toggle sidebar
                        onClick={toggleSidebar}
                        style={{
                            color: "#38BDF8",
                            transition: "color 0.2s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#60A5FA")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#38BDF8")}
                    >
                        <i className="fas fa-bars"></i>
                    </a>

                </li>

                <li className="nav-item d-none d-sm-inline-block">
                    <a
                        href="/oee_production/machine_area"
                        className="nav-link fw-semibold"
                        style={{
                            color: "#E2E8F0",
                            letterSpacing: "0.3px",
                            transition: "color 0.2s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#38BDF8")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#E2E8F0")}
                    >
                        หน้าหลัก
                    </a>
                </li>
            </ul>

            {/* 🔹 โลโก้หรือชื่อระบบด้านขวา (optional เพิ่มความสวย) */}
            <ul className="navbar-nav ms-auto me-3">
                <li className="nav-item">
                    <span
                        className="fw-bold"
                        style={{
                            color: "#38BDF8",
                            fontSize: "1rem",
                            letterSpacing: "0.5px",
                        }}
                    >
                        Production System
                    </span>
                </li>
            </ul>
        </nav>
    );
}

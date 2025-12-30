"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation"; // ✅ เพิ่มบนสุด
export default function Sidebar() {
    const router = useRouter();
    const [openMenu, setOpenMenu] = useState(false);
    const [prevCollapsed, setPrevCollapsed] = useState(false);
    const [mounted, setMounted] = useState(false); // ✅ เพิ่มบรรทัดนี้

    useEffect(() => {
        setMounted(true); // ✅ ให้ render หลังจาก client mount แล้วเท่านั้น
    }, []);

    // ✅ ตรวจจับ class "sidebar-collapse" แบบ real-time
    useEffect(() => {
        const interval = setInterval(() => {
            const collapsed = document.body.classList.contains("sidebar-collapse");

            // 🔸 ตรวจจับการเปลี่ยนสถานะ (จาก false -> true)
            if (collapsed && !prevCollapsed) {
                setOpenMenu(false);
            }

            setPrevCollapsed(collapsed);
        }, 100); // ตรวจทุก 0.1 วินาที

        return () => clearInterval(interval);
    }, [prevCollapsed]);

    // ✅ ปิด dropdown เมื่อเมาส์ออกจาก sidebar (เฉพาะตอนอยู่ในโหมดหุบแบบ hover)
    useEffect(() => {
        const sidebarEl = document.querySelector(".main-sidebar");
        if (!sidebarEl) return;

        const handleMouseLeave = () => {
            const isCollapsed = document.body.classList.contains("sidebar-collapse");
            const isOpenHover = document.body.classList.contains("sidebar-open");
            if (isCollapsed && !isOpenHover) {
                setOpenMenu(false);
            }
        };

        sidebarEl.addEventListener("mouseleave", handleMouseLeave);
        return () => {
            sidebarEl.removeEventListener("mouseleave", handleMouseLeave);
        };
    }, []);

    // ✅ เปิด dropdown อัตโนมัติเมื่ออยู่ใน path เดียวกัน
    useEffect(() => {
        if (typeof window !== "undefined") {
            const path = window.location.pathname;
            if (path.startsWith("/oee_production/production_planing")) {
                setOpenMenu(true);
            }
        }
    }, [router]);

    const pathname = usePathname(); // ✅ ใช้ตรวจ path ปัจจุบันแบบ reactive
    const isActive = (path: string) => pathname === path;

    return (
        <aside
            className="main-sidebar elevation-4"
            style={{
                backgroundColor: "#1E293B",
                color: "#E2E8F0",
                borderRight: "1px solid #334155",
                transition: "all 0.3s ease",
            }}
        >
            {/* 🔹 โลโก้ */}
            <a
                href="/"
                className="brand-link text-center"
                style={{
                    backgroundColor: "#0F172A",
                    borderBottom: "1px solid #334155",
                }}
            >
                <span
                    className="brand-text fw-bold"
                    style={{
                        fontSize: "1.4rem",
                        textDecoration: "none",
                        letterSpacing: "0.5px",
                        color: "#38BDF8",
                    }}
                >
                    Production System
                </span>
            </a>

            {/* 🔹 เมนูหลัก */}
            <div className="sidebar">
                <nav className="mt-2">
                    <ul
                        className="nav nav-pills nav-sidebar flex-column"
                        data-widget="treeview"
                        role="menu"
                    >
                        {/* 🔹 OEE Dashboard */}
                        <li className="nav-item">
                            <Link
                                href="/oee_production/machine_area"
                                className={`nav-link ${isActive("/oee_production/machine_area") ? "active" : ""
                                    }`}
                                style={{
                                    backgroundColor: isActive("/oee_production/machine_area")
                                        ? "#3B82F6"
                                        : "#334155",
                                    color: "#E2E8F0",
                                    marginBottom: "4px",
                                    borderRadius: "6px",
                                    transition: "all 0.2s ease",
                                }}
                            >
                                <i
                                    className="nav-icon fas fa-chart-line"
                                    style={{ color: "#60A5FA" }}
                                ></i>
                                <p style={{ marginLeft: "5px" }}>OEE Dashboard</p>
                            </Link>
                        </li>

                        <li className="nav-item">
                            <Link
                                href="/oee_production/production_planing"
                                className={`nav-link ${isActive("/oee_production/production_planing") ? "active" : ""
                                    }`}
                                style={{
                                    backgroundColor: isActive("/oee_production/production_planing")
                                        ? "#3B82F6"
                                        : "#334155",
                                    color: "#E2E8F0",
                                    marginBottom: "4px",
                                    borderRadius: "6px",
                                    transition: "all 0.2s ease",
                                }}
                            >
                                <i
                                    className="nav-icon fas fa-clipboard-list"
                                    style={{ color: "#60A5FA" }}
                                ></i>
                                <p style={{ marginLeft: "5px" }}>Production Planning</p>
                            </Link>
                        </li>

                        <li className="nav-item">
                            <Link
                                href="/oee_production/machine_report"
                                className={`nav-link ${isActive("/oee_production/machine_report") ? "active" : ""
                                    }`}
                                style={{
                                    backgroundColor: isActive("/oee_production/machine_report")
                                        ? "#3B82F6"
                                        : "#334155",
                                    color: "#E2E8F0",
                                    marginBottom: "4px",
                                    borderRadius: "6px",
                                    transition: "all 0.2s ease",
                                }}
                            >
                                <i
                                    className="nav-icon fas fa-chart-bar"
                                    style={{ color: "#60A5FA" }}
                                ></i>
                                <p style={{ marginLeft: "5px" }}>Machine Report</p>
                            </Link>
                        </li>
                    </ul>
                </nav>
            </div>
        </aside>
    );
}

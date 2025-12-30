// src/app/(dashboard)/layout.tsx
import "../../../public/plugins/fontawesome-free/css/all.min.css";
import "../../../public/plugins/tempusdominus-bootstrap-4/css/tempusdominus-bootstrap-4.min.css";
import "../../../public/dist/css/adminlte.min.css";

import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";

export default function DashboardLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <>
            <div className="hold-transition sidebar-mini layout-fixed">
                <div className="wrapper">
                    {/* Navbar */}
                    <Navbar />

                    {/* Sidebar */}
                    <Sidebar />

                    {/* Content Wrapper */}
                    <div className="content-wrapper">
                        <section className="content">
                            <div className="container-fluid">{children}</div>
                        </section>
                    </div>
                </div>
            </div>


        </>
    );
}

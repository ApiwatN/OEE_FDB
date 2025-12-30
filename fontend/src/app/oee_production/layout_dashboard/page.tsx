'use client';

import { useState, useEffect } from 'react';

// สีสำหรับแต่ละ Area
const areaColors: { [key: string]: { bg: string; border: string; header: string } } = {
    'DLC': { bg: '#FFF3E0', border: '#FF9800', header: '#E65100' },
    'ECM': { bg: '#E8F5E9', border: '#4CAF50', header: '#1B5E20' },
    'CLASS100': { bg: '#FFF8E1', border: '#FFC107', header: '#FF6F00' },
    'CLASS1000': { bg: '#FFEBEE', border: '#F44336', header: '#B71C1C' },
};

export default function LayoutDashboard() {
    const [activeButton, setActiveButton] = useState<string>('OUTPUT');
    const [isMobile, setIsMobile] = useState(false);

    // ตรวจสอบขนาดหน้าจอ
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const getAreaStyle = (area: string) => {
        return areaColors[area] || { bg: '#F5F5F5', border: '#9E9E9E', header: '#424242' };
    };

    // Component สำหรับแสดง Area Box
    const AreaBox = ({
        areaName,
        title,
        style: customStyle
    }: {
        areaName: string;
        title?: string;
        style?: React.CSSProperties;
    }) => {
        const colorStyle = getAreaStyle(areaName);

        return (
            <div
                style={{
                    backgroundColor: colorStyle.bg,
                    border: `2px solid ${colorStyle.border}`,
                    borderRadius: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    ...customStyle,
                }}
            >
                {/* Header */}
                <div
                    style={{
                        backgroundColor: colorStyle.header,
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: isMobile ? '0.65rem' : '0.75rem',
                        padding: isMobile ? '3px 6px' : '4px 8px',
                        borderRadius: '2px 2px 0 0',
                        flexShrink: 0,
                    }}
                >
                    {title || areaName} Area
                </div>
                {/* Content Placeholder */}
                <div
                    style={{
                        flex: 1,
                        padding: isMobile ? '4px' : '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '0.7rem',
                    }}
                >
                    {/* เครื่องจักรจะใส่ทีหลัง */}
                </div>
            </div>
        );
    };

    return (
        <div className="content">
            <div className="card mt-3">
                {/* Header - เหมือนหน้าอื่น */}
                <div
                    className="card-header d-flex flex-wrap align-items-center"
                    style={{
                        background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)",
                        borderBottom: "1px solid #e0e0e0",
                        position: "sticky",
                        top: 0,
                        zIndex: 1020,
                        gap: isMobile ? '8px' : '0',
                    }}
                >
                    {/* Left: Title with Icon */}
                    <div
                        className="d-flex align-items-center"
                        style={{
                            fontSize: isMobile ? "1.1rem" : "1.5rem",
                            fontWeight: 600,
                            flex: isMobile ? '1 1 100%' : 'auto',
                        }}
                    >
                        <i className="fas fa-border-all me-2 text-primary"></i>
                        <span>Layout Dashboard</span>
                    </div>

                    {/* Right: Buttons */}
                    <div
                        className="d-flex gap-2"
                        style={{
                            marginLeft: isMobile ? '0' : 'auto',
                            flexWrap: 'wrap',
                        }}
                    >
                        <button
                            className={`btn btn-sm ${activeButton === 'OUTPUT' ? 'btn-primary' : 'btn-outline-secondary'}`}
                            onClick={() => setActiveButton('OUTPUT')}
                            style={{ minWidth: isMobile ? '60px' : '80px', fontSize: isMobile ? '0.7rem' : '0.875rem' }}
                        >
                            Output
                        </button>
                        <button
                            className={`btn btn-sm ${activeButton === 'EFFICIENCY' ? 'btn-success' : 'btn-outline-secondary'}`}
                            onClick={() => setActiveButton('EFFICIENCY')}
                            style={{ minWidth: isMobile ? '60px' : '80px', fontSize: isMobile ? '0.7rem' : '0.875rem' }}
                        >
                            Efficiency
                        </button>
                        <button
                            className={`btn btn-sm ${activeButton === 'CYCLE_TIME' ? 'btn-warning' : 'btn-outline-secondary'}`}
                            onClick={() => setActiveButton('CYCLE_TIME')}
                            style={{ minWidth: isMobile ? '70px' : '80px', fontSize: isMobile ? '0.7rem' : '0.875rem' }}
                        >
                            Cycle Time
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div
                    className="card-body p-2"
                    style={{
                        height: isMobile ? 'auto' : 'calc(100vh - 140px)',
                        minHeight: isMobile ? 'calc(100vh - 180px)' : 'auto',
                        overflow: isMobile ? 'auto' : 'hidden',
                    }}
                >
                    {/* Main Layout */}
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: isMobile ? 'column' : 'row',
                            gap: '6px',
                            height: isMobile ? 'auto' : '100%',
                        }}
                    >

                        {/* Left Section: DLC + ECM + CLASS1000 */}
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                                width: isMobile ? '100%' : '30%',
                                minWidth: isMobile ? 'auto' : '250px',
                                height: isMobile ? 'auto' : '100%',
                            }}
                        >

                            {/* Row 1: DLC + ECM */}
                            <div
                                style={{
                                    display: 'flex',
                                    gap: '6px',
                                    height: isMobile ? '150px' : '65%',
                                }}
                            >
                                <AreaBox
                                    areaName="DLC"
                                    style={{ flex: 1, height: '100%' }}
                                />
                                <AreaBox
                                    areaName="ECM"
                                    style={{ flex: 1, height: '100%' }}
                                />
                            </div>

                            {/* Row 2: CLASS1000 */}
                            <AreaBox
                                areaName="CLASS1000"
                                title="Class 1000"
                                style={{ height: isMobile ? '100px' : 'calc(35% - 6px)' }}
                            />
                        </div>

                        {/* Right Section: CLASS100 */}
                        <AreaBox
                            areaName="CLASS100"
                            title="Class 100"
                            style={{
                                width: isMobile ? '100%' : '70%',
                                height: isMobile ? '300px' : '100%',
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

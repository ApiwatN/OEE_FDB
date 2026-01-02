'use client';

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import config from '@/app/config';

const apiServer = config.apiServer;

// สีสำหรับแต่ละ Area
const areaColors: { [key: string]: { bg: string; border: string; header: string } } = {
    'DLC': { bg: '#E3F2FD', border: '#2196F3', header: '#1565C0' },
    'ECM': { bg: '#E8F5E9', border: '#4CAF50', header: '#1B5E20' },
    'CLASS100': { bg: '#FFF3E0', border: '#FF9800', header: '#E65100' },
    'CLASS1000': { bg: '#F3E5F5', border: '#9C27B0', header: '#7B1FA2' },
};

// Grid Configuration
const GRID_CONFIG = {
    DLC: { cols: 3, rows: 8 },
    ECM: { cols: 3, rows: 8 },
    CLASS1000: { cols: 6, rows: 5 },
    CLASS100: { cols: 15, rows: 15 },
};

// Machine Position Map - กำหนดตำแหน่งเครื่องในแต่ละ Area (ชื่อตรงกับ database)
// Format: { [machineName]: { row: number, col: number } }
const MACHINE_POSITIONS: { [area: string]: { [machineName: string]: { row: number; col: number } } } = {
    DLC: {
        'Chydos1': { row: 0, col: 0 }, 'DLC-002': { row: 0, col: 1 }, 'DLC-009': { row: 0, col: 2 },
        'Chydos2': { row: 1, col: 0 }, 'DLC-003': { row: 1, col: 1 }, 'DLC-010': { row: 1, col: 2 },
        'DLC-004': { row: 2, col: 1 }, 'DLC-011': { row: 2, col: 2 },
        'DLC-005': { row: 3, col: 1 }, 'DLC-012': { row: 3, col: 2 },
        'DLC-006': { row: 4, col: 0 },
        'DLC-007': { row: 6, col: 0 },
        'DLC-008': { row: 7, col: 0 },
    },
    ECM: {
        'ACR-001': { row: 0, col: 0 }, 'AHV-001': { row: 0, col: 1 }, 'AQS-009': { row: 0, col: 2 },
        'ACR-002': { row: 1, col: 0 }, 'AHV-002': { row: 1, col: 1 },
        'ACR-003': { row: 2, col: 0 }, 'AHV-003': { row: 2, col: 1 }, 'AVE-001': { row: 2, col: 2 },
        'ACR-004': { row: 3, col: 0 }, 'AHV-004': { row: 3, col: 1 },
        'ACR-005': { row: 4, col: 0 }, 'AHV-005': { row: 4, col: 1 }, 'WTM-001': { row: 4, col: 2 },
        'ACR-006': { row: 5, col: 0 }, 'AHV-006': { row: 5, col: 1 }, 'WTM-002': { row: 5, col: 2 },
    },
    CLASS1000: {
        'ACI-001': { row: 0, col: 0 }, 'ASI-001': { row: 0, col: 1 }, 'LSM-003': { row: 0, col: 2 }, 'WSM-001': { row: 0, col: 4 }, 'VCM-001': { row: 0, col: 5 },
        'ACI-002': { row: 1, col: 0 }, 'ASI-002': { row: 1, col: 1 }, 'LSM-004': { row: 1, col: 2 }, 'WSM-002': { row: 1, col: 4 }, 'VCM-002': { row: 1, col: 5 },
        'ACI-003': { row: 2, col: 0 }, 'ASI-003': { row: 2, col: 1 }, 'LSM-006': { row: 2, col: 2 },
    },
    CLASS100: {
        // Row 0
        'ABR-001': { row: 0, col: 0 }, 'ACP-002': { row: 0, col: 1 }, 'AIU-001': { row: 0, col: 2 }, 'ARA-001': { row: 0, col: 3 }, 'ATX-001': { row: 0, col: 4 },
        'GE2-001': { row: 0, col: 5 }, 'GE2-016': { row: 0, col: 6 }, 'GES-001': { row: 0, col: 7 }, 'HEL-001': { row: 0, col: 8 }, 'HEL-040': { row: 0, col: 9 },
        'LSM-001': { row: 0, col: 10 }, 'LSW-001': { row: 0, col: 11 }, 'LSW-028': { row: 0, col: 12 }, 'VNS-001': { row: 0, col: 13 }, 'VNS-016': { row: 0, col: 14 },
        // Row 1
        'ABR-002': { row: 1, col: 0 }, 'ACP-003': { row: 1, col: 1 }, 'AIU-002': { row: 1, col: 2 }, 'ARA-002': { row: 1, col: 3 }, 'ATX-002': { row: 1, col: 4 },
        'GE2-002': { row: 1, col: 5 }, 'GE3-017': { row: 1, col: 6 }, 'GES-003': { row: 1, col: 7 }, 'HEL-002': { row: 1, col: 8 }, 'HEL-041': { row: 1, col: 9 },
        'LSM-002': { row: 1, col: 10 }, 'LSW-002': { row: 1, col: 11 }, 'LSW-029': { row: 1, col: 12 }, 'VNS-002': { row: 1, col: 13 }, 'VNS-017': { row: 1, col: 14 },
        // Row 2
        'ABR-003': { row: 2, col: 0 }, 'ACP-004': { row: 2, col: 1 }, 'ART-004': { row: 2, col: 3 }, 'ATX-003': { row: 2, col: 4 },
        'GE2-003': { row: 2, col: 5 }, 'GE2-018': { row: 2, col: 6 }, 'GES-007': { row: 2, col: 7 }, 'HEL-003': { row: 2, col: 8 }, 'HEL-043': { row: 2, col: 9 },
        'LSM-005': { row: 2, col: 10 }, 'LSW-003': { row: 2, col: 11 }, 'LSW-030': { row: 2, col: 12 }, 'VNS-003': { row: 2, col: 13 }, 'VNS-018': { row: 2, col: 14 },
        // Row 3
        'ABR-004': { row: 3, col: 0 }, 'ACP-005': { row: 3, col: 1 }, 'ART-005': { row: 3, col: 3 }, 'ATX-004': { row: 3, col: 4 },
        'GE2-004': { row: 3, col: 5 }, 'GE2-019': { row: 3, col: 6 }, 'GES-008': { row: 3, col: 7 }, 'HEL-004': { row: 3, col: 8 }, 'HEL-044': { row: 3, col: 9 },
        'LSW-004': { row: 3, col: 11 }, 'LSW-031': { row: 3, col: 12 }, 'VNS-004': { row: 3, col: 13 }, 'VNS-019': { row: 3, col: 14 },
        // Row 4
        'ABR-005': { row: 4, col: 0 }, 'ACP-006': { row: 4, col: 1 }, 'ART-009': { row: 4, col: 3 },
        'GE2-005': { row: 4, col: 5 }, 'GE2-020': { row: 4, col: 6 }, 'GES-009': { row: 4, col: 7 }, 'HEL-005': { row: 4, col: 8 }, 'HEL-046': { row: 4, col: 9 },
        'LSW-005': { row: 4, col: 11 }, 'LSW-032': { row: 4, col: 12 }, 'VNS-005': { row: 4, col: 13 }, 'VNS-020': { row: 4, col: 14 },
        // Row 5
        'ABR-006': { row: 5, col: 0 }, 'ACP-007': { row: 5, col: 1 }, 'ART-010': { row: 5, col: 3 },
        'GE2-006': { row: 5, col: 5 }, 'GE2-021': { row: 5, col: 6 }, 'GES-010': { row: 5, col: 7 }, 'HEL-006': { row: 5, col: 8 }, 'HEL-047': { row: 5, col: 9 },
        'LSW-006': { row: 5, col: 11 }, 'LSW-033': { row: 5, col: 12 }, 'VNS-006': { row: 5, col: 13 }, 'VNS-021': { row: 5, col: 14 },
        // Row 6
        'ACP-008': { row: 6, col: 1 }, 'ART-011': { row: 6, col: 3 },
        'GE2-007': { row: 6, col: 5 }, 'GE2-022': { row: 6, col: 6 }, 'HEL-007': { row: 6, col: 8 }, 'HEL-048': { row: 6, col: 9 },
        'LSW-009': { row: 6, col: 11 }, 'LSW-034': { row: 6, col: 12 }, 'VNS-007': { row: 6, col: 13 }, 'VNS-022': { row: 6, col: 14 },
        // Row 7
        'ACP-009': { row: 7, col: 1 }, 'ART-013': { row: 7, col: 3 },
        'GE2-008': { row: 7, col: 5 }, 'GE2-033': { row: 7, col: 6 }, 'HEL-017': { row: 7, col: 8 }, 'HEL-049': { row: 7, col: 9 },
        'LSW-017': { row: 7, col: 11 }, 'LSW-035': { row: 7, col: 12 }, 'VNS-008': { row: 7, col: 13 }, 'VNS-023': { row: 7, col: 14 },
        // Row 8
        'ACP-010': { row: 8, col: 1 }, 'AOC-001': { row: 8, col: 2 }, 'ART-015': { row: 8, col: 3 },
        'GE2-009': { row: 8, col: 5 }, 'GE2-034': { row: 8, col: 6 }, 'HEL-018': { row: 8, col: 8 }, 'HEL-050': { row: 8, col: 9 },
        'LSW-019': { row: 8, col: 11 }, 'VNS-009': { row: 8, col: 13 }, 'VNS-024': { row: 8, col: 14 },
        // Row 9
        'ACP-011': { row: 9, col: 1 }, 'AOC-002': { row: 9, col: 2 }, 'ART-016': { row: 9, col: 3 },
        'GE2-010': { row: 9, col: 5 }, 'GE2-035': { row: 9, col: 6 }, 'HEL-025': { row: 9, col: 8 }, 'HEL-051': { row: 9, col: 9 },
        'LSW-024': { row: 9, col: 11 }, 'VNS-010': { row: 9, col: 13 }, 'VNS-025': { row: 9, col: 14 },
        // Row 10
        'ACP-012': { row: 10, col: 1 }, 'AOC-003': { row: 10, col: 2 }, 'ART-018': { row: 10, col: 3 },
        'GE2-011': { row: 10, col: 5 }, 'GE2-036': { row: 10, col: 6 }, 'HEL-028': { row: 10, col: 8 }, 'HEL-052': { row: 10, col: 9 },
        'LSW-025': { row: 10, col: 11 }, 'VNS-012': { row: 10, col: 13 }, 'VNS-026': { row: 10, col: 14 },
        // Row 11
        'AFU-002': { row: 11, col: 0 }, 'AOC-004': { row: 11, col: 2 }, 'ART-019': { row: 11, col: 3 },
        'GE2-012': { row: 11, col: 5 }, 'GE2-038': { row: 11, col: 6 }, 'HEL-030': { row: 11, col: 8 }, 'HEL-053': { row: 11, col: 9 },
        'LSW-026': { row: 11, col: 11 },
        // Row 12
        'AFU-003': { row: 12, col: 0 }, 'AOC-005': { row: 12, col: 2 }, 'ART-021': { row: 12, col: 3 },
        'GE2-013': { row: 12, col: 5 }, 'GE2-039': { row: 12, col: 6 }, 'HEL-032': { row: 12, col: 8 }, 'HEL-055': { row: 12, col: 9 },
        'LSW-027': { row: 12, col: 11 }, 'VNS-013': { row: 12, col: 13 },
        // Row 13
        'AFU-004': { row: 13, col: 0 }, 'AOC-006': { row: 13, col: 2 },
        'GE2-014': { row: 13, col: 5 }, 'GE2-040': { row: 13, col: 6 }, 'HEL-033': { row: 13, col: 8 }, 'HEL-056': { row: 13, col: 9 },
        'VNS-014': { row: 13, col: 13 },
        // Row 14
        'AOC-007': { row: 14, col: 2 }, 'FSPZ': { row: 14, col: 4 },
        'HEL-036': { row: 14, col: 8 }, 'HEL-057': { row: 14, col: 9 },
        'VNS-015': { row: 14, col: 13 },
    }
};

interface MachineData {
    id: number;
    area: string;
    type: string;
    name: string;
    model: string;
    process: string;
    output: number | string;
    efficiency: number | string;
    cycleTime: number | string;
}

export default function LayoutDashboard() {
    const router = useRouter();
    const [activeButton, setActiveButton] = useState<string>('OUTPUT');
    const [isMobile, setIsMobile] = useState(false);
    const [cellHeight, setCellHeight] = useState(0);
    const [machinesData, setMachinesData] = useState<MachineData[]>([]);
    const [selectedMachine, setSelectedMachine] = useState<MachineData | null>(null);
    const [showPopup, setShowPopup] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const class100Ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // ดึงข้อมูลเครื่องจักร
    useEffect(() => {
        const fetchMachines = async () => {
            try {
                const res = await axios.get(`${apiServer}/api/machine/getMachinesWithTodayData`);
                setMachinesData(res.data.results || []);
            } catch (error) {
                console.error('Error fetching machines:', error);
            }
        };
        fetchMachines();
    }, []);

    // คำนวณความสูงของ cell จาก CLASS100
    useEffect(() => {
        const calculateCellHeight = () => {
            if (class100Ref.current) {
                const containerHeight = class100Ref.current.clientHeight;
                const headerHeight = 28;
                const padding = 8;
                const availableHeight = containerHeight - headerHeight - padding;
                const gap = 2; // gap ระหว่างแถว
                const totalGap = gap * (GRID_CONFIG.CLASS100.rows - 1);
                const height = (availableHeight - totalGap) / GRID_CONFIG.CLASS100.rows;
                setCellHeight(height);
            }
        };
        calculateCellHeight();
        window.addEventListener('resize', calculateCellHeight);
        return () => window.removeEventListener('resize', calculateCellHeight);
    }, []);

    const getAreaStyle = (area: string) => {
        return areaColors[area] || { bg: '#F5F5F5', border: '#9E9E9E', header: '#424242' };
    };

    // หาข้อมูลเครื่องจักรตาม name และ area
    const getMachineByPosition = (area: string, row: number, col: number): MachineData | undefined => {
        const positions = MACHINE_POSITIONS[area];
        if (!positions) return undefined;

        const machineName = Object.keys(positions).find(name => {
            const pos = positions[name];
            return pos.row === row && pos.col === col;
        });

        if (!machineName) return undefined;
        return machinesData.find(m => m.name === machineName);
    };

    // Machine Card Component - แสดงในช่อง grid ขนาดเล็ก
    const MachineCard = ({ machine }: { machine: MachineData }) => {
        const getValue = () => {
            switch (activeButton) {
                case 'OUTPUT': return machine.output !== '--' ? `${machine.output}` : '--';
                case 'EFFICIENCY': return machine.efficiency !== '--' ? `${(machine.efficiency as number).toFixed(0)}%` : '--';
                case 'CYCLE_TIME': return machine.cycleTime !== '--' ? `${(machine.cycleTime as number).toFixed(1)}` : '--';
                default: return '--';
            }
        };

        return (
            <div
                onClick={(e) => {
                    setSelectedMachine(machine);
                    setPopoverPosition({ x: e.clientX, y: e.clientY });
                    setShowPopup(true);
                }}
                style={{
                    backgroundColor: '#fff',
                    borderRadius: '2px',
                    padding: '1px',
                    cursor: 'pointer',
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    fontSize: '6px',
                    lineHeight: 1.15,
                    boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,0.3)';
                    e.currentTarget.style.zIndex = '10';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
                    e.currentTarget.style.zIndex = '1';
                }}
            >
                {/* Machine Name - Header */}
                <div style={{
                    fontWeight: 'bold',
                    borderBottom: '1px solid #ddd',
                    paddingBottom: '1px',
                    marginBottom: '1px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontSize: '7px',
                }}>
                    {machine.name}
                </div>
                {/* Content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#666' }}>
                        {machine.model}
                    </div>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#666' }}>
                        {machine.process}
                    </div>
                    <div style={{ fontWeight: 'bold', color: '#1565C0', fontSize: '7px' }}>
                        {getValue()}
                    </div>
                </div>
            </div>
        );
    };

    // สร้าง Grid cells พร้อม Machine Cards
    const renderGrid = (areaName: string, cols: number, rows: number, useDynamicHeight: boolean) => {
        const cells = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const machine = getMachineByPosition(areaName, r, c);
                cells.push(
                    <div
                        key={`${r}-${c}`}
                        style={{
                            backgroundColor: 'transparent',
                            height: useDynamicHeight && cellHeight > 0 ? `${cellHeight}px` : 'auto',
                            padding: '1px',
                            overflow: 'hidden',
                        }}
                    >
                        {machine && <MachineCard machine={machine} />}
                    </div>
                );
            }
        }
        return cells;
    };

    // Area Box Component
    const AreaBox = ({
        areaName,
        title,
        style: customStyle,
        innerRef,
        useDynamicHeight = true,
    }: {
        areaName: string;
        title?: string;
        style?: React.CSSProperties;
        innerRef?: React.RefObject<HTMLDivElement | null>;
        useDynamicHeight?: boolean;
    }) => {
        const colorStyle = getAreaStyle(areaName);
        const gridConfig = GRID_CONFIG[areaName as keyof typeof GRID_CONFIG] || { cols: 1, rows: 1 };

        return (
            <div
                ref={innerRef}
                style={{
                    backgroundColor: colorStyle.bg,
                    border: `2px solid ${colorStyle.border}`,
                    borderRadius: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    ...customStyle,
                }}
            >
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
                <div
                    style={{
                        flex: useDynamicHeight ? 'none' : 1,
                        padding: '4px',
                        display: 'grid',
                        gridTemplateColumns: `repeat(${gridConfig.cols}, 1fr)`,
                        gridTemplateRows: useDynamicHeight && cellHeight > 0
                            ? `repeat(${gridConfig.rows}, ${cellHeight}px)`
                            : `repeat(${gridConfig.rows}, 1fr)`,
                        gap: '2px',
                    }}
                >
                    {renderGrid(areaName, gridConfig.cols, gridConfig.rows, useDynamicHeight)}
                </div>
            </div>
        );
    };

    // Popover Component - แสดงใกล้ตำแหน่งที่คลิก
    const Popover = () => {
        if (!showPopup || !selectedMachine) return null;

        // คำนวณตำแหน่ง popover ให้ไม่ล้นออกนอกหน้าจอ
        const popoverWidth = 160;
        const popoverHeight = 120;
        let left = popoverPosition.x + 10;
        let top = popoverPosition.y - 20;

        // ป้องกันล้นขวา
        if (left + popoverWidth > window.innerWidth) {
            left = popoverPosition.x - popoverWidth - 10;
        }
        // ป้องกันล้นล่าง
        if (top + popoverHeight > window.innerHeight) {
            top = window.innerHeight - popoverHeight - 10;
        }
        // ป้องกันล้นบน
        if (top < 10) {
            top = 10;
        }

        return (
            <>
                {/* Overlay เพื่อปิด popover เมื่อคลิกข้างนอก */}
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        zIndex: 9998,
                    }}
                    onClick={() => setShowPopup(false)}
                />
                {/* Popover */}
                <div
                    style={{
                        position: 'fixed',
                        left: `${left}px`,
                        top: `${top}px`,
                        backgroundColor: '#fff',
                        borderRadius: '8px',
                        padding: '8px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                        zIndex: 9999,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px', borderBottom: '1px solid #eee', paddingBottom: '4px', textAlign: 'center' }}>
                        {selectedMachine.name}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                                router.push(`/oee_production/layout_dashboard/daily_report/${selectedMachine.id}`);
                                setShowPopup(false);
                            }}
                            style={{ flex: 1, fontSize: '12px' }}
                        >
                            Daily
                        </button>
                        <button
                            className="btn btn-success btn-sm"
                            onClick={() => {
                                router.push(`/oee_production/layout_dashboard/monthly_report/${selectedMachine.id}`);
                                setShowPopup(false);
                            }}
                            style={{ flex: 1, fontSize: '12px' }}
                        >
                            Monthly
                        </button>
                    </div>
                </div>
            </>
        );
    };

    return (
        <div className="content">
            <Popover />
            <div className="card mt-1" style={{ height: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div
                    className="card-header d-flex flex-wrap align-items-center"
                    style={{
                        background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)",
                        borderBottom: "1px solid #e0e0e0",
                        position: "sticky",
                        top: 0,
                        zIndex: 1020,
                        gap: isMobile ? '8px' : '0',
                        padding: '4px 12px',
                    }}
                >
                    <div
                        className="d-flex align-items-center"
                        style={{
                            fontSize: isMobile ? "1rem" : "1.25rem",
                            fontWeight: 600,
                            flex: isMobile ? '1 1 100%' : 'auto',
                        }}
                    >
                        <i className="fas fa-border-all me-2 text-primary"></i>
                        <span>Layout Dashboard</span>
                    </div>

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
                        flex: 1,
                        height: 'auto',
                        overflow: 'hidden',
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
                                flex: isMobile ? 'none' : '6',
                                width: isMobile ? '100%' : 'auto',
                                minWidth: isMobile ? 'auto' : '180px',
                            }}
                        >
                            {/* Row 1: DLC + ECM */}
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <AreaBox areaName="DLC" style={{ flex: 1 }} />
                                <AreaBox areaName="ECM" style={{ flex: 1 }} />
                            </div>

                            {/* Row 2: CLASS1000 */}
                            <AreaBox
                                areaName="CLASS1000"
                                title="Class 1000"
                                style={{ marginTop: '6px', flex: 1 }}
                            />
                        </div>

                        {/* Right Section: CLASS100 */}
                        <AreaBox
                            areaName="CLASS100"
                            title="Class 100"
                            innerRef={class100Ref}
                            useDynamicHeight={true}
                            style={{
                                flex: isMobile ? 'none' : '15',
                                height: isMobile ? '400px' : '100%',
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function MonthlyReportContent() {
    const searchParams = useSearchParams();
    const machineName = searchParams.get('machine') || 'Unknown';

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            padding: '20px',
        }}>
            <div style={{
                backgroundColor: '#fff',
                borderRadius: '8px',
                padding: '40px 60px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                textAlign: 'center',
            }}>
                <i className="fas fa-calendar-alt" style={{ fontSize: '48px', color: '#28a745', marginBottom: '20px' }}></i>
                <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', marginBottom: '10px' }}>
                    Monthly Report
                </h1>
                <h2 style={{ fontSize: '24px', color: '#28a745', marginBottom: '20px' }}>
                    {machineName}
                </h2>
                <p style={{ color: '#666', fontSize: '14px' }}>
                    (Coming Soon)
                </p>
            </div>
        </div>
    );
}

export default function MonthlyReportPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <MonthlyReportContent />
        </Suspense>
    );
}

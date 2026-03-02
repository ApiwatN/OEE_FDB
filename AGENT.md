# AGENT.md — OEE Dashboard System

> เอกสารนี้สำหรับ AI Agent / Model ที่เข้ามาทำงานต่อ เพื่อให้เข้าใจ Architecture, Conventions, และ Data Flow ของระบบได้อย่างรวดเร็ว

---

## 📁 Project Structure

```
OEE_FDB_new/
├── backend/                  # Express.js API Server
│   ├── server.js             # Entry point — serves static frontend + API routes
│   ├── .env                  # Environment config (DB, InfluxDB, Cron, Port)
│   ├── controllers/          # API route handlers
│   │   ├── OeeDashboardController.js   # OEE data (getDataTable, getGraph1, getGraph2, getLastOEE)
│   │   ├── MachineController.js        # Machine CRUD + getMachinesWithTodayData (Layout Dashboard)
│   │   ├── HistoryWorkingController.js # Operator login/logout, work history
│   │   ├── OutputTargetController.js   # Production targets (hourly, daily)
│   │   ├── ModelController.js          # Model master data
│   │   └── ReportController.js         # Daily/Monthly reports
│   ├── services/             # Background services
│   │   ├── realtimeService.js   # ⚡ Polls InfluxDB every 5s → emits Socket.IO "realtime_update"
│   │   ├── cacheService.js      # 🗂️ In-memory cache (reduces MSSQL load)
│   │   ├── cronService.js       # ⏰ Hourly summary, late data recovery, daily rollover
│   │   └── influxService.js     # 📊 InfluxDB 1.x query client
│   ├── utils/
│   │   └── timeUtils.js         # UTC ↔ TH time conversion, shift hours, boundaries
│   └── prisma/               # Prisma ORM schema (MSSQL)
│
├── fontend/                  # Next.js Frontend (⚠️ typo "fontend" — DO NOT rename)
│   ├── src/app/
│   │   ├── config.tsx            # API server URL (apiServer: "" = same origin)
│   │   ├── machine_working/      # Single machine detail page (real-time)
│   │   ├── overall_machine_working/  # Multi-machine overview (real-time)
│   │   ├── oee_production/
│   │   │   ├── machine_area/         # Machine selection page (Area + Type filter)
│   │   │   ├── layout_dashboard/     # Factory floor layout (real-time grid)
│   │   │   ├── production_planing/   # Target planning input
│   │   │   ├── daily_report/         # Daily OEE report
│   │   │   ├── monthly_report/       # Monthly OEE report
│   │   │   └── machine_report/       # Machine-specific report
│   │   └── components/
│   │       └── Overall_machine_working.tsx  # OverallMachineCard component
│   ├── out/                  # ⚠️ Static export (served by backend!)
│   └── next.config.ts        # output: 'export' (static site generation)
│
└── Python_auto_create_plan/  # Python scripts for auto-creating production plans
```

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         InfluxDB 1.x                            │
│                    (machine_db.data_tb)                         │
│               Real-time sensor data from PLCs                   │
└──────────────────┬──────────────────────────────────────────────┘
                   │ Query every 5s
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Express.js :5005)                   │
│                                                                 │
│  realtimeService ──poll──▶ InfluxDB ──▶ merge with cache        │
│       │                                    │                    │
│       ▼                                    ▼                    │
│  Socket.IO emit ◀──── "realtime_update" ◀── payload per machine │
│       │                                                         │
│  cronService ──hourly──▶ InfluxDB ──▶ upsert MSSQL + cache     │
│                                                                 │
│  cacheService ──── In-memory cache (output, CT, eff per hour)   │
│                                                                 │
│  API Routes ──── /api/oee/*, /api/machine/*, /api/historyWorking│
│                                                                 │
│  Static Files ◀── fontend/out/ (Next.js static export)          │
└──────────────┬──────────────────────────────────────────────────┘
               │ Socket.IO + REST API
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Frontend (Next.js Static Export)                │
│                                                                 │
│  machine_working/page.tsx ─── Single machine (graphs + table)   │
│  overall_machine_working/page.tsx ─── Multi-machine cards       │
│  layout_dashboard/page.tsx ─── Factory floor grid               │
│  machine_area/page.tsx ─── Machine selection (Area + Type)      │
└─────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ Critical Rules

### 1. Frontend Build Required
```bash
# Backend serves STATIC files from fontend/out/
# Any .tsx change requires rebuild:
cd fontend
npm run build

# Then restart backend:
cd ../backend
node --watch server.js
```
**Source code changes in `fontend/src/` do NOT take effect until `npm run build`!**

### 2. Backend Changes Auto-Reload
```bash
# Backend uses --watch mode
node --watch server.js
# Changes to .js files auto-restart (no manual action needed)
```

### 3. Folder Name Typo
The frontend folder is named `fontend` (NOT `frontend`). **DO NOT rename it** — paths are hardcoded in `server.js`.

---

## 🕐 Time System

| Concept | Value |
|---|---|
| **Server timezone** | UTC |
| **Display timezone** | Thailand (UTC+7) |
| **Shift start** | 07:00 TH = 00:00 UTC |
| **Shift end** | 06:59 TH next day = 23:59 UTC |
| **Shift date** | = UTC date (e.g., UTC 2026-02-20 = Shift 07:00-06:59 TH) |
| **SHIFT_HOURS array** | `["07","08",...,"23","00","01",...,"06"]` (24 hours, TH display) |

**Key functions in `utils/timeUtils.js`:**
- `utcHourToThColumn(utcHour)` — UTC 0 → "07", UTC 17 → "00"
- `getShiftIndex(thColumn)` — "07" → 0, "00" → 17, "06" → 23
- `getShiftDateUTC()` — current UTC date as YYYY-MM-DD
- `getCurrentHourBoundaries(now)` — { dateStr, utcHour, thColumn, start, end }

---

## 📡 Real-time Data Flow

### Socket.IO Event: `realtime_update` (every 5 seconds)

**Source:** `realtimeService.js` → `pollAndEmit()`

**Payload structure:**
```javascript
{
  serverTimeUTC: "2026-02-20T01:30:00.000Z",
  shiftDate: "2026-02-20",
  currentHourTH: "08",              // TH column of current hour
  currentShiftIndex: 1,             // Index in SHIFT_HOURS array
  elapsedSeconds: 1800,             // Seconds passed in current hour
  machines: {
    "DLC-002": {
      currentHour: {
        hour: "08",                 // TH column
        shiftIndex: 1,
        output: 150,
        cycleTime: 2.35,
        efficiency: 85.5,
      },
      daily: {
        totalOutput: 300,
        accumTarget: 320,
        achieve: 93.75,             // (totalOutput / accumTarget) × 100
        avgCycleTime: 2.40,         // Weighted avg: Σ(CT×output) / Σ(output)
        overallEfficiency: 82.10,   // (totalOutput / theoreticalMax) × 100
        hourly: {
          output: [150, 150, 0, ...],      // Per-hour arrays (24 items)
          cycleTime: [2.45, 2.35, 0, ...],
          efficiency: [80.5, 85.5, 0, ...],
          outputAccum: [150, 300, 300, ...],
        }
      }
    },
    // ... more machines
  }
}
```

### How Each Page Consumes Real-time Data:

| Page | Initial Load | Real-time Update |
|---|---|---|
| `machine_working` | `fetchAllData()` → 6 API calls (MSSQL) | Socket handler directly updates `setTableData`, `setGraph1Data`, `setGraph2Data` |
| `overall_machine_working` | `OverallMachineCard.fetchAllData()` per card | `realtimeData` prop → `useEffect` merges into state |
| `layout_dashboard` | `fetchMachines()` → 1 API call | Socket handler merges `output/efficiency/cycleTime` into state |

**Rule: Pages MUST NOT re-fetch API on socket events. Use socket data to update state directly.**

---

## 🗄️ Database Schema (MSSQL via Prisma)

### Key Tables:
| Table | Purpose | Key Fields |
|---|---|---|
| `tbm_machine` | Machine master | `machine_name`, `machine_area`, `machine_type`, `status` |
| `tb_output_target` | Hourly production targets | `machine_name`, `date`, `target_07`...`target_06`, `model_name` |
| `tb_output_actual` | Hourly actual output | `machine_name`, `date`, `actual_07`...`actual_06` |
| `tb_cycle_time_actual` | Hourly cycle time | `machine_name`, `date`, `cycle_07`...`cycle_06` |
| `tb_efficiency_actual` | Hourly efficiency | `machine_name`, `date`, `eff_07`...`eff_06`, `eff_actual` |
| `tb_oee` | Daily OEE | `machine_name`, `date`, `oee_value` |
| `tb_history_working` | Operator work history | `machine_name`, `emp_no`, `date`, `start_time`, `end_time` |

**Column naming pattern:** `{prefix}_{TH_hour}` — e.g., `actual_07`, `cycle_13`, `eff_00`

---

## 📊 InfluxDB

| Config | Value |
|---|---|
| Host | `192.168.100.99:5012` |
| Database | `machine_db` |
| Measurement | `data_tb` |
| Fields | `output_count`, `cycle_time` |
| Tags | `machine_name` |

Queried by `influxService.js` for:
- Current hour data (every 5s by realtimeService)
- Previous hour summary (by cronService)

---

## 🧮 Key Calculations

### Efficiency Formula
```
totalValidSeconds = allPastHours × 3600 + elapsedSecondsInCurrentHour
theoreticalMax = totalValidSeconds / avgCycleTime
efficiency = (totalOutput / theoreticalMax) × 100
```
**Note:** `totalValidSeconds` counts ALL past hours (including idle), not just hours with output.

### Cycle Time (Weighted Average)
```
avgCycleTime = Σ(cycleTime × output) / Σ(output)
// Only includes hours where BOTH output > 0 AND cycleTime > 0
```

### Achieve
```
achieve = (totalOutput / accumTarget) × 100
// accumTarget = sum of hourly targets up to current hour (pro-rated for current hour)
```

---

## 🔧 Backend Services

### `realtimeService.js`
- Polls InfluxDB every 5s (configurable: `REALTIME_POLL_INTERVAL_MS`)
- Merges InfluxDB current-hour data with cache (past hours)
- Emits `realtime_update` to all Socket.IO clients
- Also broadcasts `server_time` every 1s

### `cacheService.js`
- In-memory cache per machine: `{ output, cycleTime, efficiency, overall }`
- Hydrated from MSSQL on startup
- Updated by cronService after each hour
- Provides `getAllMachinesCache()` for API fallback

### `cronService.js`
- **Hourly** (`CRON_HOURLY`): Summarize previous hour from InfluxDB → upsert MSSQL + update cache
- **Late data** (`CRON_LATE_DATA`): Check for missed data in past 48 hours
- **Daily rollover** (`CRON_DAILY_ROLLOVER`): Clear cache at shift change

### `influxService.js`
- InfluxDB 1.x client using `influx` npm package
- `queryAllMachinesForHour(start, end)` — GROUP BY machine_name
- Returns `{ machineName: { output_count, avg_cycle_time } }`

---

## 🖥️ Frontend Pages

### `machine_area/page.tsx`
- Machine selection with Area + Machine Type filters
- Area filter persisted in `localStorage.machineAreaLocal`
- Machine Type filter persisted in `localStorage.machineTypeFilterLocal`
- Opens modal for Scan (login) or History (view data)

### `machine_working/page.tsx`
- Single machine detail view (graphs + header table)
- Receives `machine_name` from localStorage or URL params
- Fetches data once, then updates from Socket.IO
- Handles date rollover on shift change

### `overall_machine_working/page.tsx`
- Grid of `OverallMachineCard` components
- Params: `area`, `type`, `date` (from URL query)
- Each card renders 2 graphs (Output + CT/Eff) and header stats
- Lazy loading: loads 6 cards at a time, scroll for more

### `layout_dashboard/page.tsx`
- Factory floor grid layout with positioned machine cards
- Shows output, efficiency, or cycle time (toggle buttons)
- Machine positions hardcoded in `MACHINE_POSITIONS` object per area

---

## 🔑 localStorage Keys

| Key | Used By | Purpose |
|---|---|---|
| `machineAreaLocal` | machine_area | Selected area filter |
| `machineTypeFilterLocal` | machine_area | Selected machine type filter |
| `machineNameLocal` | machine_working | Current machine name |
| `machineDateLocal` | machine_working | Current viewing date |
| `operatorLocal` | machine_working | Active operator ID (if logged in) |

---

## 🚀 Development Workflow

```bash
# Start backend (with auto-reload)
cd backend
node --watch server.js    # Runs on PORT from .env (default 5005)

# Frontend development
cd fontend
npm run dev               # Dev server (hot reload, for development only)
npm run build             # Build static export to out/ (REQUIRED for production)

# After frontend changes:
cd fontend && npm run build && cd ../backend
# Backend serves from fontend/out/ — restart needed to pick up new build
```

---

## 📋 API Routes

| Method | Route | Controller | Purpose |
|---|---|---|---|
| GET | `/api/oee/getDataTable` | OeeDashboardController | Header table data |
| GET | `/api/oee/getGraph1` | OeeDashboardController | Output graph data |
| GET | `/api/oee/getGraph2` | OeeDashboardController | CT & Efficiency graph data |
| GET | `/api/oee/getLastOEE` | OeeDashboardController | Latest OEE value |
| GET | `/api/oee/getModelsByDate` | OeeDashboardController | Models for a date |
| GET | `/api/machine/listArea` | MachineController | Distinct areas |
| GET | `/api/machine/listTypeWithMachines/:area` | MachineController | Types + machines by area |
| GET | `/api/machine/listMachines/:area/:type` | MachineController | Machine list for type |
| GET | `/api/machine/getMachinesWithTodayData` | MachineController | All machines + today's data |
| POST | `/api/historyWorking/createStartTime` | HistoryWorkingController | Start operator session |
| GET | `/api/historyWorking/getOperatorIdWorking/:name` | HistoryWorkingController | Active operator |
| GET | `/api/historyWorking/getHistoryByDate` | HistoryWorkingController | History for date |

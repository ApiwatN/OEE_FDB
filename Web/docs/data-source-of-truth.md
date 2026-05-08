# OEE Data Source of Truth

This project reads production data from three live/historical sources. Keep the rules below consistent across API controllers, realtime services, and report pages.

## Source Roles

| Source | Role | Typical Code | Notes |
| --- | --- | --- | --- |
| MSSQL via Prisma | Historical and official persisted data | `tb_output_actual`, `tb_output_target`, `tb_oee`, `tb_availability_actual`, `tb_cycle_time_actual`, `tb_machine_ng`, `tb_MCStatus` | Use for completed hours, historical reports, monthly reports, and user/manual updates. |
| InfluxDB | Current-hour production truth | `influxService.queryMachineForHour`, `queryAllMachinesForHour`, model/NG queries | Use only for the current open hour or live model/NG reads. Do not add current-hour Influx output on top of the same MSSQL/cache hour. Replace that hour. |
| MQTT memory | Live machine status and stopwatch state | `mqttService`, `memoryOeeService` | Use for realtime availability/status while the process is running. It is volatile and not a historical source. |

## Output Rules

1. Historical and closed hours use MSSQL `tb_output_actual`.
2. Current open hour uses InfluxDB when the requested date is the current shift date.
3. If MSSQL/cache already has a current-hour value, replace only that hour with InfluxDB current-hour output.
4. When `tb_output_actual` has both real model rows and `model_name = "--"` for the same hour, sum real model rows first. Use `"--"` only when no real row has output for that hour.
5. Shared helpers for output rules live in `backend/services/actualOutputService.js`.

## Target Rules

1. Output target uses `tb_output_target.target_HH`.
2. Dashboard current-time target can be prorated by elapsed minutes in the active hour.
3. Some machines deduct excluded statuses from target time by config in `backend/config/machine_calc.json`.
4. Availability target uses `availability_targets` config. If the config is `"eff_target"`, use `tb_output_target.eff_target`.

## Availability, Performance, Quality, OEE

Shared formula helpers live in `backend/services/oeeCalcService.js`.

| Metric | Rule |
| --- | --- |
| Availability | `runTime / (totalTime - excludedTime) * 100`, capped to `0..100`. |
| Performance | `(outputForOee * idealCycleTime) / runTime * 100`, capped to `0..150`. |
| Quality, visual NG mode | `(totalOutput - ngQty) / totalOutput * 100`, floored at `0`. |
| Quality, over reject mode | Always `100`; reject quantity is deducted before performance. |
| OEE | `availability * performance * quality / 10000`; use `0` if any component is missing or zero unless a stored fallback is intentionally used. |

## NG Rules

| Mode | Machines | Rule |
| --- | --- | --- |
| `visual_ng` | Default | `ng_qty` is visual/manual NG. Over reject is station total minus visual NG. |
| `over_reject` | Configured by prefix, for example ABR | Station total is over reject. `output_actual = machine_output_actual - over_reject`, `ng_qty = 0`, `quality = 100`. |

## API Expectations

| API/Flow | Primary Sources | Current-Hour Override |
| --- | --- | --- |
| Dashboard table and output graph | MSSQL/cache + InfluxDB | Yes, via `applyCurrentHourInfluxOverride`. |
| Layout machine cards | MSSQL/cache + InfluxDB | Yes, replace current hour before total. |
| Monthly machine report | MSSQL | No current-hour override unless realtime socket updates the visible current month. |
| Machine NG report | MSSQL | Realtime socket can merge current-month updates into visible data. |
| Realtime socket | InfluxDB + MQTT memory + cache + MSSQL fallback | Current hour comes from InfluxDB. |

## Implementation Guardrails

1. Do not reimplement hourly output fallback in controllers. Use `actualOutputService`.
2. Do not reimplement NG/OEE math in controllers. Use `oeeCalcService`.
3. Do not disconnect the singleton Socket.IO connection in pages. Use `useDashboardSocket` for dashboard-room consumers.
4. Any new report endpoint should state which source owns historical data and which source owns current-hour data.

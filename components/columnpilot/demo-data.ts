import type { ClickHouseQueryResult } from "@/lib/clickhouse/types";
import type { ColumnInfo, TableInfo } from "./types";

export const DEMO_TABLES: TableInfo[] = [
  { database: "columnpilot", name: "sensor_readings", engine: "MergeTree", total_rows: 148_200_000, total_bytes: 18_400_000_000 },
  { database: "columnpilot", name: "device_events", engine: "MergeTree", total_rows: 42_800_000, total_bytes: 6_700_000_000 },
  { database: "columnpilot", name: "maintenance_log", engine: "MergeTree", total_rows: 286_000, total_bytes: 92_000_000 },
];

export const DEMO_RESULT: ClickHouseQueryResult = {
  meta: [
    { name: "device_id", type: "String" },
    { name: "time", type: "DateTime64(3)" },
    { name: "metric", type: "LowCardinality(String)" },
    { name: "value", type: "Float64" },
    { name: "unit", type: "String" },
  ],
  data: [
    { device_id: "DV-0042", time: "2026-09-20 09:42:18", metric: "PS1", value: 148.72, unit: "bar" },
    { device_id: "DV-0042", time: "2026-09-20 09:42:18", metric: "TS1", value: 46.18, unit: "°C" },
    { device_id: "DV-0186", time: "2026-09-20 09:42:17", metric: "VS1", value: 1.92, unit: "mm/s" },
    { device_id: "DV-0107", time: "2026-09-20 09:42:17", metric: "FS1", value: 38.44, unit: "L/min" },
    { device_id: "DV-0186", time: "2026-09-20 09:42:16", metric: "EPS1", value: 2184, unit: "W" },
  ],
  rows: 5,
  statistics: { elapsed: 0.018, rows_read: 8231, bytes_read: 386112 },
};

export const DEMO_COLUMNS: ColumnInfo[] = DEMO_RESULT.meta.map((column, index) => ({
  name: column.name,
  type: column.type,
  position: index + 1,
  compression_codec: index === 1 ? "Delta, ZSTD" : "ZSTD",
}));

export const DEFAULT_SQL = `SELECT
  metric, avg(value) AS avg_value
FROM columnpilot.sensor_readings
WHERE time >= now() - INTERVAL 1 HOUR
GROUP BY metric
ORDER BY avg_value DESC
LIMIT 100`;

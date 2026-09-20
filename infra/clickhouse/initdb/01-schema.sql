CREATE TABLE IF NOT EXISTS sensor_readings
(
    time DateTime64(3, 'UTC'),
    device_id LowCardinality(String),
    metric LowCardinality(String),
    value Float64,
    unit LowCardinality(String),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(time)
ORDER BY (metric, device_id, time);

CREATE TABLE IF NOT EXISTS device_events
(
    time DateTime64(3, 'UTC'),
    device_id LowCardinality(String),
    event_type LowCardinality(String),
    severity Enum8('info' = 1, 'warning' = 2, 'critical' = 3),
    message String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(time)
ORDER BY (device_id, time, event_type);

CREATE TABLE IF NOT EXISTS maintenance_log
(
    event_time DateTime64(3, 'UTC'),
    device_id LowCardinality(String),
    action String,
    operator String,
    result LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (device_id, event_time);

-- First-run demo data only; the entrypoint skips this on existing volumes.
INSERT INTO sensor_readings (time, device_id, metric, value, unit) VALUES
    (now64(3) - INTERVAL 5 MINUTE, 'DV-0042', 'PS1', 148.72, 'bar'),
    (now64(3) - INTERVAL 4 MINUTE, 'DV-0042', 'TS1', 46.18, '°C'),
    (now64(3) - INTERVAL 3 MINUTE, 'DV-0186', 'VS1', 1.92, 'mm/s'),
    (now64(3) - INTERVAL 2 MINUTE, 'DV-0107', 'FS1', 38.44, 'L/min'),
    (now64(3) - INTERVAL 1 MINUTE, 'DV-0186', 'EPS1', 2184.0, 'W');

INSERT INTO device_events VALUES
    (now64(3) - INTERVAL 10 MINUTE, 'DV-0042', 'startup', 'info', 'Device entered normal operating mode'),
    (now64(3) - INTERVAL 2 MINUTE, 'DV-0186', 'vibration_threshold', 'warning', 'Vibration crossed the configured warning threshold');

INSERT INTO maintenance_log VALUES
    (now64(3) - INTERVAL 1 DAY, 'DV-0042', 'Pressure sensor inspection', 'demo', 'completed');

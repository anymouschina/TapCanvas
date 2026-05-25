-- Disable CPU/memory overload guard (threshold=0 means disabled in middleware/performance.go check: config.CPUThreshold > 0).
-- Only disk threshold is kept at 98%. Idempotent merge on the text-stored JSON.
UPDATE options
SET value = (value::jsonb || '{"monitor_cpu_threshold":0,"monitor_memory_threshold":0}'::jsonb)::text
WHERE key = 'performance_setting';

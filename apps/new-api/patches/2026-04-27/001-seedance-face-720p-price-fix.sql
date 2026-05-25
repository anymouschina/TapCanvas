-- 001-seedance-face-720p-price-fix.sql
-- Purpose: correct ModelPrice flat-rate for face models in new-api.
--          Original patch set both face models to 15/12 (per model, no resolution
--          distinction). Align with TapCanvas 720p target rates: face=14, fast-face=12.
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.

UPDATE options
SET value = (
  value::jsonb
  || '{"doubao-seedance-2.0-face":14,"doubao-seedance-2.0-face-apimart":14}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- fast-face 720p rate matches base rate (12), no change needed;
-- kept here for documentation.
-- doubao-seedance-2.0-fast-face stays at 12.

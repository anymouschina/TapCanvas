-- Purpose: Set WxPay pricing — 1 CNY buys 1 USD quota.
--   Price: controls displayed amount and backend calculation for all payment methods.
--   WxPayUnitPrice: WxPay-specific unit price (0 = fall through to Price).
--   WxPayMinTopUp: minimum top-up amount in CNY.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO options (key, value)
VALUES ('Price', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO options (key, value)
VALUES ('WxPayUnitPrice', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO options (key, value)
VALUES ('WxPayMinTopUp', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

\echo '----- WxPay pricing after patch -----'
SELECT key, value FROM options WHERE key IN ('Price', 'WxPayUnitPrice', 'WxPayMinTopUp') ORDER BY key;

COMMIT;

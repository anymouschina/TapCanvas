-- Purpose: Enable user registration and configure WxPay as the sole payment method.
--
-- Background:
--   SelfUseModeEnabled was set to true in DB, which hides the registration entry
--   and the topup UI for all users. WxPay credentials live in env vars (WECHAT_PAY_*)
--   and are already active on this server — no SQL needed for credentials.
--   Epay / Alipay are not configured on this server, so only wxpay is exposed.
--
-- Scope: PostgreSQL only, data-only, idempotent.
-- After applying: restart new-api or wait for option sync (default: 60 s).

\set ON_ERROR_STOP on

BEGIN;

-- Disable self-use mode → shows registration entry and enables topup UI
INSERT INTO options (key, value)
VALUES ('SelfUseModeEnabled', 'false')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Ensure user registration is open
INSERT INTO options (key, value)
VALUES ('RegisterEnabled', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Expose only WxPay in the payment UI (Alipay/Epay not configured)
INSERT INTO options (key, value)
VALUES ('PayMethods', '[{"name":"微信","color":"rgba(var(--semi-green-5), 1)","type":"wxpay"}]')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

\echo
\echo '----- registration + payment settings after patch -----'
SELECT key, value FROM options
WHERE key IN ('SelfUseModeEnabled', 'RegisterEnabled', 'PayMethods', 'Price', 'WxPayUnitPrice', 'WxPayMinTopUp')
ORDER BY key;

COMMIT;

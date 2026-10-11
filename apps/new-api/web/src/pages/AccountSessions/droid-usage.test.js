/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  droidCredentialValidity,
  droidExhaustedQuotaWindows,
  droidQuotaRows,
  droidQuotaTotalRemaining,
  formatDroidBalance,
  isDroidQuotaWindowExpired,
} from './droid-usage.js';

test('Factory Standard/Core quotas retain reported zero and unknown independently', () => {
  const rows = droidQuotaRows({
    quota_windows: [
      { scope: 'core', window: 'weekly', used_percent: 100, reset_at: 1234 },
      {
        scope: 'standard',
        window: 'fiveHour',
        used_percent: 0,
        reset_at: null,
      },
      {
        scope: 'standard',
        window: 'weekly',
        used_percent: null,
        reset_at: 3456,
      },
    ],
  });
  assert.deepEqual(rows[0].windows[0], {
    window: 'fiveHour',
    used: '0.0%',
    remaining: '100.0%',
    resetAt: null,
  });
  assert.deepEqual(rows[0].windows[1], {
    window: 'weekly',
    used: null,
    remaining: null,
    resetAt: 3456,
  });
  assert.equal(rows[0].windows[2].used, null);
  assert.deepEqual(rows[1].windows[1], {
    window: 'weekly',
    used: '100.0%',
    remaining: '0.0%',
    resetAt: 1234,
  });
});

test('Factory USD cents distinguish a zero balance from missing data', () => {
  assert.equal(formatDroidBalance(0), '$0.00 USD');
  assert.equal(formatDroidBalance(12345), '$123.45 USD');
  assert.equal(formatDroidBalance(null), null);
  assert.equal(formatDroidBalance(undefined), null);
});

test('first failed probe cannot fabricate zero usage or unlimited windows', () => {
  const rows = droidQuotaRows({
    quota_source: 'factory_billing_limits',
    usage_error: 'upstream status 401',
    updated_at: 0,
  });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.windows.length, 3);
    for (const window of row.windows) {
      assert.equal(window.used, null);
      assert.equal(window.remaining, null);
      assert.equal(window.resetAt, undefined);
    }
  }
});

test('credential expiry stays independent of subscription and billing period', () => {
  const t = (message) => message;
  const formatDate = (timestamp) => `date:${timestamp}`;
  assert.equal(
    droidCredentialValidity({}, t, formatDate),
    '上游未提供 API Key 有效期',
  );
  assert.equal(
    droidCredentialValidity(
      {
        credential_expiry_known: true,
        credential_expires_at: null,
        billing_period_end_at: 1234,
        subscription_end_known: true,
        subscription_end_at: null,
      },
      t,
      formatDate,
    ),
    '未设置过期时间',
  );
  assert.equal(
    droidCredentialValidity(
      {
        credential_expiry_known: true,
        credential_expires_at: 9876,
      },
      t,
      formatDate,
    ),
    'date:9876',
  );
});

test('reported allowance subtracts organization usage and preserves zero quantities', () => {
  assert.equal(
    droidQuotaTotalRemaining({
      total_allowance: 20000000,
      org_used_tokens: 67177,
    }),
    '19,932,823',
  );
  assert.equal(
    droidQuotaTotalRemaining({ total_allowance: 0, org_used_tokens: 0 }),
    '0',
  );
  assert.equal(
    droidQuotaTotalRemaining({ total_allowance: null, org_used_tokens: 0 }),
    null,
  );
});

test('elapsed quota windows keep historic usage distinct from current remaining quota', () => {
  assert.equal(isDroidQuotaWindowExpired(999, 1000), true);
  assert.equal(isDroidQuotaWindowExpired(1000, 1000), true);
  assert.equal(isDroidQuotaWindowExpired(1001, 1000), false);
  assert.equal(isDroidQuotaWindowExpired(null, 1000), false);
  assert.equal(isDroidQuotaWindowExpired(0, 1000), false);
});

test('exhaustion labels apply only to reported current scope windows', () => {
  const standard = {
    scope: 'standard',
    window: 'fiveHour',
    used_percent: 100,
    reset_at: 2000,
  };
  const core = {
    scope: 'core',
    window: 'weekly',
    used_percent: 100,
    reset_at: null,
  };
  assert.deepEqual(
    droidExhaustedQuotaWindows(
      {
        quota_windows: [
          standard,
          core,
          { ...standard, window: 'weekly', reset_at: 999 },
          { ...standard, window: 'monthly', used_percent: 99.99 },
          { ...core, window: 'fiveHour', used_percent: 0 },
          { ...core, window: 'monthly', used_percent: null },
        ],
      },
      1000,
    ),
    [standard, core],
  );
  assert.deepEqual(droidExhaustedQuotaWindows({ usage_error: 'failed' }), []);
});

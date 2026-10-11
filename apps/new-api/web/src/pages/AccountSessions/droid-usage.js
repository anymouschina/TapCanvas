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

export const droidQuotaScopes = ['standard', 'core'];
export const droidQuotaWindows = ['fiveHour', 'weekly', 'monthly'];

export const droidWindowLabel = (window, t) =>
  ({ fiveHour: t('5小时'), weekly: t('7天'), monthly: t('30天') })[window];

export const formatDroidPercent = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}%`
    : null;

export const formatDroidBalance = (cents) =>
  typeof cents === 'number' && Number.isFinite(cents)
    ? `$${(cents / 100).toFixed(2)} USD`
    : null;

export const isDroidQuotaWindowExpired = (
  resetAt,
  now = Math.floor(Date.now() / 1000),
) => typeof resetAt === 'number' && resetAt > 0 && resetAt <= now;

export function droidExhaustedQuotaWindows(
  usage,
  now = Math.floor(Date.now() / 1000),
) {
  if (!Array.isArray(usage?.quota_windows)) return [];
  return usage.quota_windows.filter(
    (quota) =>
      droidQuotaScopes.includes(quota.scope) &&
      droidQuotaWindows.includes(quota.window) &&
      typeof quota.used_percent === 'number' &&
      Number.isFinite(quota.used_percent) &&
      quota.used_percent >= 100 &&
      !isDroidQuotaWindowExpired(quota.reset_at, now),
  );
}

export const formatDroidTokenAmount = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US')
    : null;

export function droidQuotaTotalRemaining(total) {
  if (
    typeof total.total_allowance !== 'number' ||
    !Number.isFinite(total.total_allowance) ||
    typeof total.org_used_tokens !== 'number' ||
    !Number.isFinite(total.org_used_tokens)
  ) {
    return null;
  }
  return formatDroidTokenAmount(
    Math.max(0, total.total_allowance - total.org_used_tokens),
  );
}

export function droidCredentialValidity(usage, t, formatDate) {
  if (!usage?.credential_expiry_known) {
    return t('上游未提供 API Key 有效期');
  }
  return usage.credential_expires_at == null
    ? t('未设置过期时间')
    : formatDate(usage.credential_expires_at);
}

export function droidQuotaRows(usage) {
  const windows = Array.isArray(usage?.quota_windows)
    ? usage.quota_windows
    : [];
  return droidQuotaScopes.map((scope) => ({
    scope,
    windows: droidQuotaWindows.map((window) => {
      const quota = windows.find(
        (item) => item.scope === scope && item.window === window,
      );
      const used = quota?.used_percent;
      return {
        window,
        used: formatDroidPercent(used),
        remaining:
          typeof used === 'number' && Number.isFinite(used)
            ? formatDroidPercent(Math.max(0, 100 - used))
            : null,
        resetAt: quota?.reset_at,
      };
    }),
  }));
}

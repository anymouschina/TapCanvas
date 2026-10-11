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

import React from 'react';
import { Banner, Typography } from '@douyinfe/semi-ui';
import { timestamp2string } from '../../helpers';
import {
  droidCredentialValidity,
  droidQuotaRows,
  droidQuotaTotalRemaining,
  droidWindowLabel,
  formatDroidBalance,
  formatDroidTokenAmount,
  isDroidQuotaWindowExpired,
} from './droid-usage';

const { Text } = Typography;

function DetailRow({ label, children }) {
  return (
    <div className='droid-account-detail-row'>
      <Text className='droid-account-text' type='tertiary' size='small'>
        {label}
      </Text>
      <Text className='droid-account-detail-value' size='small'>
        {children}
      </Text>
    </div>
  );
}

export function DroidAccountDetails({ usage, t }) {
  const missing = t('上游未提供');
  const date = (timestamp) =>
    timestamp == null ? missing : timestamp2string(timestamp);
  const totals = Array.isArray(usage.quota_totals) ? usage.quota_totals : [];
  return (
    <div className='droid-account-details'>
      {usage.usage_error && (
        <div className='droid-account-section--wide'>
          <Banner
            className='droid-account-banner'
            type='warning'
            closeIcon={null}
            description={`${t('查询失败')} · ${usage.usage_error}`}
          />
        </div>
      )}
      <section className='droid-account-section'>
        <Text className='droid-account-text' strong>
          {t('订阅')}
        </Text>
        <DetailRow className='droid-account-detail-row' label={t('套餐')}>
          {usage.plan_type || missing}
        </DetailRow>
        <DetailRow className='droid-account-detail-row' label={t('订阅状态')}>
          {usage.subscription_status || missing}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('当前账期开始')}
        >
          {date(usage.billing_period_start_at)}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('当前账期结束')}
        >
          {date(usage.billing_period_end_at)}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('订阅结束日期')}
        >
          {usage.subscription_end_known
            ? usage.subscription_end_at == null
              ? t('未设置结束日期')
              : date(usage.subscription_end_at)
            : missing}
        </DetailRow>
        {usage.trial_end_at != null && (
          <DetailRow className='droid-account-detail-row' label={t('试用结束')}>
            {date(usage.trial_end_at)}
          </DetailRow>
        )}
      </section>
      <section className='droid-account-section'>
        <Text className='droid-account-text' strong>
          {t('凭据与额外用量')}
        </Text>
        <DetailRow
          className='droid-account-detail-row'
          label={t('API Key 有效期')}
        >
          {droidCredentialValidity(usage, t, timestamp2string)}
        </DetailRow>
        <DetailRow className='droid-account-detail-row' label={t('凭据状态')}>
          {typeof usage.credential_revoked === 'boolean'
            ? usage.credential_revoked
              ? t('已撤销')
              : t('未撤销')
            : missing}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('额外用量余额')}
        >
          {formatDroidBalance(usage.extra_usage_balance_cents) ?? missing}
        </DetailRow>
        <DetailRow className='droid-account-detail-row' label={t('额外用量')}>
          {typeof usage.extra_usage_allowed === 'boolean'
            ? usage.extra_usage_allowed
              ? t('允许')
              : t('不允许')
            : missing}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('超额用量设置')}
        >
          {usage.overage_preference || missing}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('Token 限额计费')}
        >
          {typeof usage.uses_token_rate_limits_billing === 'boolean'
            ? usage.uses_token_rate_limits_billing
              ? t('已启用')
              : t('未启用')
            : missing}
        </DetailRow>
      </section>
      <section className='droid-account-section droid-account-section--wide'>
        <Text className='droid-account-text' strong>
          {t('窗口额度')}
        </Text>
        <p
          className='droid-account-p'
          style={{
            margin: '6px 0',
            fontSize: 12,
            color: 'var(--semi-color-text-2)',
          }}
        >
          {t('Standard 模型额度')}；{' '}
          {t('Core 模型独立额度，不代表 Standard 模型可用')}。{' '}
          <a
            className='droid-account-a'
            href='https://docs.factory.ai/pricing/individuals'
            target='_blank'
            rel='noreferrer'
          >
            {t('Factory 官方说明')}
          </a>
        </p>
        <div className='droid-account-window-details'>
          {droidQuotaRows(usage).flatMap(({ scope, windows }) =>
            windows.map(({ window, used, remaining, resetAt }) => {
              const expired = isDroidQuotaWindowExpired(resetAt);
              return (
                <div className='droid-account-div' key={`${scope}-${window}`}>
                  <Text className='droid-account-text' strong size='small'>
                    {scope === 'standard' ? 'Standard' : 'Core'} ·{' '}
                    {droidWindowLabel(window, t)}
                    {expired ? ` · ${t('已结束')}` : ''}
                  </Text>
                  <DetailRow
                    className='droid-account-detail-row'
                    label={expired ? t('上游已记录用量') : t('已用')}
                  >
                    {used ?? t('上游未提供用量')}
                  </DetailRow>
                  {!expired && (
                    <DetailRow
                      className='droid-account-detail-row'
                      label={t('剩余')}
                    >
                      {remaining ?? t('上游未提供用量')}
                    </DetailRow>
                  )}
                  <DetailRow
                    className='droid-account-detail-row'
                    label={t('额度重置')}
                  >
                    {resetAt ? date(resetAt) : t('上游未提供重置时间')}
                  </DetailRow>
                </div>
              );
            }),
          )}
        </div>
      </section>
      <section className='droid-account-section droid-account-section--wide'>
        <Text className='droid-account-text' strong>
          {t('上游组织 Token 用量（独立于窗口百分比）')}
        </Text>
        <p
          className='droid-account-p'
          style={{
            margin: '6px 0',
            fontSize: 12,
            color: 'var(--semi-color-text-2)',
          }}
        >
          {t('同一账号或组织的多个 Key 共享额度，请勿累加。')}
        </p>
        <DetailRow className='droid-account-detail-row' label={t('数据来源')}>
          {usage.quota_totals_source || missing}
        </DetailRow>
        <DetailRow className='droid-account-detail-row' label={t('统计区间')}>
          {date(usage.quota_totals_start_at)} —{' '}
          {date(usage.quota_totals_end_at)}
        </DetailRow>
        <div className='droid-account-window-details'>
          {totals.map((total) => (
            <div className='droid-account-div' key={total.scope}>
              <Text className='droid-account-text' strong size='small'>
                {total.scope}
              </Text>
              <DetailRow
                className='droid-account-detail-row'
                label={t('上游统计区间总额度')}
              >
                {formatDroidTokenAmount(total.total_allowance) ?? missing}
              </DetailRow>
              <DetailRow
                className='droid-account-detail-row'
                label={t('组织已用')}
              >
                {formatDroidTokenAmount(total.org_used_tokens) ?? missing}
              </DetailRow>
              <DetailRow
                className='droid-account-detail-row'
                label={t('组织剩余')}
              >
                {droidQuotaTotalRemaining(total) ?? missing}
              </DetailRow>
              <DetailRow
                className='droid-account-detail-row'
                label={t('用户已用')}
              >
                {formatDroidTokenAmount(total.user_tokens) ?? missing}
              </DetailRow>
              <DetailRow
                className='droid-account-detail-row'
                label={t('组织超额已用')}
              >
                {formatDroidTokenAmount(total.org_overage_used) ?? missing}
              </DetailRow>
              <DetailRow
                className='droid-account-detail-row'
                label={t('组织超额限额')}
              >
                {formatDroidTokenAmount(total.org_overage_limit) ?? missing}
              </DetailRow>
            </div>
          ))}
          {totals.length === 0 && (
            <Text className='droid-account-text' size='small' type='tertiary'>
              {missing}
            </Text>
          )}
        </div>
      </section>
      <section className='droid-account-section droid-account-section--wide'>
        <Text className='droid-account-text' strong>
          {t('数据读取时间')}
        </Text>
        <DetailRow
          className='droid-account-detail-row'
          label={t('上次完整同步')}
        >
          {usage.updated_at > 0 ? date(usage.updated_at) : missing}
        </DetailRow>
        <DetailRow className='droid-account-detail-row' label={t('最近查询')}>
          {usage.usage_checked_at > 0 ? date(usage.usage_checked_at) : missing}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('窗口数据读取时间')}
        >
          {usage.quota_windows_checked_at > 0
            ? date(usage.quota_windows_checked_at)
            : missing}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('订阅数据读取时间')}
        >
          {usage.subscription_checked_at > 0
            ? date(usage.subscription_checked_at)
            : missing}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('组织用量读取时间')}
        >
          {usage.quota_totals_checked_at > 0
            ? date(usage.quota_totals_checked_at)
            : missing}
        </DetailRow>
        <DetailRow
          className='droid-account-detail-row'
          label={t('凭据数据读取时间')}
        >
          {usage.credential_checked_at > 0
            ? date(usage.credential_checked_at)
            : missing}
        </DetailRow>
      </section>
    </div>
  );
}

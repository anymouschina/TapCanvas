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

import React, { useState } from 'react';
import { Button, Modal, Tooltip, Typography } from '@douyinfe/semi-ui';
import { IconInfoCircle } from '@douyinfe/semi-icons';
import { timestamp2string } from '../../helpers';
import {
  droidExhaustedQuotaWindows,
  droidQuotaRows,
  droidWindowLabel,
  formatDroidBalance,
  isDroidQuotaWindowExpired,
} from './droid-usage';
import { DroidAccountDetails } from './DroidAccountDetails';
import './droid-usage.css';

const { Text } = Typography;

function QuotaBar({ scope, quota, t }) {
  const { window, used, remaining, resetAt } = quota;
  const expired = isDroidQuotaWindowExpired(resetAt);
  const remainingNumber =
    remaining === null ? null : Number.parseFloat(remaining);
  const state = used === null ? 'unknown' : expired ? 'expired' : 'active';
  const color =
    remainingNumber < 5 ? 'danger' : remainingNumber < 20 ? 'warning' : scope;
  const caption = state === 'unknown' ? '—' : expired ? t('已结束') : remaining;
  const reset = resetAt ? timestamp2string(resetAt) : t('上游未提供重置时间');
  const description = `${scope === 'standard' ? 'Standard' : 'Core'} ${droidWindowLabel(window, t)} · ${used === null ? t('上游未提供用量') : expired ? `${t('已结束窗口')} · ${t('上游已记录用量')} ${used}` : `${t('已用')} ${used} · ${t('剩余')} ${remaining}`} · ${t('额度重置')} ${reset}`;
  return (
    <Tooltip className='droid-account-tooltip' content={description}>
      <div
        className={`droid-quota-window droid-quota-window--${state}`}
        title={description}
        tabIndex={0}
        aria-label={description}
      >
        <span className='droid-quota-caption'>{caption}</span>
        <div
          className={`droid-quota-track droid-quota-track--${color}`}
          role={state === 'active' ? 'progressbar' : 'img'}
          aria-label={description}
          aria-valuemin={state === 'active' ? 0 : undefined}
          aria-valuemax={state === 'active' ? 100 : undefined}
          aria-valuenow={
            state === 'active'
              ? Math.min(100, Math.max(0, remainingNumber))
              : undefined
          }
        >
          {state === 'active' && (
            <span
              className='droid-account-span'
              style={{
                width: `${Math.min(100, Math.max(0, remainingNumber))}%`,
              }}
            />
          )}
        </div>
      </div>
    </Tooltip>
  );
}

export function DroidUsage({ usage, t }) {
  const [detailsVisible, setDetailsVisible] = useState(false);
  const balance = formatDroidBalance(usage.extra_usage_balance_cents);
  const exhausted = droidExhaustedQuotaWindows(usage);
  return (
    <div className='droid-quota-summary'>
      <div className='droid-quota-matrix'>
        <Text className='droid-quota-heading' type='tertiary'>
          {t('剩余')}
        </Text>
        {['fiveHour', 'weekly', 'monthly'].map((window) => (
          <Text key={window} className='droid-quota-heading' type='tertiary'>
            {droidWindowLabel(window, t)}
          </Text>
        ))}
        {droidQuotaRows(usage).map(({ scope, windows }) => (
          <React.Fragment key={scope}>
            <Tooltip
              className='droid-account-tooltip'
              content={
                scope === 'standard'
                  ? t('Standard 模型额度')
                  : t('Core 模型独立额度，不代表 Standard 模型可用')
              }
            >
              <Text className='droid-quota-scope' strong>
                {scope === 'standard' ? 'Standard' : 'Core'}
              </Text>
            </Tooltip>
            {windows.map((quota) => (
              <QuotaBar
                className='droid-account-quota-bar'
                key={quota.window}
                scope={scope}
                quota={quota}
                t={t}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
      <div className='droid-quota-footer'>
        <Text
          size='small'
          type='tertiary'
          className='droid-quota-plan'
          ellipsis={{ showTooltip: true }}
        >
          {usage.plan_type || t('上游未提供')}
        </Text>
        <Text className='droid-account-text' size='small' type='tertiary'>
          {t('额外余额')} {balance ?? '—'}
        </Text>
        <Button
          className='droid-account-button'
          size='small'
          theme='borderless'
          type='primary'
          onClick={() => setDetailsVisible(true)}
          aria-label={t('查看 Droid 额度详情')}
          icon={<IconInfoCircle className='droid-quota-details-icon' />}
        />
      </div>
      {exhausted.map((quota) => (
        <Text
          key={`${quota.scope}-${quota.window}`}
          size='small'
          type='warning'
          className='droid-quota-stale'
        >
          {quota.scope === 'standard' ? 'Standard' : 'Core'} ·{' '}
          {droidWindowLabel(quota.window, t)} · {t('额度耗尽')}
          {quota.reset_at
            ? ` · ${t('额度重置')} ${timestamp2string(quota.reset_at)}`
            : ` · ${t('上游未提供重置时间')}`}
        </Text>
      ))}
      {usage.usage_error && (
        <Text size='small' type='warning' className='droid-quota-stale'>
          {t('查询失败 · 部分数据未更新')}
        </Text>
      )}
      <Modal
        className='droid-account-modal'
        title={t('Droid 额度与账号详情')}
        visible={detailsVisible}
        onCancel={() => setDetailsVisible(false)}
        width={760}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
        footer={
          <Button
            className='droid-account-button'
            onClick={() => setDetailsVisible(false)}
          >
            {t('关闭')}
          </Button>
        }
      >
        <DroidAccountDetails
          className='droid-account-droid-account-details'
          usage={usage}
          t={t}
        />
      </Modal>
    </div>
  );
}

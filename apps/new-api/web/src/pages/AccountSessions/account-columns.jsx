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
import {
  Button,
  Popconfirm,
  Progress,
  Space,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { renderQuota, timestamp2string } from '../../helpers';
import {
  DROID_CHANNEL_TYPE,
  GEMINI_CHANNEL_TYPE,
} from '../../constants/channel.constants';
import { DroidUsage } from './DroidUsage';
import { droidCredentialValidity } from './droid-usage';

const { Text } = Typography;

const statusTag = (status, t) => {
  switch (status) {
    case 1:
      return (
        <Tag
          className='account-column-tag'
          color='green'
          shape='circle'
          size='small'
        >
          {t('已启用')}
        </Tag>
      );
    case 2:
      return (
        <Tag
          className='account-column-tag'
          color='red'
          shape='circle'
          size='small'
        >
          {t('手动禁用')}
        </Tag>
      );
    case 3:
      return (
        <Tag
          className='account-column-tag'
          color='orange'
          shape='circle'
          size='small'
        >
          {t('自动禁用')}
        </Tag>
      );
    default:
      return (
        <Tag
          className='account-column-tag'
          color='grey'
          shape='circle'
          size='small'
        >
          {t('未知')}
        </Tag>
      );
  }
};

export function createAccountSessionColumns({
  t,
  selectedChannel,
  opLoading,
  openChatTest,
  keyAction,
}) {
  const accountColumns = [
    {
      title: t('序号'),
      dataIndex: 'index',
      width: 70,
      render: (v) => `#${Number(v) + 1}`,
    },
    {
      title: t('账号'),
      dataIndex: 'email',
      render: (email, record) => {
        if (!record.is_oauth && !record.is_account) {
          return (
            <Space
              className='account-api-key-identity'
              vertical
              align='start'
              spacing={2}
            >
              {email && (
                <Text className='account-api-key-email' strong>
                  {email}
                </Text>
              )}
              <Text className='account-column-text' type='tertiary'>
                {t('API Key')}
              </Text>
              <Text
                className='account-column-text'
                code
                style={{ fontSize: 12 }}
              >
                {record.key_preview}
              </Text>
            </Space>
          );
        }
        return (
          <Space
            className='account-column-space'
            vertical
            align='start'
            spacing={2}
          >
            <Text className='account-column-text' strong>
              {email || t('（未知邮箱）')}
            </Text>
            {record.account_id && (
              <Text
                className='account-column-text'
                type='tertiary'
                style={{ fontSize: 12 }}
              >
                {record.account_id}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 100,
      render: (s, record) =>
        record.reason && s !== 1 ? (
          <Tooltip className='account-status-reason' content={record.reason}>
            <span className='account-status-reason-label' tabIndex={0}>
              {statusTag(s, t)}
            </span>
          </Tooltip>
        ) : (
          statusTag(s, t)
        ),
    },
    {
      title:
        selectedChannel?.type === DROID_CHANNEL_TYPE
          ? t('额度剩余')
          : t('额度状态'),
      dataIndex: 'usage',
      width: selectedChannel?.type === DROID_CHANNEL_TYPE ? 420 : 190,
      render: (usage, record) => {
        if (!usage) {
          if (selectedChannel?.type === DROID_CHANNEL_TYPE)
            return (
              <Text className='droid-usage-pending' type='quaternary'>
                {t('尚未查询上游额度')}
              </Text>
            );
          if (selectedChannel?.type === GEMINI_CHANNEL_TYPE) {
            return record.status === 1 ? (
              <Text
                className='account-quota-status'
                type='quaternary'
                size='small'
              >
                {t('尚未查询上游额度')}
              </Text>
            ) : (
              <Text className='account-quota-status' type='danger' size='small'>
                {t('已移出负载均衡')}
              </Text>
            );
          }
          return (
            <Text className='account-column-text' type='quaternary'>
              {t('等待同步')}
            </Text>
          );
        }
        if (selectedChannel?.type === DROID_CHANNEL_TYPE)
          return (
            <DroidUsage className='account-droid-usage' usage={usage} t={t} />
          );
        if (usage.quota_source === 'antigravity_load_code_assist') {
          if (!usage.credit_known) {
            return (
              <Space
                className='account-column-space'
                vertical
                align='start'
                spacing={2}
                style={{ width: 180 }}
              >
                <Text
                  className='account-column-text'
                  type='tertiary'
                  size='small'
                >
                  {usage.paid_tier_id || t('已发现套餐')}
                </Text>
                <Text
                  className='account-column-text'
                  type='quaternary'
                  size='small'
                >
                  {t('上游未返回数值余额')}
                </Text>
              </Space>
            );
          }
          const available = Boolean(usage.credit_available);
          return (
            <Space
              className='account-column-space'
              vertical
              align='start'
              spacing={2}
              style={{ width: 180 }}
            >
              <Text
                className='account-column-text'
                strong
                type={available ? 'success' : 'danger'}
              >
                {available ? t('余额可用') : t('余额不足')}
              </Text>
              <Text
                className='account-column-text'
                type='tertiary'
                size='small'
              >
                {Number(usage.credit_amount).toFixed(2)} /{' '}
                {Number(usage.minimum_credit_amount).toFixed(2)}
              </Text>
              <Text
                className='account-column-text'
                type='quaternary'
                size='small'
              >
                {usage.paid_tier_id || '-'}
              </Text>
            </Space>
          );
        }
        const remaining = Number(usage.remaining_percent || 0);
        const color =
          remaining < 5
            ? 'var(--semi-color-danger)'
            : remaining < 20
              ? 'var(--semi-color-warning)'
              : 'var(--semi-color-success)';
        return (
          <Space
            className='account-column-space'
            vertical
            align='start'
            spacing={2}
            style={{ width: 160 }}
          >
            <Space className='account-column-space' spacing={6}>
              <Text className='account-column-text' strong style={{ color }}>
                {remaining.toFixed(1)}%
              </Text>
              <Text
                className='account-column-text'
                type='tertiary'
                size='small'
              >
                {usage.plan_type || '-'}
              </Text>
            </Space>
            <Progress
              className='account-column-progress'
              percent={remaining}
              showInfo={false}
              stroke={color}
            />
            <Text className='account-column-text' type='tertiary' size='small'>
              {t('5小时')} {Number(usage.primary_used_percent || 0).toFixed(0)}%
              · {t('7天')}{' '}
              {Number(usage.secondary_used_percent || 0).toFixed(0)}%
            </Text>
          </Space>
        );
      },
    },
    {
      title: t('额度重置'),
      key: 'quota_resets',
      dataIndex: 'usage',
      width: 170,
      render: (usage, record) => {
        const primaryResetAt = usage?.primary_reset_at;
        const secondaryResetAt = usage?.secondary_reset_at;
        if (!primaryResetAt && !secondaryResetAt && !record.cooldown_until) {
          return (
            <Text className='account-column-text' type='quaternary'>
              -
            </Text>
          );
        }
        return (
          <Space
            className='account-column-space'
            vertical
            align='start'
            spacing={2}
          >
            {primaryResetAt ? (
              <Text className='account-column-text' style={{ fontSize: 12 }}>
                {t('5小时')} · {timestamp2string(primaryResetAt)}
              </Text>
            ) : null}
            {secondaryResetAt ? (
              <Text className='account-column-text' style={{ fontSize: 12 }}>
                {t('7天')} · {timestamp2string(secondaryResetAt)}
              </Text>
            ) : null}
            {record.cooldown_until ? (
              <Text
                className='account-column-text'
                type='warning'
                style={{ fontSize: 12 }}
              >
                {t('恢复')} · {timestamp2string(record.cooldown_until)}
              </Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title:
        selectedChannel?.type === DROID_CHANNEL_TYPE
          ? t('凭据有效期')
          : t('Token 过期'),
      dataIndex: 'expired',
      render: (v, record) =>
        selectedChannel?.type === DROID_CHANNEL_TYPE ? (
          <Text className='droid-credential-validity' size='small'>
            {droidCredentialValidity(record.usage, t, timestamp2string)}
          </Text>
        ) : v ? (
          <Text className='account-column-text' style={{ fontSize: 12 }}>
            {v}
          </Text>
        ) : (
          <Text className='account-column-text' type='quaternary'>
            -
          </Text>
        ),
    },
    {
      title: t('禁用原因'),
      key: 'disabled_reason',
      dataIndex: 'reason',
      render: (reason, record) => {
        if (record.status === 1 || !reason)
          return (
            <Text className='account-column-text' type='quaternary'>
              -
            </Text>
          );
        return (
          <Tooltip className='account-column-tooltip' content={reason}>
            <Text
              className='account-column-text'
              style={{ maxWidth: 180, display: 'block' }}
              ellipsis
            >
              {reason}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: t('操作'),
      key: 'action',
      fixed: 'right',
      width: 210,
      render: (_, record) => (
        <Space className='account-column-space'>
          <Button
            className='account-column-button'
            type='primary'
            size='small'
            disabled={record.status !== 1}
            onClick={() => openChatTest(record)}
          >
            {t('Chat 测试')}
          </Button>
          {record.status === 1 ? (
            <Button
              className='account-column-button'
              type='danger'
              size='small'
              loading={opLoading[`disable_key_${record.index}`]}
              onClick={() =>
                keyAction('disable_key', record.index, t('账号已禁用'))
              }
            >
              {t('禁用')}
            </Button>
          ) : (
            <Button
              className='account-column-button'
              type='primary'
              size='small'
              loading={opLoading[`enable_key_${record.index}`]}
              onClick={() =>
                keyAction('enable_key', record.index, t('账号已启用'))
              }
            >
              {t('启用')}
            </Button>
          )}
          <Popconfirm
            className='account-column-popconfirm'
            title={t('确定要删除此账号吗？')}
            content={t('此操作不可撤销，将从渠道永久移除该账号的凭证')}
            onConfirm={() =>
              keyAction('delete_key', record.index, t('账号已删除'))
            }
            okType='danger'
            position='topRight'
          >
            <Button
              className='account-column-button'
              type='danger'
              size='small'
              loading={opLoading[`delete_key_${record.index}`]}
            >
              {t('删除')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const sessionColumns = [
    {
      title: t('会话 ID'),
      dataIndex: 'conversationId',
      render: (v) =>
        v ? (
          <Text
            className='account-column-text'
            code
            style={{ fontSize: 12 }}
            ellipsis={{ showTooltip: true }}
          >
            {v}
          </Text>
        ) : (
          <Text className='account-column-text' type='tertiary'>
            {t('（无会话ID）')}
          </Text>
        ),
    },
    {
      title: t('历史账号序号'),
      dataIndex: 'keyIndexes',
      render: (indexes) => {
        if (!indexes || indexes.length === 0)
          return (
            <Text className='account-column-text' type='quaternary'>
              -
            </Text>
          );
        return (
          <Space className='account-column-space' wrap spacing={4}>
            {indexes.map((idx) => (
              <Tag
                className='account-column-tag'
                key={idx}
                color='blue'
                shape='circle'
                size='small'
              >
                {t('请求时账号 #{{index}}', { index: idx + 1 })}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: t('模型'),
      dataIndex: 'models',
      render: (models) => (
        <Space className='account-column-space' wrap spacing={4}>
          {(models || []).map((m) => (
            <Tag
              className='account-column-tag'
              key={m}
              size='small'
              color='white'
              shape='circle'
            >
              {m}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('请求数'),
      dataIndex: 'count',
      width: 90,
    },
    {
      title: t('消耗'),
      dataIndex: 'quota',
      width: 110,
      render: (v) => renderQuota(v),
    },
    {
      title: t('最近时间'),
      dataIndex: 'latest',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
  ];

  return {
    accountColumns:
      selectedChannel?.type === DROID_CHANNEL_TYPE
        ? accountColumns.filter(
            (column) =>
              !['quota_resets', 'disabled_reason'].includes(column.key),
          )
        : accountColumns,
    sessionColumns,
  };
}

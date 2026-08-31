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
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Pencil, Power, PowerOff, Trash2 } from 'lucide-react';
import {
  getLobeHubIcon,
  stringToColor,
  timestamp2string,
} from '../../../helpers';
import { renderLimitedItems } from '../../common/ui/RenderUtils';
import { parsePersistedSpecPricing } from './utils/modelPricingConfig';

const { Text } = Typography;

const renderNameRule = (record, t) => {
  const definitions = {
    0: { color: 'green', label: t('精确') },
    1: { color: 'blue', label: t('前缀') },
    2: { color: 'orange', label: t('包含') },
    3: { color: 'purple', label: t('后缀') },
  };
  const definition = definitions[record.name_rule];
  if (!definition) return null;
  const label =
    record.name_rule === 0 || !record.matched_count
      ? definition.label
      : `${definition.label} · ${record.matched_count}`;
  return (
    <Tag
      className='models-table-name-rule'
      size='small'
      color={definition.color}
    >
      {label}
    </Tag>
  );
};

const renderModelIdentity = (record, vendorMap, t) => {
  const vendor = vendorMap[record.vendor_id];
  const iconKey = record.icon || vendor?.icon;
  return (
    <div className='models-table-model flex items-center gap-3 min-w-[220px]'>
      <div className='models-table-model-icon flex h-8 w-8 shrink-0 items-center justify-center'>
        {iconKey ? getLobeHubIcon(iconKey, 22) : null}
      </div>
      <div className='models-table-model-copy min-w-0'>
        <Text
          className='models-table-model-name block font-medium truncate'
          copyable
          onClick={(event) => event.stopPropagation()}
        >
          {record.model_name}
        </Text>
        <div className='models-table-model-meta mt-1 flex items-center gap-2'>
          {renderNameRule(record, t)}
          {vendor ? (
            <Text className='models-table-model-vendor text-xs !text-semi-color-text-2 truncate'>
              {vendor.name}
            </Text>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const renderProtocolCoverage = (channels, t) => {
  if (!Array.isArray(channels) || channels.length === 0) {
    return (
      <Tag
        className='models-table-protocol-unbound'
        size='small'
        color='orange'
      >
        {t('未绑定渠道')}
      </Tag>
    );
  }
  const invalidChannels = channels.filter(
    (channel) => channel.protocol_error || !channel.effective_protocol,
  );
  const channelLines = channels.map((channel) =>
    channel.protocol_error
      ? `${channel.name}: ${channel.protocol_error}`
      : `${channel.name}: ${channel.effective_protocol}`,
  );
  return (
    <Tooltip
      className='models-table-protocol-tooltip'
      content={channelLines.join('\n')}
      position='top'
    >
      <div className='models-table-protocol inline-flex flex-col items-start gap-1'>
        <Tag
          className='models-table-protocol-status'
          size='small'
          color={invalidChannels.length > 0 ? 'red' : 'green'}
        >
          {invalidChannels.length > 0
            ? t('{{invalid}} / {{total}} 异常', {
                invalid: invalidChannels.length,
                total: channels.length,
              })
            : t('{{count}} 个渠道已配置', { count: channels.length })}
        </Tag>
        <Text className='models-table-protocol-preview max-w-[240px] truncate text-xs !text-semi-color-text-2'>
          {channels
            .slice(0, 2)
            .map(
              (channel) =>
                `${channel.name} · ${
                  channel.effective_protocol || t('无协议')
                }`,
            )
            .join(' / ')}
        </Text>
      </div>
    </Tooltip>
  );
};

const renderPricing = (record, t) => {
  const quotaTypes = Array.isArray(record.quota_types)
    ? record.quota_types
    : [];
  const specPricing = parsePersistedSpecPricing(record.pricing_config);
  if (quotaTypes.length === 0 && !specPricing) {
    return (
      <Tag className='models-table-pricing-unset' size='small' color='white'>
        {t('未配置')}
      </Tag>
    );
  }
  return (
    <div className='models-table-pricing flex flex-wrap items-center gap-1'>
      {quotaTypes.includes(0) ? (
        <Tag className='models-table-pricing-token' size='small' color='blue'>
          {t('按量')}
        </Tag>
      ) : null}
      {quotaTypes.includes(1) ? (
        <Tag className='models-table-pricing-request' size='small' color='cyan'>
          {t('按次')}
        </Tag>
      ) : null}
      {specPricing?.invalid ? (
        <Tag className='models-table-pricing-invalid' size='small' color='red'>
          {t('规格错误')}
        </Tag>
      ) : null}
      {specPricing && !specPricing.invalid ? (
        <Tag className='models-table-pricing-spec' size='small' color='violet'>
          {t('{{count}} 个规格', { count: specPricing.count })}
        </Tag>
      ) : null}
    </div>
  );
};

const renderGroups = (groups) => {
  if (!Array.isArray(groups) || groups.length === 0) return '-';
  return renderLimitedItems({
    items: groups,
    maxDisplay: 2,
    renderItem: (group, index) => (
      <Tag
        className='models-table-group'
        key={`${group}-${index}`}
        size='small'
        color={stringToColor(group)}
      >
        {group}
      </Tag>
    ),
  });
};

const renderStatus = (record, t) => (
  <div className='models-table-status flex flex-col items-start gap-1'>
    <Tag
      className='models-table-status-enabled'
      size='small'
      color={record.status === 1 ? 'green' : 'grey'}
    >
      {record.status === 1 ? t('已启用') : t('已禁用')}
    </Tag>
    <Text className='models-table-status-sync text-xs !text-semi-color-text-2'>
      {record.sync_official === 1 ? t('参与同步') : t('不参与同步')}
    </Text>
  </div>
);

const renderOperations = (
  record,
  setEditingModel,
  setShowEdit,
  manageModel,
  refresh,
  t,
) => (
  <Space className='models-table-actions' spacing={2}>
    <Tooltip className='models-table-edit-tooltip' content={t('编辑模型')}>
      <Button
        className='models-table-edit'
        theme='borderless'
        type='tertiary'
        icon={<Pencil className='models-table-edit-icon' size={16} />}
        aria-label={t('编辑模型')}
        onClick={() => {
          setEditingModel(record);
          setShowEdit(true);
        }}
      />
    </Tooltip>
    <Tooltip
      className='models-table-status-tooltip'
      content={record.status === 1 ? t('禁用模型') : t('启用模型')}
    >
      <Button
        className='models-table-status-action'
        theme='borderless'
        type={record.status === 1 ? 'warning' : 'primary'}
        icon={
          record.status === 1 ? (
            <PowerOff className='models-table-disable-icon' size={16} />
          ) : (
            <Power className='models-table-enable-icon' size={16} />
          )
        }
        aria-label={record.status === 1 ? t('禁用模型') : t('启用模型')}
        onClick={() =>
          manageModel(
            record.id,
            record.status === 1 ? 'disable' : 'enable',
            record,
          )
        }
      />
    </Tooltip>
    <Tooltip className='models-table-delete-tooltip' content={t('删除模型')}>
      <Button
        className='models-table-delete'
        theme='borderless'
        type='danger'
        icon={<Trash2 className='models-table-delete-icon' size={16} />}
        aria-label={t('删除模型')}
        onClick={() => {
          Modal.confirm({
            title: t('确定是否要删除此模型？'),
            content: t('此修改将不可逆'),
            onOk: async () => {
              await manageModel(record.id, 'delete', record);
              await refresh();
            },
          });
        }}
      />
    </Tooltip>
  </Space>
);

export const getModelsColumns = ({
  t,
  manageModel,
  setEditingModel,
  setShowEdit,
  refresh,
  vendorMap,
}) => [
  {
    title: t('模型'),
    dataIndex: 'model_name',
    width: 280,
    render: (_, record) => renderModelIdentity(record, vendorMap, t),
  },
  {
    title: t('渠道协议'),
    dataIndex: 'bound_channels',
    width: 280,
    render: (channels) => renderProtocolCoverage(channels, t),
  },
  {
    title: t('定价'),
    dataIndex: 'quota_types',
    width: 160,
    render: (_, record) => renderPricing(record, t),
  },
  {
    title: t('可用分组'),
    dataIndex: 'enable_groups',
    width: 180,
    render: renderGroups,
  },
  {
    title: t('状态'),
    dataIndex: 'status',
    width: 120,
    render: (_, record) => renderStatus(record, t),
  },
  {
    title: t('更新时间'),
    dataIndex: 'updated_time',
    width: 160,
    render: (timestamp) => (
      <Text className='models-table-updated text-xs !text-semi-color-text-2'>
        {timestamp2string(timestamp)}
      </Text>
    ),
  },
  {
    title: '',
    dataIndex: 'operate',
    fixed: 'right',
    width: 132,
    render: (_, record) =>
      renderOperations(
        record,
        setEditingModel,
        setShowEdit,
        manageModel,
        refresh,
        t,
      ),
  },
];

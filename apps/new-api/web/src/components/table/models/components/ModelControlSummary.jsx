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

import React, { useMemo } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import { hasPersistedSpecPricing } from '../utils/modelPricingConfig';

const { Text } = Typography;

const ModelControlSummary = ({ models, total, t }) => {
  const summary = useMemo(() => {
    const visibleModels = models || [];
    const channelIDs = new Set();
    let invalidProtocolBindings = 0;
    let modelsWithoutChannels = 0;
    let pricedModels = 0;

    visibleModels.forEach((model) => {
      const channels = model.bound_channels || [];
      if (channels.length === 0) {
        modelsWithoutChannels += 1;
      }
      channels.forEach((channel) => {
        channelIDs.add(channel.id);
        if (channel.protocol_error) {
          invalidProtocolBindings += 1;
        }
      });
      if (
        hasPersistedSpecPricing(model.pricing_config) ||
        (model.quota_types || []).length > 0
      ) {
        pricedModels += 1;
      }
    });

    return {
      visibleCount: visibleModels.length,
      channelCount: channelIDs.size,
      invalidProtocolBindings,
      modelsWithoutChannels,
      pricedModels,
    };
  }, [models]);

  return (
    <div className='model-control-summary mb-3 rounded-xl bg-semi-color-fill-0 px-4 py-3'>
      <div className='model-control-summary-content flex flex-wrap items-center gap-x-6 gap-y-2'>
        <div className='model-control-summary-heading mr-auto min-w-[220px]'>
          <Text className='model-control-summary-title block text-sm font-medium'>
            {t('模型控制中心')}
          </Text>
          <Text className='model-control-summary-description block text-xs !text-semi-color-text-2'>
            {t('协议、端点与定价使用同一模型事实源')}
          </Text>
        </div>
        <div className='model-control-summary-metric'>
          <Text className='model-control-summary-metric-value block text-sm font-medium'>
            {summary.visibleCount} / {total}
          </Text>
          <Text className='model-control-summary-metric-label block text-xs !text-semi-color-text-2'>
            {t('当前页 / 全部')}
          </Text>
        </div>
        <div className='model-control-summary-metric'>
          <Text className='model-control-summary-metric-value block text-sm font-medium'>
            {summary.channelCount}
          </Text>
          <Text className='model-control-summary-metric-label block text-xs !text-semi-color-text-2'>
            {t('关联渠道')}
          </Text>
        </div>
        <div className='model-control-summary-metric'>
          <Text className='model-control-summary-metric-value block text-sm font-medium'>
            {summary.pricedModels}
          </Text>
          <Text className='model-control-summary-metric-label block text-xs !text-semi-color-text-2'>
            {t('已配置定价')}
          </Text>
        </div>
        {summary.invalidProtocolBindings > 0 ? (
          <Tag className='model-control-summary-error' color='red'>
            {t('{{count}} 个协议错误', {
              count: summary.invalidProtocolBindings,
            })}
          </Tag>
        ) : (
          <Tag className='model-control-summary-healthy' color='green'>
            {t('当前页协议正常')}
          </Tag>
        )}
        {summary.modelsWithoutChannels > 0 ? (
          <Tag className='model-control-summary-unbound' color='orange'>
            {t('{{count}} 个未绑定', {
              count: summary.modelsWithoutChannels,
            })}
          </Tag>
        ) : null}
      </div>
    </div>
  );
};

export default ModelControlSummary;

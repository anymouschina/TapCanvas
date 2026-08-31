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
import { Banner, Form, Input, Typography } from '@douyinfe/semi-ui';

const { Text } = Typography;

const ChannelProtocolEditor = ({
  channelType,
  protocol,
  protocolOptions: bindingOptions,
  modelProtocols,
  catalog,
  catalogLoading,
  catalogError,
  disabled,
  onProtocolChange,
  onBindingOptionsChange,
  t,
}) => {
  const options = useMemo(() => {
    const normalizedChannelType = Number(channelType);
    return [...catalog]
      .sort((left, right) => {
        const leftRecommended = left.recommended_channel_types?.includes(
          normalizedChannelType,
        );
        const rightRecommended = right.recommended_channel_types?.includes(
          normalizedChannelType,
        );
        if (leftRecommended !== rightRecommended) {
          return leftRecommended ? -1 : 1;
        }
        return `${left.family}-${left.name}`.localeCompare(
          `${right.family}-${right.name}`,
        );
      })
      .map((definition) => {
        const recommended = definition.recommended_channel_types?.includes(
          normalizedChannelType,
        );
        return {
          value: definition.id,
          label: `${recommended ? `${t('推荐')} · ` : ''}${definition.name} · ${definition.transport}`,
        };
      });
  }, [catalog, channelType, t]);

  const selectedDefinition = useMemo(
    () => catalog.find((definition) => definition.id === protocol) || null,
    [catalog, protocol],
  );
  const undeclaredOptionKeys = useMemo(() => {
    const declaredKeys = new Set(
      (selectedDefinition?.options || []).map((option) => option.key),
    );
    return Object.keys(bindingOptions || {}).filter(
      (key) => !declaredKeys.has(key),
    );
  }, [bindingOptions, selectedDefinition]);

  return (
    <div className='channel-protocol-field'>
      {catalogError ? (
        <Banner
          className='channel-protocol-error'
          type='danger'
          closeIcon={null}
          description={`${t('协议目录加载失败')}: ${catalogError}`}
        />
      ) : null}
      <Form.Select
        className='channel-protocol-select'
        field='default_protocol'
        label={t('默认接口协议')}
        placeholder={t('选择该渠道实际使用的上游协议')}
        optionList={options}
        loading={catalogLoading}
        disabled={catalogLoading || Boolean(catalogError) || disabled}
        filter
        showClear
        rules={[
          {
            required: true,
            message: t('请选择渠道默认协议'),
          },
        ]}
        extraText={t(
          '协议决定请求与响应格式；渠道类型只保留供应商身份、凭据和连接设置。单个模型的覆盖协议请在模型控制台编辑。',
        )}
        style={{ width: '100%' }}
        onChange={(value) => onProtocolChange(value || '')}
      />
      {(selectedDefinition?.options || []).length > 0 ? (
        <div className='channel-protocol-options mt-3 grid grid-cols-1 md:grid-cols-2 gap-3'>
          {selectedDefinition.options.map((option) => (
            <div className='channel-protocol-option' key={option.key}>
              <Text className='channel-protocol-option-label block text-xs mb-1'>
                {option.label}
                {option.required ? ' *' : ''}
              </Text>
              <Input
                className='channel-protocol-option-input'
                value={bindingOptions?.[option.key] || ''}
                placeholder={option.placeholder || ''}
                disabled={disabled}
                onChange={(value) =>
                  onBindingOptionsChange({
                    ...(bindingOptions || {}),
                    [option.key]: value,
                  })
                }
              />
              {option.description ? (
                <Text className='channel-protocol-option-description block text-xs !text-semi-color-text-2 mt-1'>
                  {option.description}
                </Text>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {undeclaredOptionKeys.length > 0 ? (
        <Banner
          className='channel-protocol-undeclared-options mt-3'
          type='danger'
          closeIcon={null}
          description={t(
            '当前绑定包含协议未声明的参数：{{keys}}。重新选择协议会清空这些参数。',
            {
              keys: undeclaredOptionKeys.join(', '),
            },
          )}
        />
      ) : null}
      {Object.keys(modelProtocols || {}).length > 0 ? (
        <Text className='channel-protocol-overrides block text-xs !text-semi-color-text-2'>
          {t('已有 {{count}} 个模型使用覆盖协议', {
            count: Object.keys(modelProtocols).length,
          })}
        </Text>
      ) : null}
    </div>
  );
};

export default ChannelProtocolEditor;

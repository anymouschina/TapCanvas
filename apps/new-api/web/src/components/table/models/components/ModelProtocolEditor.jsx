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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Empty,
  Input,
  Select,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconSave } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;
const INHERIT_PROTOCOL = '__inherit__';

const createInitialDrafts = (channels) =>
  Object.fromEntries(
    (channels || []).map((channel) => [
      channel.id,
      channel.model_protocol
        ? {
            mode: 'override',
            protocol: channel.model_protocol.protocol,
            options: { ...(channel.model_protocol.options || {}) },
          }
        : {
            mode: 'inherit',
            protocol: '',
            options: {},
          },
    ]),
  );

const ModelProtocolEditor = ({
  model,
  protocols,
  catalogLoading,
  catalogError,
  onSaved,
  t,
}) => {
  const channels = model?.bound_channels || [];
  const [drafts, setDrafts] = useState({});
  const [dirtyChannelIDs, setDirtyChannelIDs] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDrafts(createInitialDrafts(channels));
    setDirtyChannelIDs([]);
  }, [model?.id, model?.bound_channels]);

  const protocolOptions = useMemo(
    () =>
      (protocols || []).map((protocol) => ({
        value: protocol.id,
        label: `${protocol.name} · ${protocol.transport}`,
      })),
    [protocols],
  );
  const protocolByID = useMemo(
    () =>
      Object.fromEntries(
        (protocols || []).map((protocol) => [protocol.id, protocol]),
      ),
    [protocols],
  );

  const updateDraft = (channel, value) => {
    const currentDraft = drafts[channel.id];
    const nextDraft =
      value === INHERIT_PROTOCOL
        ? { mode: 'inherit', protocol: '', options: {} }
        : {
            mode: 'override',
            protocol: value,
            options:
              currentDraft?.protocol === value
                ? { ...(currentDraft.options || {}) }
                : {},
          };
    setDrafts((current) => ({
      ...current,
      [channel.id]: nextDraft,
    }));
    setDirtyChannelIDs((current) =>
      current.includes(channel.id) ? current : [...current, channel.id],
    );
  };

  const updateDraftOption = (channel, key, value) => {
    setDrafts((current) => ({
      ...current,
      [channel.id]: {
        ...current[channel.id],
        options: {
          ...(current[channel.id]?.options || {}),
          [key]: value,
        },
      },
    }));
    setDirtyChannelIDs((current) =>
      current.includes(channel.id) ? current : [...current, channel.id],
    );
  };

  const save = async () => {
    if (catalogLoading || catalogError) {
      showError(t('协议目录尚未成功加载，禁止保存'));
      return;
    }
    if (!model?.id || dirtyChannelIDs.length === 0) return;
    const bindings = [];
    for (const channelID of dirtyChannelIDs) {
      const draft = drafts[channelID];
      if (draft.mode === 'inherit') {
        bindings.push({
          channel_id: channelID,
          mode: draft.mode,
          binding: null,
        });
        continue;
      }
      if (!draft.protocol?.trim()) {
        showError(t('覆盖协议不能为空'));
        return;
      }
      const protocol = protocolByID[draft.protocol];
      if (!protocol) {
        showError(t('覆盖协议不在当前协议目录中'));
        return;
      }
      const declaredOptionKeys = new Set(
        (protocol.options || []).map((option) => option.key),
      );
      const unknownOptionKeys = Object.keys(draft.options || {}).filter(
        (key) => !declaredOptionKeys.has(key),
      );
      if (unknownOptionKeys.length > 0) {
        showError(
          t('协议 {{protocol}} 包含未声明参数：{{keys}}', {
            protocol: protocol.name,
            keys: unknownOptionKeys.join(', '),
          }),
        );
        return;
      }
      const options = {};
      for (const option of protocol.options || []) {
        const value = String(draft.options?.[option.key] || '').trim();
        if (option.required && !value) {
          showError(
            t('协议参数 {{label}} 不能为空', {
              label: option.label,
            }),
          );
          return;
        }
        if (value) {
          options[option.key] = value;
        }
      }
      bindings.push({
        channel_id: channelID,
        mode: draft.mode,
        binding: {
          protocol: draft.protocol,
          ...(Object.keys(options).length > 0 ? { options } : {}),
        },
      });
    }

    setSaving(true);
    try {
      const response = await API.put(`/api/models/${model.id}/protocols`, {
        bindings,
      });
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('保存协议失败'));
      }
      showSuccess(t('渠道协议已更新'));
      setDirtyChannelIDs([]);
      onSaved?.(response.data.data);
    } catch (requestError) {
      showError(
        requestError?.response?.data?.message ||
          requestError.message ||
          t('保存协议失败'),
      );
    } finally {
      setSaving(false);
    }
  };

  if (model?.name_rule !== 0) {
    return (
      <Banner
        className='model-protocol-rule-notice'
        type='warning'
        closeIcon={null}
        description={t(
          '规则模型会匹配多个真实模型，不能直接指定渠道协议。请打开具体的精确模型进行配置。',
        )}
      />
    );
  }

  if (catalogError) {
    return (
      <Banner
        className='model-protocol-catalog-error'
        type='danger'
        closeIcon={null}
        description={`${t('协议目录加载失败')}: ${catalogError}`}
      />
    );
  }

  return (
    <Spin className='model-protocol-editor-loading' spinning={catalogLoading}>
      <div className='model-protocol-editor'>
        <div className='model-protocol-editor-header flex items-start justify-between gap-4 pb-4'>
          <div className='model-protocol-editor-heading min-w-0'>
            <Text className='model-protocol-editor-title block text-base font-medium'>
              {t('渠道协议')}
            </Text>
            <Text className='model-protocol-editor-description block text-xs !text-semi-color-text-2 mt-1'>
              {t(
                '同一模型可在每个渠道使用不同的上游协议。继承使用渠道默认协议，覆盖只影响当前模型。',
              )}
            </Text>
          </div>
          <Button
            className='model-protocol-save shrink-0'
            theme='solid'
            type='primary'
            icon={<IconSave className='model-protocol-save-icon' />}
            disabled={catalogLoading || saving || dirtyChannelIDs.length === 0}
            loading={saving}
            onClick={save}
          >
            {t('保存协议')}
          </Button>
        </div>

        {channels.length === 0 ? (
          <Empty
            className='model-protocol-empty'
            description={t('当前模型尚未绑定任何渠道')}
          />
        ) : (
          <div className='model-protocol-channel-list'>
            {channels.map((channel) => {
              const draft = drafts[channel.id] || {
                mode: 'inherit',
                protocol: '',
                options: {},
              };
              const selectedProtocol =
                draft.mode === 'override'
                  ? protocolByID[draft.protocol] || null
                  : null;
              const declaredOptionKeys = new Set(
                (selectedProtocol?.options || []).map((option) => option.key),
              );
              const unknownOptionKeys = Object.keys(draft.options || {}).filter(
                (key) => !declaredOptionKeys.has(key),
              );
              const inheritOption = {
                value: INHERIT_PROTOCOL,
                label: channel.default_protocol
                  ? `${t('继承渠道默认')} · ${channel.default_protocol.protocol}`
                  : t('继承渠道默认 · 未配置'),
                disabled: !channel.default_protocol,
              };
              return (
                <div
                  className='model-protocol-channel-row grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.9fr)] gap-3 py-4 border-b border-solid border-semi-color-border last:border-b-0'
                  key={channel.id}
                >
                  <div className='model-protocol-channel-meta min-w-0'>
                    <div className='model-protocol-channel-name-row flex items-center gap-2'>
                      <Text className='model-protocol-channel-name font-medium truncate'>
                        {channel.name}
                      </Text>
                      <Tag
                        className='model-protocol-channel-id'
                        size='small'
                        color='white'
                      >
                        #{channel.id}
                      </Tag>
                      {channel.status !== 1 || !channel.ability_enabled ? (
                        <Tag
                          className='model-protocol-channel-disabled-tag'
                          size='small'
                          color='grey'
                        >
                          {channel.status !== 1
                            ? t('渠道已停用')
                            : t('路由已停用')}
                        </Tag>
                      ) : null}
                      {channel.protocol_error ? (
                        <Tag
                          className='model-protocol-channel-error-tag'
                          size='small'
                          color='red'
                        >
                          {t('配置错误')}
                        </Tag>
                      ) : null}
                    </div>
                    <Text className='model-protocol-channel-current block text-xs !text-semi-color-text-2 mt-1'>
                      {channel.effective_protocol
                        ? `${t('当前生效')}: ${channel.effective_protocol} · ${
                            channel.protocol_source === 'model_override'
                              ? t('模型覆盖')
                              : t('渠道默认')
                          }`
                        : channel.protocol_error || t('没有可执行协议')}
                    </Text>
                  </div>
                  <div className='model-protocol-channel-binding'>
                    <Select
                      className='model-protocol-channel-select w-full'
                      value={
                        draft.mode === 'override'
                          ? draft.protocol
                          : INHERIT_PROTOCOL
                      }
                      optionList={[inheritOption, ...protocolOptions]}
                      filter
                      disabled={saving}
                      onChange={(value) => updateDraft(channel, value)}
                    />
                    {(selectedProtocol?.options || []).length > 0 ? (
                      <div className='model-protocol-channel-options mt-3 grid grid-cols-1 md:grid-cols-2 gap-3'>
                        {selectedProtocol.options.map((option) => (
                          <div
                            className='model-protocol-channel-option'
                            key={option.key}
                          >
                            <Text className='model-protocol-channel-option-label block text-xs mb-1'>
                              {option.label}
                              {option.required ? ' *' : ''}
                            </Text>
                            <Input
                              className='model-protocol-channel-option-input'
                              value={draft.options?.[option.key] || ''}
                              placeholder={option.placeholder || ''}
                              disabled={saving}
                              onChange={(value) =>
                                updateDraftOption(channel, option.key, value)
                              }
                            />
                            {option.description ? (
                              <Text className='model-protocol-channel-option-description block text-xs !text-semi-color-text-2 mt-1'>
                                {option.description}
                              </Text>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {unknownOptionKeys.length > 0 ? (
                      <Banner
                        className='model-protocol-channel-unknown-options mt-3'
                        type='danger'
                        closeIcon={null}
                        description={t(
                          '当前绑定包含协议未声明的参数：{{keys}}。重新选择协议会清空这些参数。',
                          {
                            keys: unknownOptionKeys.join(', '),
                          },
                        )}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Spin>
  );
};

export default ModelProtocolEditor;

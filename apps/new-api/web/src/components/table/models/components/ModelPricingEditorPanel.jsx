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

import React, { useCallback, useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Input,
  Radio,
  RadioGroup,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconDelete, IconPlus, IconSave } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../../../helpers';
import {
  BILLING_MODE_PER_REQUEST,
  BILLING_MODE_PER_TOKEN,
  BILLING_MODE_UNCONFIGURED,
  createEmptyModelPricingFormState,
  modelPricingPolicyToFormState,
  SPEC_MODE_DISABLED,
  SPEC_MODE_FIXED,
  SPEC_MODE_LINEAR,
  SPEC_SOURCE_DISABLED,
  SPEC_SOURCE_MODEL,
  SPEC_SOURCE_SYSTEM_DEFAULT,
} from '../utils/modelPricingPolicy';

const { Text } = Typography;

const emptySpecRow = () => ({
  spec_key: '',
  resolution: '',
  duration_seconds: '',
  price_cny: '',
  cny_per_second: '',
});

const numericOrNull = (rawValue, fieldLabel, required = false) => {
  const normalized = String(rawValue ?? '').trim();
  if (normalized === '') {
    if (required) {
      throw new Error(`${fieldLabel} 不能为空`);
    }
    return null;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || (required && value === 0)) {
    throw new Error(`${fieldLabel} 必须是${required ? '正数' : '非负数字'}`);
  }
  return value;
};

const ModelPricingEditorPanel = ({ model, onSaved, t }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formState, setFormState] = useState(createEmptyModelPricingFormState);

  const load = useCallback(async () => {
    if (!model?.id || model?.name_rule !== 0) return;
    setLoading(true);
    setLoadError('');
    setFormState(createEmptyModelPricingFormState());
    try {
      const response = await API.get(`/api/models/${model.id}/pricing`);
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('加载定价失败'));
      }
      setFormState(modelPricingPolicyToFormState(response.data.data));
    } catch (requestError) {
      setLoadError(
        requestError?.response?.data?.message ||
          requestError.message ||
          t('加载定价失败'),
      );
    } finally {
      setLoading(false);
    }
  }, [model?.id, model?.name_rule, t]);

  useEffect(() => {
    load();
  }, [load]);

  const updateField = (field, value) => {
    setFormState((current) => {
      const next = { ...current, [field]: value };
      if (
        field === 'inputPrice' &&
        current.completionRatioLocked &&
        current.lockedCompletionRatio !== null
      ) {
        const numericInput = Number(value);
        next.outputPrice = Number.isFinite(numericInput)
          ? String(numericInput * current.lockedCompletionRatio)
          : '';
      }
      return next;
    });
  };

  const changeBillingMode = (event) => {
    const billingMode = event.target.value;
    setFormState((current) => ({
      ...current,
      billingMode,
      fixedPrice:
        billingMode === BILLING_MODE_PER_REQUEST ? current.fixedPrice : '',
      inputPrice:
        billingMode === BILLING_MODE_PER_TOKEN ? current.inputPrice : '',
      outputPrice:
        billingMode === BILLING_MODE_PER_TOKEN ? current.outputPrice : '',
      cacheReadPrice:
        billingMode === BILLING_MODE_PER_TOKEN ? current.cacheReadPrice : '',
      cacheWritePrice:
        billingMode === BILLING_MODE_PER_TOKEN ? current.cacheWritePrice : '',
      imageInputPrice:
        billingMode === BILLING_MODE_PER_TOKEN ? current.imageInputPrice : '',
      audioInputPrice:
        billingMode === BILLING_MODE_PER_TOKEN ? current.audioInputPrice : '',
      audioOutputPrice:
        billingMode === BILLING_MODE_PER_TOKEN ? current.audioOutputPrice : '',
    }));
  };

  const changeSpecMode = (event) => {
    const specMode = event.target.value;
    setFormState((current) => ({
      ...current,
      specMode,
      specSource: 'draft',
      specs:
        specMode !== SPEC_MODE_DISABLED && current.specs.length === 0
          ? [emptySpecRow()]
          : current.specs,
    }));
  };

  const updateSpec = (index, field, value) => {
    setFormState((current) => ({
      ...current,
      specSource: 'draft',
      specs: current.specs.map((spec, specIndex) =>
        specIndex === index ? { ...spec, [field]: value } : spec,
      ),
    }));
  };

  const addSpec = () => {
    setFormState((current) => ({
      ...current,
      specMode:
        current.specMode === SPEC_MODE_DISABLED
          ? SPEC_MODE_FIXED
          : current.specMode,
      specSource: 'draft',
      specs: [...current.specs, emptySpecRow()],
    }));
  };

  const removeSpec = (index) => {
    setFormState((current) => ({
      ...current,
      specSource: 'draft',
      specs: current.specs.filter((_, specIndex) => specIndex !== index),
    }));
  };

  const serializeSpecPricing = () => {
    if (formState.specMode === SPEC_MODE_DISABLED) return null;
    if (formState.specs.length === 0) {
      throw new Error(t('启用规格定价后至少需要一个规格'));
    }
    return {
      currency: 'CNY',
      billing_mode: formState.specMode,
      specs: formState.specs.map((spec, index) => {
        const base = {
          ...(spec.spec_key.trim() ? { spec_key: spec.spec_key.trim() } : {}),
          resolution: spec.resolution.trim(),
        };
        if (!base.resolution) {
          throw new Error(
            t('第 {{index}} 个规格缺少分辨率', { index: index + 1 }),
          );
        }
        if (formState.specMode === SPEC_MODE_FIXED) {
          return {
            ...base,
            duration_seconds:
              numericOrNull(spec.duration_seconds, t('规格时长'), false) || 0,
            price_cny: numericOrNull(spec.price_cny, t('规格价格'), true),
          };
        }
        return {
          ...base,
          cny_per_second: numericOrNull(
            spec.cny_per_second,
            t('每秒价格'),
            true,
          ),
        };
      }),
    };
  };

  const save = async () => {
    if (loading || loadError || !model?.id) {
      showError(t('定价尚未成功加载，禁止保存'));
      return;
    }
    setSaving(true);
    try {
      const perRequest = formState.billingMode === BILLING_MODE_PER_REQUEST;
      const perToken = formState.billingMode === BILLING_MODE_PER_TOKEN;
      const payload = {
        billing_mode: formState.billingMode,
        fixed_price: perRequest
          ? numericOrNull(formState.fixedPrice, t('按次价格'), true)
          : null,
        fixed_price_currency: perRequest
          ? formState.fixedPriceCurrency
          : null,
        input_price_usd_per_million: perToken
          ? numericOrNull(formState.inputPrice, t('输入价格'), true)
          : null,
        output_price_usd_per_million:
          perToken && !formState.completionRatioLocked
            ? numericOrNull(formState.outputPrice, t('输出价格'))
            : null,
        cache_read_price_usd_per_million: perToken
          ? numericOrNull(formState.cacheReadPrice, t('缓存读取价格'))
          : null,
        cache_write_price_usd_per_million: perToken
          ? numericOrNull(formState.cacheWritePrice, t('缓存写入价格'))
          : null,
        image_input_price_usd_per_million: perToken
          ? numericOrNull(formState.imageInputPrice, t('图片输入价格'))
          : null,
        audio_input_price_usd_per_million: perToken
          ? numericOrNull(formState.audioInputPrice, t('音频输入价格'))
          : null,
        audio_output_price_usd_per_million: perToken
          ? numericOrNull(formState.audioOutputPrice, t('音频输出价格'))
          : null,
        spec_pricing: serializeSpecPricing(),
      };
      const response = await API.put(
        `/api/models/${model.id}/pricing`,
        payload,
      );
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('保存定价失败'));
      }
      setFormState(modelPricingPolicyToFormState(response.data.data));
      showSuccess(t('模型定价已更新'));
      onSaved?.(response.data.data);
    } catch (requestError) {
      showError(
        requestError?.response?.data?.message ||
          requestError.message ||
          t('保存定价失败'),
      );
    } finally {
      setSaving(false);
    }
  };

  if (model?.name_rule !== 0) {
    return (
      <Banner
        className='model-pricing-rule-notice'
        type='warning'
        closeIcon={null}
        description={t(
          '规则模型会匹配多个真实模型，不能直接覆盖单一价格。请编辑具体的精确模型。',
        )}
      />
    );
  }

  if (loadError) {
    return (
      <Banner
        className='model-pricing-load-error'
        type='danger'
        closeIcon={null}
        description={loadError}
      />
    );
  }

  return (
    <Spin className='model-pricing-editor-loading' spinning={loading}>
      <div className='model-pricing-editor'>
        <div className='model-pricing-editor-header flex items-start justify-between gap-4 pb-4'>
          <div className='model-pricing-editor-heading'>
            <Text className='model-pricing-editor-title block text-base font-medium'>
              {t('统一定价')}
            </Text>
            <Text className='model-pricing-editor-description block text-xs !text-semi-color-text-2 mt-1'>
              {t(
                '直接填写可读价格；媒体按次价与规格价使用人民币，Token 按量价使用美元。',
              )}
            </Text>
          </div>
          <Button
            className='model-pricing-save shrink-0'
            theme='solid'
            type='primary'
            icon={<IconSave className='model-pricing-save-icon' />}
            loading={saving}
            disabled={loading || saving}
            onClick={save}
          >
            {t('保存定价')}
          </Button>
        </div>

        {formState.hasConflict ? (
          <Banner
            className='model-pricing-conflict mb-4'
            type='warning'
            closeIcon={null}
            description={t(
              '检测到该模型同时存在按次与按量配置。保存后将按当前选择硬切为单一计费模式。',
            )}
          />
        ) : null}

        <div className='model-pricing-base-section py-4 border-b border-solid border-semi-color-border'>
          <Text className='model-pricing-section-title block text-sm font-medium mb-3'>
            {t('基础计费')}
          </Text>
          <RadioGroup
            className='model-pricing-mode'
            type='button'
            value={formState.billingMode}
            onChange={changeBillingMode}
          >
            <Radio
              className='model-pricing-mode-unconfigured'
              value={BILLING_MODE_UNCONFIGURED}
            >
              {t('未配置')}
            </Radio>
            <Radio
              className='model-pricing-mode-token'
              value={BILLING_MODE_PER_TOKEN}
            >
              {t('按量计费')}
            </Radio>
            <Radio
              className='model-pricing-mode-request'
              value={BILLING_MODE_PER_REQUEST}
            >
              {t('按次计费')}
            </Radio>
          </RadioGroup>

          {formState.billingMode === BILLING_MODE_PER_REQUEST ? (
            <div className='model-pricing-request-fields mt-4'>
              <Text className='model-pricing-field-label block text-xs mb-1'>
                {t('基础按次价格')}
              </Text>
              <Input
                className='model-pricing-fixed-price'
                type='number'
                min={0}
                value={formState.fixedPrice}
                suffix={`${formState.fixedPriceCurrency || '—'} / request`}
                onChange={(value) => updateField('fixedPrice', value)}
              />
              {formState.specMode !== SPEC_MODE_DISABLED ? (
                <Text className='model-pricing-base-price-note block text-xs !text-semi-color-text-2 mt-2'>
                  {t(
                    '规格规则命中时，最终结算使用下方规格价；此值只作为基础预扣与无匹配规格时的按次价格。',
                  )}
                </Text>
              ) : null}
            </div>
          ) : null}

          {formState.billingMode === BILLING_MODE_PER_TOKEN ? (
            <div className='model-pricing-token-fields grid grid-cols-1 md:grid-cols-2 gap-4 mt-4'>
              {[
                ['inputPrice', t('输入'), 'USD / 1M tokens'],
                ['outputPrice', t('输出'), 'USD / 1M tokens'],
                ['cacheReadPrice', t('缓存读取'), 'USD / 1M tokens'],
                ['cacheWritePrice', t('缓存写入'), 'USD / 1M tokens'],
                ['imageInputPrice', t('图片输入'), 'USD / 1M tokens'],
                ['audioInputPrice', t('音频输入'), 'USD / 1M tokens'],
                ['audioOutputPrice', t('音频输出'), 'USD / 1M tokens'],
              ].map(([field, label, suffix]) => (
                <div className='model-pricing-token-field' key={field}>
                  <div className='model-pricing-token-label-row flex items-center gap-2 mb-1'>
                    <Text className='model-pricing-token-label text-xs'>
                      {label}
                    </Text>
                    {field === 'outputPrice' &&
                    formState.completionRatioLocked ? (
                      <Tag
                        className='model-pricing-locked-ratio'
                        size='small'
                        color='blue'
                      >
                        {t('固定倍率')} × {formState.lockedCompletionRatio}
                      </Tag>
                    ) : null}
                  </div>
                  <Input
                    className={`model-pricing-token-input model-pricing-token-input-${field}`}
                    type='number'
                    min={0}
                    value={formState[field]}
                    suffix={suffix}
                    disabled={
                      field === 'outputPrice' && formState.completionRatioLocked
                    }
                    onChange={(value) => updateField(field, value)}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className='model-pricing-spec-section pt-4'>
          <div className='model-pricing-spec-header flex items-center justify-between gap-4'>
            <div className='model-pricing-spec-heading'>
              <Text className='model-pricing-spec-title block text-sm font-medium'>
                {t('图片 / 视频规格定价')}
              </Text>
              <Text className='model-pricing-spec-description block text-xs !text-semi-color-text-2 mt-1'>
                {t(
                  '当前实际结算规则，单位 CNY；关闭后会显式停用，不会恢复隐藏规则。',
                )}
              </Text>
            </div>
            {formState.specSource === SPEC_SOURCE_SYSTEM_DEFAULT ? (
              <Tag
                className='model-pricing-spec-source-system shrink-0'
                size='small'
                color='orange'
              >
                {t('系统默认规则')}
              </Tag>
            ) : null}
            {formState.specSource === SPEC_SOURCE_MODEL ? (
              <Tag
                className='model-pricing-spec-source-model shrink-0'
                size='small'
                color='blue'
              >
                {t('模型专属规则')}
              </Tag>
            ) : null}
            {formState.specSource === SPEC_SOURCE_DISABLED ? (
              <Tag
                className='model-pricing-spec-source-disabled shrink-0'
                size='small'
                color='white'
              >
                {t('已显式关闭')}
              </Tag>
            ) : null}
          </div>

          <RadioGroup
            className='model-pricing-spec-mode mt-4'
            type='button'
            value={formState.specMode}
            onChange={changeSpecMode}
          >
            <Radio
              className='model-pricing-spec-mode-disabled'
              value={SPEC_MODE_DISABLED}
            >
              {t('关闭规格价')}
            </Radio>
            <Radio
              className='model-pricing-spec-mode-fixed'
              value={SPEC_MODE_FIXED}
            >
              {t('按规格固定价')}
            </Radio>
            <Radio
              className='model-pricing-spec-mode-linear'
              value={SPEC_MODE_LINEAR}
            >
              {t('分辨率 × 时长线性价')}
            </Radio>
          </RadioGroup>

          {formState.specSource === SPEC_SOURCE_SYSTEM_DEFAULT ? (
            <Banner
              className='model-pricing-spec-system-notice mt-3'
              type='warning'
              closeIcon={null}
              description={t(
                '当前扣费正在使用系统默认规格规则。修改并保存后会写入模型专属配置；选择关闭会真正停用该规则。',
              )}
            />
          ) : null}

          {formState.specMode === SPEC_MODE_LINEAR ? (
            <Text className='model-pricing-linear-formula block text-xs !text-semi-color-text-2 mt-3'>
              {t(
                '最终价 = 当前分辨率每秒价 × 请求时长；每个分辨率只配置一条每秒价格。',
              )}
            </Text>
          ) : null}

          {formState.specMode !== SPEC_MODE_DISABLED ? (
            <div className='model-pricing-spec-content mt-4'>
              <div className='model-pricing-spec-list'>
                {formState.specs.map((spec, index) => (
                  <div
                    className='model-pricing-spec-row grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 py-3 border-b border-solid border-semi-color-border last:border-b-0'
                    key={`${index}-${formState.specMode}`}
                  >
                    <Input
                      className='model-pricing-spec-resolution'
                      value={spec.resolution}
                      placeholder={t('分辨率，如 2k / 1080p')}
                      onChange={(value) =>
                        updateSpec(index, 'resolution', value)
                      }
                    />
                    {formState.specMode === SPEC_MODE_FIXED ? (
                      <Input
                        className='model-pricing-spec-duration'
                        type='number'
                        min={0}
                        value={spec.duration_seconds}
                        placeholder={t('时长秒；图片填 0')}
                        onChange={(value) =>
                          updateSpec(index, 'duration_seconds', value)
                        }
                      />
                    ) : (
                      <Input
                        className='model-pricing-spec-key'
                        value={spec.spec_key}
                        placeholder={t('规格标识（可选）')}
                        onChange={(value) =>
                          updateSpec(index, 'spec_key', value)
                        }
                      />
                    )}
                    <Input
                      className='model-pricing-spec-price'
                      type='number'
                      min={0}
                      value={
                        formState.specMode === SPEC_MODE_FIXED
                          ? spec.price_cny
                          : spec.cny_per_second
                      }
                      suffix={
                        formState.specMode === SPEC_MODE_FIXED
                          ? 'CNY'
                          : 'CNY / s'
                      }
                      placeholder={t('价格')}
                      onChange={(value) =>
                        updateSpec(
                          index,
                          formState.specMode === SPEC_MODE_FIXED
                            ? 'price_cny'
                            : 'cny_per_second',
                          value,
                        )
                      }
                    />
                    <Button
                      className='model-pricing-spec-delete'
                      theme='borderless'
                      type='danger'
                      icon={
                        <IconDelete className='model-pricing-spec-delete-icon' />
                      }
                      aria-label={t('删除规格')}
                      onClick={() => removeSpec(index)}
                    />
                  </div>
                ))}
              </div>
              <Button
                className='model-pricing-spec-add mt-3'
                theme='borderless'
                type='primary'
                icon={<IconPlus className='model-pricing-spec-add-icon' />}
                onClick={addSpec}
              >
                {t('添加规格')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Spin>
  );
};

export default ModelPricingEditorPanel;

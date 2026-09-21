import React, { useState } from 'react';
import { Button, Input, Typography } from '@douyinfe/semi-ui';
import { IconSave } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

export default function UpstreamPricingPanel({
  policy,
  modelId,
  onSaved,
  reload,
  t,
}) {
  const [multiplier, setMultiplier] = useState(
    String(policy.upstream.selling_multiplier),
  );
  const [saving, setSaving] = useState(false);
  const source = policy.upstream;
  const save = async () => {
    const value = Number(multiplier);
    if (!Number.isFinite(value) || value <= 0) {
      showError(t('售价倍率必须是正数'));
      return;
    }
    setSaving(true);
    try {
      const response = await API.put(`/api/models/${modelId}/pricing`, {
        selling_multiplier: value,
      });
      if (!response.data.success) throw new Error(response.data.message);
      showSuccess(t('模型定价已保存'));
      await reload();
      onSaved?.();
    } catch (error) {
      showError(error.message);
    } finally {
      setSaving(false);
    }
  };
  const rows = [];
  if (source.price.quota_type === 1) {
    rows.push([
      t('按次价格'),
      source.price.model_price,
      `${policy.fixed_price_currency} / request`,
    ]);
  } else {
    const input = source.price.model_ratio * 2;
    rows.push([t('输入'), input, 'USD / 1M tokens']);
    rows.push([
      t('输出'),
      input * source.price.completion_ratio,
      'USD / 1M tokens',
    ]);
    for (const [label, field] of [
      [t('缓存读取'), 'cache_ratio'],
      [t('缓存写入'), 'create_cache_ratio'],
      [t('图片输入'), 'image_ratio'],
      [t('音频输入'), 'audio_ratio'],
    ]) {
      if (source.price[field] != null)
        rows.push([label, input * source.price[field], 'USD / 1M tokens']);
    }
    if (
      source.price.audio_completion_ratio != null &&
      source.price.audio_ratio != null
    ) {
      rows.push([
        t('音频输出'),
        input * source.price.audio_ratio * source.price.audio_completion_ratio,
        'USD / 1M tokens',
      ]);
    }
  }
  source.spec_pricing?.specs.forEach((spec) => {
    const linear =
      source.spec_pricing.billing_mode === 'linear_by_duration_and_resolution';
    rows.push([
      `${spec.resolution} ${spec.duration_seconds ? `${spec.duration_seconds}s` : ''}`,
      linear ? spec.cny_per_second : spec.price_cny,
      linear ? 'CNY / s' : 'CNY',
    ]);
  });
  if (source.spec_pricing?.reference_image_price_cny > 0)
    rows.push([
      t('参考图单价'),
      source.spec_pricing.reference_image_price_cny,
      'CNY',
    ]);
  const valid = Number.isFinite(Number(multiplier)) && Number(multiplier) > 0;
  return (
    <div className='upstream-pricing-panel'>
      <Text className='upstream-pricing-description block mb-3'>
        {t('售价 = 上游价格 × 模型倍率；启动同步更新原价并保留倍率。')}
      </Text>
      <div className='upstream-pricing-controls flex items-center gap-3 mb-4'>
        <Input
          className='upstream-pricing-multiplier'
          type='number'
          aria-label={t('售价倍率')}
          prefix={t('售价倍率')}
          value={multiplier}
          onChange={setMultiplier}
          disabled={saving}
        />
        <Button
          className='upstream-pricing-save'
          theme='solid'
          icon={<IconSave className='upstream-pricing-save-icon' />}
          aria-label={t('保存倍率')}
          loading={saving}
          disabled={!valid || saving}
          onClick={save}
        />
      </div>
      <table className='upstream-pricing-table w-full text-left text-sm'>
        <thead className='upstream-pricing-head'>
          <tr className='upstream-pricing-heading'>
            <th className='upstream-pricing-label'>{t('计费项')}</th>
            <th className='upstream-pricing-source'>{t('上游价格')}</th>
            <th className='upstream-pricing-sale'>{t('售价预览')}</th>
          </tr>
        </thead>
        <tbody className='upstream-pricing-body'>
          {rows.map(([label, price, unit], index) => (
            <tr className='upstream-pricing-row' key={`${label}-${index}`}>
              <td className='upstream-pricing-cell py-2'>{label}</td>
              <td className='upstream-pricing-cell'>
                {price} {unit}
              </td>
              <td className='upstream-pricing-cell'>
                {valid
                  ? Number((price * Number(multiplier)).toPrecision(10))
                  : '—'}{' '}
                {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Text
        className='upstream-pricing-version block mt-3 text-xs'
        type='tertiary'
      >
        {t('上游价格版本')}：{source.version}
      </Text>
    </div>
  );
}

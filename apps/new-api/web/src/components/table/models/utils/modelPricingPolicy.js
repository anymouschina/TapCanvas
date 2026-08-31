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

export const BILLING_MODE_UNCONFIGURED = 'unconfigured';
export const BILLING_MODE_PER_TOKEN = 'per_token';
export const BILLING_MODE_PER_REQUEST = 'per_request';
export const SPEC_MODE_DISABLED = 'disabled';
export const SPEC_MODE_FIXED = 'fixed_by_spec';
export const SPEC_MODE_LINEAR = 'linear_by_duration_and_resolution';
export const SPEC_SOURCE_NONE = 'none';
export const SPEC_SOURCE_MODEL = 'model';
export const SPEC_SOURCE_SYSTEM_DEFAULT = 'system_default';
export const SPEC_SOURCE_DISABLED = 'disabled';

const BILLING_MODES = new Set([
  BILLING_MODE_UNCONFIGURED,
  BILLING_MODE_PER_TOKEN,
  BILLING_MODE_PER_REQUEST,
]);
const EFFECTIVE_SPEC_MODES = new Set([SPEC_MODE_FIXED, SPEC_MODE_LINEAR]);
const SPEC_SOURCES = new Set([
  SPEC_SOURCE_NONE,
  SPEC_SOURCE_MODEL,
  SPEC_SOURCE_SYSTEM_DEFAULT,
  SPEC_SOURCE_DISABLED,
]);
const ACTIVE_SPEC_SOURCES = new Set([
  SPEC_SOURCE_MODEL,
  SPEC_SOURCE_SYSTEM_DEFAULT,
]);
const FIXED_PRICE_CURRENCIES = new Set(['CNY', 'USD']);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toInputValue = (value) =>
  value === null || value === undefined ? '' : String(value);

const assertPositiveNumber = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`定价策略协议无效：${path} 必须是正数`);
  }
};

const assertEffectiveSpec = (spec, mode, index) => {
  const path = `spec_pricing.specs[${index}]`;
  if (!isRecord(spec)) {
    throw new Error(`定价策略协议无效：${path} 必须是对象`);
  }
  if (typeof spec.resolution !== 'string' || !spec.resolution.trim()) {
    throw new Error(`定价策略协议无效：${path}.resolution 不能为空`);
  }
  if (
    spec.duration_seconds !== undefined &&
    (!Number.isInteger(spec.duration_seconds) || spec.duration_seconds < 0)
  ) {
    throw new Error(
      `定价策略协议无效：${path}.duration_seconds 必须是非负整数`,
    );
  }
  if (mode === SPEC_MODE_FIXED) {
    assertPositiveNumber(spec.price_cny, `${path}.price_cny`);
    return;
  }
  assertPositiveNumber(spec.cny_per_second, `${path}.cny_per_second`);
};

const assertEffectiveSpecPricing = (policy) => {
  if (!hasOwn(policy, 'spec_pricing_source')) {
    throw new Error(
      '定价策略协议不完整：缺少 spec_pricing_source，请更新 new-api 后端后重试',
    );
  }
  if (!SPEC_SOURCES.has(policy.spec_pricing_source)) {
    throw new Error(
      `定价策略协议无效：未知 spec_pricing_source "${String(
        policy.spec_pricing_source,
      )}"`,
    );
  }
  if (!hasOwn(policy, 'spec_pricing')) {
    throw new Error('定价策略协议不完整：缺少 spec_pricing');
  }

  const active = ACTIVE_SPEC_SOURCES.has(policy.spec_pricing_source);
  if (!active) {
    if (policy.spec_pricing !== null) {
      throw new Error(
        `定价策略协议无效：${policy.spec_pricing_source} 来源必须返回 null spec_pricing`,
      );
    }
    return;
  }

  if (!isRecord(policy.spec_pricing)) {
    throw new Error(
      `定价策略协议无效：${policy.spec_pricing_source} 来源缺少有效 spec_pricing`,
    );
  }
  if (policy.spec_pricing.currency !== 'CNY') {
    throw new Error('定价策略协议无效：spec_pricing.currency 必须是 CNY');
  }
  if (!EFFECTIVE_SPEC_MODES.has(policy.spec_pricing.billing_mode)) {
    throw new Error(
      `定价策略协议无效：未知 spec_pricing.billing_mode "${String(
        policy.spec_pricing.billing_mode,
      )}"`,
    );
  }
  if (
    !Array.isArray(policy.spec_pricing.specs) ||
    policy.spec_pricing.specs.length === 0
  ) {
    throw new Error('定价策略协议无效：有效规格定价必须包含价格表');
  }
  policy.spec_pricing.specs.forEach((spec, index) =>
    assertEffectiveSpec(spec, policy.spec_pricing.billing_mode, index),
  );
};

export const createEmptyModelPricingFormState = () => ({
  billingMode: BILLING_MODE_UNCONFIGURED,
  fixedPrice: '',
  fixedPriceCurrency: '',
  inputPrice: '',
  outputPrice: '',
  cacheReadPrice: '',
  cacheWritePrice: '',
  imageInputPrice: '',
  audioInputPrice: '',
  audioOutputPrice: '',
  completionRatioLocked: false,
  lockedCompletionRatio: null,
  hasConflict: false,
  specMode: SPEC_MODE_DISABLED,
  specSource: SPEC_SOURCE_NONE,
  specs: [],
});

export const modelPricingPolicyToFormState = (policy) => {
  if (!isRecord(policy)) {
    throw new Error('定价策略协议无效：响应 data 必须是对象');
  }
  if (!BILLING_MODES.has(policy.billing_mode)) {
    throw new Error(
      `定价策略协议无效：未知 billing_mode "${String(policy.billing_mode)}"`,
    );
  }
  if (!FIXED_PRICE_CURRENCIES.has(policy.fixed_price_currency)) {
    throw new Error(
      `定价策略协议无效：fixed_price_currency 必须是 CNY 或 USD，收到 "${String(
        policy.fixed_price_currency,
      )}"`,
    );
  }
  if (policy.billing_mode === BILLING_MODE_PER_REQUEST) {
    assertPositiveNumber(policy.fixed_price, 'fixed_price');
  }
  assertEffectiveSpecPricing(policy);

  const specPricing = policy.spec_pricing;
  return {
    billingMode: policy.billing_mode,
    fixedPrice: toInputValue(policy.fixed_price),
    fixedPriceCurrency: policy.fixed_price_currency,
    inputPrice: toInputValue(policy.input_price_usd_per_million),
    outputPrice: toInputValue(policy.output_price_usd_per_million),
    cacheReadPrice: toInputValue(policy.cache_read_price_usd_per_million),
    cacheWritePrice: toInputValue(policy.cache_write_price_usd_per_million),
    imageInputPrice: toInputValue(policy.image_input_price_usd_per_million),
    audioInputPrice: toInputValue(policy.audio_input_price_usd_per_million),
    audioOutputPrice: toInputValue(policy.audio_output_price_usd_per_million),
    completionRatioLocked: Boolean(policy.completion_ratio_locked),
    lockedCompletionRatio: policy.locked_completion_ratio ?? null,
    hasConflict: Boolean(policy.has_conflicting_base_pricing),
    specMode: specPricing?.billing_mode || SPEC_MODE_DISABLED,
    specSource: policy.spec_pricing_source,
    specs:
      specPricing?.specs.map((spec) => ({
        spec_key: spec.spec_key || '',
        resolution: spec.resolution,
        duration_seconds: toInputValue(spec.duration_seconds ?? 0),
        price_cny: toInputValue(spec.price_cny),
        cny_per_second: toInputValue(spec.cny_per_second),
      })) || [],
  };
};

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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  modelPricingPolicyToFormState,
  SPEC_MODE_FIXED,
  SPEC_SOURCE_SYSTEM_DEFAULT,
} from './modelPricingPolicy.js';

const saverPolicy = {
  model_id: 505,
  model_name: 'gemini-3-pro-image-preview-saver',
  billing_mode: 'per_request',
  fixed_price: 0.3,
  fixed_price_currency: 'CNY',
  completion_ratio_locked: false,
  has_conflicting_base_pricing: false,
  ratios: {},
  spec_pricing_source: 'system_default',
  spec_pricing: {
    currency: 'CNY',
    billing_mode: 'fixed_by_spec',
    specs: [
      { spec_key: 'image:1k', resolution: '1k', price_cny: 0.3 },
      { spec_key: 'image:2k', resolution: '2k', price_cny: 0.3 },
      { spec_key: 'image:4k', resolution: '4k', price_cny: 0.5 },
    ],
  },
};

test('maps saver effective pricing to the selected fixed mode and full table', () => {
  const formState = modelPricingPolicyToFormState(saverPolicy);

  assert.equal(formState.specMode, SPEC_MODE_FIXED);
  assert.equal(formState.specSource, SPEC_SOURCE_SYSTEM_DEFAULT);
  assert.equal(formState.fixedPrice, '0.3');
  assert.equal(formState.fixedPriceCurrency, 'CNY');
  assert.deepEqual(
    formState.specs.map(({ resolution, duration_seconds, price_cny }) => ({
      resolution,
      duration_seconds,
      price_cny,
    })),
    [
      { resolution: '1k', duration_seconds: '0', price_cny: '0.3' },
      { resolution: '2k', duration_seconds: '0', price_cny: '0.3' },
      { resolution: '4k', duration_seconds: '0', price_cny: '0.5' },
    ],
  );
});

test('rejects a fixed price without an explicit currency', () => {
  const invalidPolicy = { ...saverPolicy };
  delete invalidPolicy.fixed_price_currency;

  assert.throws(
    () => modelPricingPolicyToFormState(invalidPolicy),
    /fixed_price_currency 必须是 CNY 或 USD/,
  );
});

test('rejects an old backend response instead of presenting it as disabled', () => {
  const oldBackendPolicy = { ...saverPolicy };
  delete oldBackendPolicy.spec_pricing_source;
  oldBackendPolicy.spec_pricing = null;

  assert.throws(
    () => modelPricingPolicyToFormState(oldBackendPolicy),
    /缺少 spec_pricing_source/,
  );
});

test('rejects an active source without an effective price table', () => {
  assert.throws(
    () =>
      modelPricingPolicyToFormState({
        ...saverPolicy,
        spec_pricing: null,
      }),
    /缺少有效 spec_pricing/,
  );
});

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
  cnyAmountToQuota,
  cnyPriceToRatio,
  quotaToCnyAmount,
  ratioToCnyPrice,
} from '../../../../helpers/cnyPricingUnit.js';

test('converts model ratio directly to its CNY input price', () => {
  assert.equal(ratioToCnyPrice(0.2), '0.4');
});

test('converts edited CNY input price back to model ratio without exchange rate', () => {
  assert.equal(cnyPriceToRatio(0.4), '0.2');
});

test('round-trips CNY prices without introducing an exchange multiplier', () => {
  assert.equal(ratioToCnyPrice(cnyPriceToRatio(2.92)), '2.92');
});

test('converts quota directly to CNY and back', () => {
  assert.equal(quotaToCnyAmount(200000, 500000), 0.4);
  assert.equal(cnyAmountToQuota(0.4, 500000), 200000);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCnyRange,
  getPriceRange,
  toPositiveNumber,
} from './pricingDisplay.js';

test('price range keeps only finite non-negative CNY values', () => {
  assert.equal(toPositiveNumber('not-a-price'), null);
  assert.equal(toPositiveNumber('1.25'), 1.25);
  assert.deepEqual(getPriceRange([null, '1.664', 3.9, Infinity]), {
    min: 1.664,
    max: 3.9,
  });
  assert.equal(formatCnyRange({ min: 1.664, max: 3.9 }), '¥1.6640–¥3.9000');
});

test('a single effective price is not rendered as a misleading range', () => {
  assert.equal(formatCnyRange({ min: 0.24, max: 0.24 }), '¥0.2400');
});

/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

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
  collectRemovedChannelModelNames,
  mergeChannelModelNames,
  normalizeChannelModelNames,
} from './channelModelSelection.js';

test('merges protocol suggestions without removing existing custom models', () => {
  assert.deepEqual(
    mergeChannelModelNames(
      ['gpt-5.4', 'deepseek-v4-flash'],
      ['gpt-5.4', 'gpt-5.5'],
    ),
    ['gpt-5.4', 'deepseek-v4-flash', 'gpt-5.5'],
  );
});

test('normalizes whitespace and duplicate model names deterministically', () => {
  assert.deepEqual(
    normalizeChannelModelNames([
      ' deepseek-v4-flash ',
      '',
      'gpt-5.4',
      'gpt-5.4',
    ]),
    ['deepseek-v4-flash', 'gpt-5.4'],
  );
});

test('reports every model that a full channel save would remove', () => {
  assert.deepEqual(
    collectRemovedChannelModelNames(
      ['gpt-5.4', 'deepseek-v4-flash', 'grok-4.5'],
      ['gpt-5.4', 'grok-4.5'],
    ),
    ['deepseek-v4-flash'],
  );
});

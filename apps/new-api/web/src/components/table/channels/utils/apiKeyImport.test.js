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
  buildApiKeyAppendRequest,
  normalizeApiKeyLines,
} from './apiKeyImport.js';

test('API key import trims CRLF, drops empty lines and deduplicates in input order', () => {
  assert.deepEqual(normalizeApiKeyLines('  first\r\n\nsecond \nfirst\n'), [
    'first',
    'second',
  ]);
});

test('append request contains only credential mutation fields and preserves existing channel configuration', () => {
  const channel = {
    id: 12,
    type: 77,
    channel_info: { is_multi_key: true },
    models: 'configured-model',
    setting: 'configured-setting',
  };
  assert.deepEqual(buildApiKeyAppendRequest(channel, ' first\nsecond'), {
    id: 12,
    type: 77,
    key: 'first\nsecond',
    key_mode: 'append',
  });
  assert.equal(channel.models, 'configured-model');
  assert.equal(channel.setting, 'configured-setting');
});

test('empty credentials and channels without a pool cannot produce an append request', () => {
  const channel = { id: 12, type: 77, channel_info: { is_multi_key: true } };
  assert.throws(() => buildApiKeyAppendRequest(channel, ' \n'), /至少一个/);
  assert.throws(
    () => buildApiKeyAppendRequest({ ...channel, channel_info: {} }, 'first'),
    /多密钥/,
  );
  assert.throws(
    () => buildApiKeyAppendRequest({ ...channel, id: null }, 'first'),
    /有效渠道/,
  );
});

test('optional email is trimmed metadata and never modifies the API keys', () => {
  const channel = { id: 12, type: 77, channel_info: { is_multi_key: true } };
  assert.deepEqual(
    buildApiKeyAppendRequest(channel, ' first\nsecond', ' owner@example.com '),
    {
      id: 12,
      type: 77,
      key: 'first\nsecond',
      key_mode: 'append',
      key_email: 'owner@example.com',
    },
  );
  assert.equal(
    'key_email' in buildApiKeyAppendRequest(channel, 'first', '  '),
    false,
  );
});

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSessionLogs, mergeSessionLogs } from './session-history.js';

const log = (id, extra = {}) => ({
  id,
  user_id: 1,
  token_id: 1,
  conversation_id: 'same',
  created_at: id,
  quota: 10,
  model_name: 'model',
  other: '{"admin_info":{"multi_key_index":0}}',
  ...extra,
});

test('history isolates user/token scopes even when conversation IDs match', () => {
  const result = aggregateSessionLogs([
    log(1),
    log(2),
    log(3, { user_id: 2 }),
    log(4, { token_id: 2 }),
  ]);
  assert.equal(result.length, 3);
  assert.equal(result.find((row) => row.count === 2).quota, 20);
  assert.deepEqual(result.find((row) => row.count === 2).keyIndexes, [0]);
});
test('requests without a conversation ID remain independent', () => {
  assert.equal(
    aggregateSessionLogs([
      log(1, { conversation_id: '' }),
      log(2, { conversation_id: '' }),
    ]).length,
    2,
  );
});
test('overlapping log pages do not double-count usage', () => {
  const result = aggregateSessionLogs(
    mergeSessionLogs([log(1), log(2)], [log(2), log(3)]),
  );
  assert.equal(result[0].count, 3);
  assert.equal(result[0].quota, 30);
});
test('malformed metadata is an explicit failure', () => {
  assert.throws(() => aggregateSessionLogs([log(1, { other: '{broken' })]));
});

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

// Consumption logs are historical evidence, not live account-affinity bindings.
export function mergeSessionLogs(previous, incoming) {
  const logs = new Map(previous.map((log) => [log.id, log]));
  incoming.forEach((log) => logs.set(log.id, log));
  return Array.from(logs.values());
}

export function aggregateSessionLogs(logs) {
  const groups = new Map();
  for (const log of logs) {
    // Different users/tokens can reuse a conversation ID. Requests without an
    // ID are independent records, not one synthetic conversation.
    const key = JSON.stringify([
      log.user_id,
      log.token_id,
      log.conversation_id || log.id,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        conversationId: log.conversation_id || '',
        latest: 0,
        count: 0,
        quota: 0,
        models: new Set(),
        keyIndexes: new Set(),
      };
      groups.set(key, group);
    }
    group.latest = Math.max(group.latest, log.created_at || 0);
    group.count += 1;
    group.quota += log.quota || 0;
    if (log.model_name) group.models.add(log.model_name);
    const other =
      typeof log.other === 'string' && log.other
        ? JSON.parse(log.other)
        : log.other;
    const index = other?.admin_info?.multi_key_index;
    if (Number.isInteger(index) && index >= 0) group.keyIndexes.add(index);
  }
  return Array.from(groups.values(), (group) => ({
    ...group,
    models: Array.from(group.models),
    keyIndexes: Array.from(group.keyIndexes),
  })).sort((a, b) => b.latest - a.latest);
}

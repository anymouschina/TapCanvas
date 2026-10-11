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

// Credential normalization is structural: one nonempty API key per line.
export const normalizeApiKeyLines = (input) => {
  if (typeof input !== 'string') throw new Error('API Key 输入必须是文本');
  return [
    ...new Set(
      input
        .split('\n')
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
};

export const buildApiKeyAppendRequest = (channel, input, email = '') => {
  if (!Number.isInteger(channel?.id) || channel.id <= 0) {
    throw new Error('请选择有效渠道');
  }
  if (!channel.channel_info?.is_multi_key) {
    throw new Error('渠道尚未开启多密钥模式');
  }
  const keys = normalizeApiKeyLines(input);
  if (keys.length === 0) throw new Error('请输入至少一个 API Key');
  return {
    id: channel.id,
    type: channel.type,
    key: keys.join('\n'),
    key_mode: 'append',
    ...(email.trim() ? { key_email: email.trim() } : {}),
  };
};

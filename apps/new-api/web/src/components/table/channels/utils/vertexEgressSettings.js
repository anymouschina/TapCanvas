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

const SUPPORTED_PROXY_PROTOCOLS = new Set([
  'http:',
  'https:',
  'socks5:',
  'socks5h:',
]);

export const formatVertexEgressCells = (cells) => {
  if (!Array.isArray(cells)) return '';
  return cells
    .filter(
      (cell) =>
        cell &&
        typeof cell.id === 'string' &&
        typeof cell.proxy_url === 'string',
    )
    .map((cell) => `${cell.id.trim()}|${cell.proxy_url.trim()}`)
    .filter((line) => !line.startsWith('|') && !line.endsWith('|'))
    .join('\n');
};

export const parseVertexEgressCells = (rawValue) => {
  const lines = String(rawValue || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const seenIDs = new Set();

  return lines.map((line, index) => {
    const separatorIndex = line.indexOf('|');
    if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
      throw new Error(
        `Dedicated Egress 第 ${index + 1} 行格式错误，应为 出口ID|代理地址`,
      );
    }
    const id = line.slice(0, separatorIndex).trim();
    const proxyUrl = line.slice(separatorIndex + 1).trim();
    if (seenIDs.has(id)) {
      throw new Error(`Dedicated Egress 出口 ID 重复: ${id}`);
    }
    seenIDs.add(id);

    let parsedUrl;
    try {
      parsedUrl = new URL(proxyUrl);
    } catch {
      throw new Error(`Dedicated Egress 出口 ${id} 的代理地址无效`);
    }
    if (!SUPPORTED_PROXY_PROTOCOLS.has(parsedUrl.protocol)) {
      throw new Error(
        `Dedicated Egress 出口 ${id} 仅支持 http、https、socks5 或 socks5h`,
      );
    }
    if (!parsedUrl.hostname) {
      throw new Error(`Dedicated Egress 出口 ${id} 的代理地址缺少主机`);
    }
    return { id, proxy_url: proxyUrl };
  });
};

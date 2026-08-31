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

export const MODEL_PRICING_OPTION_KEYS = [
  'ModelPrice',
  'ModelRatio',
  'CompletionRatio',
  'CacheRatio',
  'CreateCacheRatio',
  'ImageRatio',
  'AudioRatio',
  'AudioCompletionRatio',
];

const parseJSONObject = (rawValue, optionKey) => {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new Error(`${optionKey} 缺少有效的 JSON 配置`);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`${optionKey} 不是合法 JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${optionKey} 必须是 JSON 对象`);
  }
  return parsed;
};

export const parsePricingOptionMap = (key, rawValue) => {
  const parsed = parseJSONObject(rawValue, key);
  for (const [modelName, value] of Object.entries(parsed)) {
    if (!modelName.trim()) {
      throw new Error(`${key} 包含空模型名`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${key}[${modelName}] 必须是非负有限数字`);
    }
  }
  return parsed;
};

export const parsePricingOptionMaps = (options) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('模型定价配置必须是对象');
  }
  return Object.fromEntries(
    MODEL_PRICING_OPTION_KEYS.map((key) => [
      key,
      parsePricingOptionMap(key, options[key]),
    ]),
  );
};

export const parseCompletionRatioMetaMap = (rawValue) => {
  const optionKey = 'CompletionRatioMeta';
  const parsed = parseJSONObject(rawValue, optionKey);
  for (const [modelName, value] of Object.entries(parsed)) {
    if (
      !modelName.trim() ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.locked !== 'boolean' ||
      typeof value.ratio !== 'number' ||
      !Number.isFinite(value.ratio) ||
      value.ratio < 0
    ) {
      throw new Error(
        `${optionKey}[${modelName}] 必须包含合法的 locked 与 ratio`,
      );
    }
  }
  return parsed;
};

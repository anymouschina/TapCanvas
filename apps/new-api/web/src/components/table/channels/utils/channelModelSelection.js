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

export const normalizeChannelModelNames = (models) => {
  if (!Array.isArray(models)) return [];
  const seen = new Set();
  const normalized = [];
  for (const model of models) {
    if (typeof model !== 'string') continue;
    const modelName = model.trim();
    if (!modelName || seen.has(modelName)) continue;
    seen.add(modelName);
    normalized.push(modelName);
  }
  return normalized;
};

export const mergeChannelModelNames = (currentModels, suggestedModels) =>
  normalizeChannelModelNames([
    ...normalizeChannelModelNames(currentModels),
    ...normalizeChannelModelNames(suggestedModels),
  ]);

export const collectRemovedChannelModelNames = (
  initialModels,
  currentModels,
) => {
  const current = new Set(normalizeChannelModelNames(currentModels));
  return normalizeChannelModelNames(initialModels).filter(
    (modelName) => !current.has(modelName),
  );
};

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

const SPEC_MODE_DISABLED = 'disabled';

export const parsePersistedSpecPricing = (rawValue) => {
  if (!String(rawValue || '').trim()) return null;
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.billing_mode === SPEC_MODE_DISABLED) {
      return null;
    }
    return {
      mode: parsed?.billing_mode,
      count: Array.isArray(parsed?.specs) ? parsed.specs.length : 0,
    };
  } catch {
    return { invalid: true, count: 0 };
  }
};

export const hasPersistedSpecPricing = (rawValue) =>
  parsePersistedSpecPricing(rawValue) !== null;

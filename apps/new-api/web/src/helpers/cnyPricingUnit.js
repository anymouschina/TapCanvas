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

export const MODEL_RATIO_BASE_PRICE_CNY = 2;

const formatNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  return parseFloat(number.toFixed(12)).toString();
};

export const quotaToCnyAmount = (quota, quotaPerUnit) =>
  Number(quota) / Number(quotaPerUnit);

export const cnyAmountToQuota = (amountCNY, quotaPerUnit) =>
  Math.round(Number(amountCNY) * Number(quotaPerUnit));

export const ratioToCnyPrice = (ratio) => {
  const number = Number(ratio);
  if (!Number.isFinite(number)) {
    return '';
  }
  return formatNumber(number * MODEL_RATIO_BASE_PRICE_CNY);
};

export const cnyPriceToRatio = (priceCNY) => {
  const number = Number(priceCNY);
  if (!Number.isFinite(number)) {
    return '';
  }
  return formatNumber(number / MODEL_RATIO_BASE_PRICE_CNY);
};

export const toPositiveNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? numericValue
    : null;
};

export const getPriceRange = (prices) => {
  const validPrices = prices
    .map(toPositiveNumber)
    .filter((price) => price !== null);
  if (validPrices.length === 0) return null;
  return {
    min: Math.min(...validPrices),
    max: Math.max(...validPrices),
  };
};

export const formatCnyRange = (priceRange) => {
  if (!priceRange) return null;
  const min = priceRange.min.toFixed(4);
  const max = priceRange.max.toFixed(4);
  return min === max ? `¥${min}` : `¥${min}–¥${max}`;
};

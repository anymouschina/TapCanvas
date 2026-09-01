export function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数，收到：${value}`);
  }
  return parsed;
}

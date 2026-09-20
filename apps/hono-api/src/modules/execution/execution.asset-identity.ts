import { createHash } from 'node:crypto';

/** Hash structured facts, not labels or semantic similarity. Key order is irrelevant. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Asset identity requires JSON facts');
  return encoded;
}
export function assetFactIdentity(namespace: string, facts: unknown): string {
  return `${namespace}:${createHash('sha256').update(canonical(facts)).digest('hex')}`;
}
export function assetBindingIdentity(assetId: string, objectIdentity: string): string {
  return assetFactIdentity('asset-binding', { assetId, objectIdentity });
}

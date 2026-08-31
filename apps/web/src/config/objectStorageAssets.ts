export type WebObjectStorageProvider = 'tos' | 'r2'

type ObjectStoragePublicBases = Record<WebObjectStorageProvider, string>

function requireProvider(value: string | undefined): WebObjectStorageProvider {
  const provider = value?.trim().toLowerCase()
  if (provider === 'tos' || provider === 'r2') return provider
  throw new Error('VITE_OBJECT_STORAGE_PROVIDER must be either tos or r2')
}

function requirePublicBase(value: string | undefined, envKey: string): string {
  const normalized = value?.trim().replace(/\/+$/, '') ?? ''
  if (!normalized) throw new Error(`${envKey} is required`)
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`${envKey} must be an absolute URL`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`${envKey} must use https`)
  return normalized
}

export function buildObjectStorageAssetUrl(input: {
  provider: WebObjectStorageProvider
  publicBases: ObjectStoragePublicBases
  key: string
}): string {
  const key = input.key.trim().replace(/^\/+/, '')
  if (!key) throw new Error('Object storage asset key is required')
  const providerKey = input.provider === 'tos' ? `tapcanvas/legacy/${key}` : key
  return `${input.publicBases[input.provider]}/${providerKey}`
}

export const OBJECT_STORAGE_PROVIDER = requireProvider(
  import.meta.env.VITE_OBJECT_STORAGE_PROVIDER,
)

export const OBJECT_STORAGE_PUBLIC_BASES: ObjectStoragePublicBases = {
  tos: requirePublicBase(import.meta.env.VITE_TOS_PUBLIC_BASE_URL, 'VITE_TOS_PUBLIC_BASE_URL'),
  r2: requirePublicBase(import.meta.env.VITE_R2_PUBLIC_BASE_URL, 'VITE_R2_PUBLIC_BASE_URL'),
}

export const OBJECT_STORAGE_HOSTS = new Set(
  Object.values(OBJECT_STORAGE_PUBLIC_BASES).map((base) => new URL(base).hostname.toLowerCase()),
)

export function hostedAssetUrl(key: string): string {
  return buildObjectStorageAssetUrl({
    provider: OBJECT_STORAGE_PROVIDER,
    publicBases: OBJECT_STORAGE_PUBLIC_BASES,
    key,
  })
}

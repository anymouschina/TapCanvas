function stripTrailingMentionPunctuation(value: string): string {
  return value.replace(/[，。！？、；：,.!?;:)'"]+$/gu, '')
}

/**
 * Returns the identifier portion of a prompt mention without changing its
 * casing. Punctuation is kept outside the identifier so `@asset-id,` still
 * resolves to the same asset while preserving the comma in the editor.
 */
export function getPromptMentionTokenCore(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return ''
  return stripTrailingMentionPunctuation(value.replace(/^@+/, ''))
}

/**
 * Prompt references are deterministic identifiers, not fuzzy text matches.
 * Whitespace therefore makes a value ineligible as a token alias; display
 * names with spaces remain available to the suggestion UI but cannot collide
 * with the `@token` parser.
 */
export function normalizePromptMentionAlias(raw: unknown): string {
  const core = getPromptMentionTokenCore(raw)
  if (!core || /\s/u.test(core)) return ''
  return core.toLowerCase()
}

export type PromptMentionAliasInput = {
  aliases?: readonly unknown[]
  nodeId?: unknown
  assetId?: unknown
  assetRefId?: unknown
  name?: unknown
  displayName?: unknown
}

export function collectPromptMentionAliases(input: PromptMentionAliasInput): string[] {
  const candidates = [
    input.nodeId,
    input.assetId,
    input.assetRefId,
    input.name,
    input.displayName,
    ...(input.aliases || []),
  ]
  const aliases: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const normalized = normalizePromptMentionAlias(candidate)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    aliases.push(normalized)
  }
  return aliases
}

export function extractPromptMentionTokens(raw: string): string[] {
  const matches = String(raw || '').match(/@[^\s@]+/g) || []
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const match of matches) {
    const normalized = normalizePromptMentionAlias(match)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    tokens.push(normalized)
  }
  return tokens
}

export function buildPromptMentionAliasMap<T extends { username: string; aliases?: readonly string[]; displayName?: string }>(
  entries: readonly T[],
): Map<string, T> {
  const aliases = new Map<string, T | null>()
  for (const entry of entries) {
    const entryAliases = collectPromptMentionAliases({
      aliases: [entry.username, ...(entry.aliases || [])],
      displayName: entry.displayName,
    })
    for (const alias of entryAliases) {
      const existing = aliases.get(alias)
      if (existing && existing !== entry) {
        aliases.set(alias, null)
        continue
      }
      if (existing === null) continue
      aliases.set(alias, entry)
    }
  }
  const resolved = new Map<string, T>()
  for (const [alias, entry] of aliases) {
    if (entry) resolved.set(alias, entry)
  }
  return resolved
}

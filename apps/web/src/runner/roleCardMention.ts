export type RoleCardMentionToken = {
  raw: string
  rawDisplay: string
  roleNameKey: string
  stateKey: string
  disambiguatorKey: string
}

function normalizeMentionText(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, '')
    .toLowerCase()
}

function normalizeMentionKey(raw: string): string {
  return String(raw || '').trim().toLowerCase()
}

function normalizeStateQueryKey(raw: string): string {
  return normalizeMentionKey(raw).replace(/[\s_\-—–/／:：|｜]+/g, '')
}

function splitRoleNameAndState(core: string): { roleNamePart: string; statePart: string } {
  const trimmed = String(core || '').trim()
  if (!trimmed) return { roleNamePart: '', statePart: '' }
  const separators = ['-', '—', '–', '/', '／', ':', '：', '|', '｜']
  let splitIndex = -1
  for (const separator of separators) {
    const index = trimmed.lastIndexOf(separator)
    if (index > 0 && index < trimmed.length - 1) {
      splitIndex = Math.max(splitIndex, index)
    }
  }
  if (splitIndex <= 0) return { roleNamePart: trimmed, statePart: '' }
  return {
    roleNamePart: trimmed.slice(0, splitIndex).trim(),
    statePart: trimmed.slice(splitIndex + 1).trim(),
  }
}

export function parseRoleCardMentionToken(rawMention: string): RoleCardMentionToken | null {
  const cleaned = String(rawMention || '').trim()
  if (!cleaned) return null
  const normalized = normalizeMentionText(cleaned)
  if (!normalized) return null
  const [corePart, disambiguatorPart] = normalized.split('#', 2)
  const { roleNamePart, statePart } = splitRoleNameAndState(corePart || '')
  const roleNameKey = normalizeMentionKey(roleNamePart || '')
  if (!roleNameKey) return null
  return {
    raw: cleaned,
    rawDisplay: cleaned.replace(/^@+/, '@'),
    roleNameKey,
    stateKey: normalizeStateQueryKey(statePart || ''),
    disambiguatorKey: normalizeMentionKey(disambiguatorPart || ''),
  }
}

export function extractRoleCardMentionTokens(text: string): RoleCardMentionToken[] {
  const raw = String(text || '')
  if (!raw) return []
  const matches = raw.match(/@[^\s@]+/g) || []
  const out: RoleCardMentionToken[] = []
  const seen = new Set<string>()
  for (const match of matches) {
    const token = parseRoleCardMentionToken(match)
    if (!token) continue
    const dedupeKey = `${token.roleNameKey}:${token.stateKey}:${token.disambiguatorKey}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(token)
    if (out.length >= 12) break
  }
  return out
}

export function doesRoleCardStateMatchQuery(input: {
  queryStateKey: string
  ageDescription?: string
  stateDescription?: string
  stateLabel?: string
  stateKey?: string
}): boolean {
  const queryKey = normalizeStateQueryKey(input.queryStateKey)
  if (!queryKey) return true
  const candidates = [
    input.stateKey,
    input.stateLabel,
    input.stateDescription,
    input.ageDescription,
  ]
    .map((item) => normalizeStateQueryKey(String(item || '')))
    .filter(Boolean)
  if (candidates.length === 0) return false
  return candidates.some((candidate) => candidate === queryKey || candidate.includes(queryKey) || queryKey.includes(candidate))
}

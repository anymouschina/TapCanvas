import { API_BASE, type CommerceProductDto } from '../api/server'

export type AccountProfile = {
  id: string
  login: string
  name: string
  avatarUrl: string | null
  bio: string | null
  email: string | null
  phone: string | null
  guest: boolean
  createdAt: string
}

export type AccountProject = {
  id: string
  name: string
  description: string | null
  coverUrl: string | null
  isPublic: boolean
  publishedAt: string | null
  likeCount: number
  viewCount: number
  updatedAt: string
}

export type AccountPublishedWork = {
  id: string
  title: string
  description: string | null
  videoUrl: string
  coverImageUrl: string | null
  publishedAt: string
  published: boolean
  sourceProjectId: string | null
  sourceProjectName: string | null
  sourceOwnerType: 'project' | 'chapter' | 'shortFilm' | null
  sourceOwnerId: string | null
  sourceChapterTitle: string | null
}

export type AccountOverview = {
  profile: AccountProfile
  credits: { balance: number; frozen: number }
  unreadCount: number
  membership: {
    enabled: boolean
    configured: boolean
    current: {
      planCode: string
      planName: string
      startAt: string
      endAt: string
      billingCycle: 'monthly' | 'annual'
      monthlyCredits: number
      dailyGiftCredits: number
      concurrencyLimit: number
      capacityLabel: string
    } | null
    plans: CommerceProductDto[]
  }
  guestRestricted: boolean
  checkIn: AccountCheckIn | null
}

export type AccountCheckIn = {
  configured: boolean
  enabled: boolean
  rewardCredits: number | null
  today: string
  checkedInToday: boolean
  cumulativeDays: number
  missedDays: number
  balance: number
}

export type AccountNotification = {
  id: string
  type: string
  title: string
  body: string
  actionUrl: string | null
  metadata: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

export type AccountSession = {
  id: string
  deviceLabel: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  revokedAt: string | null
  revokedReason: string | null
  active: boolean
  current: boolean
}

export type AccountCreditEntry = {
  id: string
  type: string
  amount: number
  taskId: string | null
  taskKind: string | null
  note: string | null
  createdAt: string
  creditsTotalAfter: number
  creditsFrozenAfter: number
  creditsAvailableAfter: number
  settlesReservation: boolean
}

export type AccountCreditsPage = CursorPage<AccountCreditEntry> & {
  creditsTotal: number
  creditsFrozen: number
  creditsAvailable: number
}

function accountContractRecord(value: unknown, scope: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${scope}响应合同不匹配：预期对象`)
  }
  return value as Record<string, unknown>
}

function accountContractString(record: Record<string, unknown>, key: string, scope: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`${scope}响应合同不匹配：${key} 必须是字符串`)
  return value
}

function accountContractNullableString(record: Record<string, unknown>, key: string, scope: string): string | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${scope}响应合同不匹配：${key} 必须是字符串或 null`)
  return value
}

function accountContractNumber(record: Record<string, unknown>, key: string, scope: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${scope}响应合同不匹配：${key} 必须是有限数值`)
  }
  return value
}

function accountContractBoolean(record: Record<string, unknown>, key: string, scope: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new Error(`${scope}响应合同不匹配：${key} 必须是布尔值`)
  return value
}

export function parseAccountCreditsPage(value: unknown): AccountCreditsPage {
  const scope = '积分账单'
  const record = accountContractRecord(value, scope)
  const rawItems = record.items
  if (!Array.isArray(rawItems)) throw new Error(`${scope}响应合同不匹配：items 必须是数组`)
  const nextCursor = accountContractNullableString(record, 'nextCursor', scope)
  return {
    creditsTotal: accountContractNumber(record, 'creditsTotal', scope),
    creditsFrozen: accountContractNumber(record, 'creditsFrozen', scope),
    creditsAvailable: accountContractNumber(record, 'creditsAvailable', scope),
    nextCursor,
    items: rawItems.map((value, index) => {
      const itemScope = `${scope}第 ${index + 1} 条记录`
      const item = accountContractRecord(value, itemScope)
      return {
        id: accountContractString(item, 'id', itemScope),
        type: accountContractString(item, 'type', itemScope),
        amount: accountContractNumber(item, 'amount', itemScope),
        taskId: accountContractNullableString(item, 'taskId', itemScope),
        taskKind: accountContractNullableString(item, 'taskKind', itemScope),
        note: accountContractNullableString(item, 'note', itemScope),
        createdAt: accountContractString(item, 'createdAt', itemScope),
        creditsTotalAfter: accountContractNumber(item, 'creditsTotalAfter', itemScope),
        creditsFrozenAfter: accountContractNumber(item, 'creditsFrozenAfter', itemScope),
        creditsAvailableAfter: accountContractNumber(item, 'creditsAvailableAfter', itemScope),
        settlesReservation: accountContractBoolean(item, 'settlesReservation', itemScope),
      }
    }),
  }
}

type CursorPage<T> = { items: T[]; nextCursor: string | null }

export type SavedAccountValidation =
  | { valid: true; overview: AccountOverview }
  | { valid: false; status: number; message: string }

export const SAVED_ACCOUNT_PROBE_HEADER = 'X-TapCanvas-Source'
export const SAVED_ACCOUNT_PROBE_VALUE = 'saved-account-candidate'

async function readErrorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  const message = body && typeof body === 'object'
    ? String((body as Record<string, unknown>).error || (body as Record<string, unknown>).message || '')
    : ''
  return message || `请求失败 (${response.status})`
}

async function accountRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return await response.json() as T
}

function cursorPath(path: string, cursor?: string | null): string {
  const query = new URLSearchParams({ limit: '20' })
  if (cursor) query.set('cursor', cursor)
  return `${path}?${query.toString()}`
}

export const getAccountOverview = (): Promise<AccountOverview> => accountRequest('/account/overview')
export async function validateSavedAccount(): Promise<SavedAccountValidation> {
  const response = await fetch(`${API_BASE}/account/overview`, {
    credentials: 'include',
    headers: {
      [SAVED_ACCOUNT_PROBE_HEADER]: SAVED_ACCOUNT_PROBE_VALUE,
    },
  })
  if (!response.ok) {
    return { valid: false, status: response.status, message: await readErrorMessage(response) }
  }
  return { valid: true, overview: await response.json() as AccountOverview }
}
export const getAccountProfile = (): Promise<AccountProfile> => accountRequest('/account/profile')
export const updateAccountProfile = (payload: { name?: string; bio?: string | null; avatarUrl?: string | null }): Promise<AccountProfile> =>
  accountRequest('/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
export const getAccountCheckIn = (): Promise<AccountCheckIn> => accountRequest('/account/check-in')
export const performAccountCheckIn = (): Promise<AccountCheckIn & { awarded: boolean }> => accountRequest('/account/check-in', { method: 'POST' })
export const listAccountWorks = (cursor?: string | null): Promise<CursorPage<AccountPublishedWork>> => accountRequest(cursorPath('/account/works', cursor))
export const updateAccountWorkPublication = (id: string, published: boolean): Promise<{ id: string; published: boolean }> =>
  accountRequest(`/account/works/${encodeURIComponent(id)}/publication`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published }) })
export const deleteAccountWork = (id: string): Promise<{ id: string; deleted: boolean }> =>
  accountRequest(`/account/works/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const listAccountLikes = (cursor?: string | null): Promise<CursorPage<{
  likeId: string
  likedAt: string
  available: boolean
  project: (AccountProject & { owner: { login: string; name: string | null; avatarUrl: string | null } | null }) | null
}>> => accountRequest(cursorPath('/account/likes', cursor))
export const listAccountCredits = async (cursor?: string | null): Promise<AccountCreditsPage> =>
  parseAccountCreditsPage(await accountRequest<unknown>(cursorPath('/account/credits', cursor)))
export const listAccountNotifications = (filter: 'all' | 'unread' | 'read', cursor?: string | null): Promise<CursorPage<AccountNotification> & { unreadCount: number }> => {
  const query = new URLSearchParams({ limit: '20', filter })
  if (cursor) query.set('cursor', cursor)
  return accountRequest(`/account/notifications?${query.toString()}`)
}
export const readAccountNotification = (id: string): Promise<{ id: string; readAt: string; updated: boolean }> =>
  accountRequest(`/account/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })
export const readAllAccountNotifications = (): Promise<{ updatedCount: number; readAt: string }> =>
  accountRequest('/account/notifications/read-all', { method: 'POST' })
export const listAccountSessions = (): Promise<{ items: AccountSession[] }> => accountRequest('/account/sessions')
export const revokeAccountSession = (id: string): Promise<{ id: string; revokedAt: string; current: boolean }> =>
  accountRequest(`/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const logoutAccount = (): Promise<{ revoked: boolean }> => accountRequest('/account/logout', { method: 'POST' })

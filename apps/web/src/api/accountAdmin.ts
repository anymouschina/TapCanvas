import { API_BASE } from './server'

export type AccountAdminSettings = {
  checkInEnabled: boolean
  checkInRewardCredits: number
  membershipEnabled: boolean
  sessionTtlDays: number
  maxActiveSessions: number
}

export type AccountAdminSettingsState = {
  configured: boolean
  settings: AccountAdminSettings | null
  effectiveSessionTtlDays: number
  effectiveMaxActiveSessions: number
}

export type AccountAdminSession = {
  id: string
  userId: string
  userName: string
  deviceLabel: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  revokedAt: string | null
  revokedReason: string | null
}

export type AccountAdminNotification = {
  id: string
  userId: string
  userName: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.headers || {}) },
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const message = body && typeof body === 'object'
      ? String((body as Record<string, unknown>).error || (body as Record<string, unknown>).message || '')
      : ''
    throw new Error(message || `请求失败 (${response.status})`)
  }
  return await response.json() as T
}

export const getAccountAdminSettings = (): Promise<AccountAdminSettingsState> => adminRequest('/admin/account/settings')
export const saveAccountAdminSettings = (settings: AccountAdminSettings): Promise<AccountAdminSettingsState> =>
  adminRequest('/admin/account/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
export const listAccountAdminSessions = (): Promise<{ items: AccountAdminSession[]; nextCursor: string | null }> =>
  adminRequest('/admin/account/sessions?limit=100&activeOnly=true')
export const revokeAccountAdminSession = (id: string): Promise<{ id: string; revokedAt: string }> =>
  adminRequest(`/admin/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const listAccountAdminNotifications = (): Promise<{ items: AccountAdminNotification[]; nextCursor: string | null }> =>
  adminRequest('/admin/account/notifications?limit=50')
export const createAccountAdminNotification = (payload: {
  audience: 'all' | 'users'
  userIds?: string[]
  type: string
  title: string
  body: string
  actionUrl?: string | null
}): Promise<{ createdCount: number; createdAt: string }> =>
  adminRequest('/admin/account/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

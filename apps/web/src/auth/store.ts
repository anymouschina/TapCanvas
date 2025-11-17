import { create } from 'zustand'

type User = { sub: string|number; login: string; name?: string; avatarUrl?: string; email?: string }

function base64UrlDecode(input: string): string {
  input = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = input.length % 4
  if (pad) input += '='.repeat(4 - pad)
  try { return atob(input) } catch { return '' }
}

function decodeJwtUser(token: string | null): User | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    const u: User = { sub: payload.sub, login: payload.login, name: payload.name, avatarUrl: payload.avatarUrl, email: payload.email }
    return u
  } catch { return null }
}

const initialToken = localStorage.getItem('tap_token')
const initialUser = (() => {
  const cached = localStorage.getItem('tap_user')
  if (cached) { try { return JSON.parse(cached) as User } catch {} }
  return decodeJwtUser(initialToken)
})()

type AuthState = {
  token: string | null
  user: User | null
  loading: boolean
  login: (code: string, state?: string) => Promise<void>
  setAuth: (token: string, user?: User | null) => void
  clear: () => void
}

export const useAuth = create<AuthState>((set, get) => ({
  token: initialToken,
  user: initialUser,
  loading: false,
  login: async (code: string, state?: string) => {
    set({ loading: true })
    try {
      const response = await fetch('/api/auth/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, state }),
      })

      if (!response.ok) {
        throw new Error('Authentication failed')
      }

      const data = await response.json()
      get().setAuth(data.token, data.user)
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    } finally {
      set({ loading: false })
    }
  },
  setAuth: (token, user) => {
    localStorage.setItem('tap_token', token)
    const u = user ?? decodeJwtUser(token)
    if (u) localStorage.setItem('tap_user', JSON.stringify(u)); else localStorage.removeItem('tap_user')
    set({ token, user: u || null })
  },
  clear: () => { localStorage.removeItem('tap_token'); localStorage.removeItem('tap_user'); set({ token: null, user: null }) },
}))

export function getAuthToken() { return localStorage.getItem('tap_token') }

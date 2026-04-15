const PASSWORD_SETUP_GUIDE_KEY = 'tapcanvas_password_setup_guide'

type PasswordSetupGuidePayload = {
  phone: string
  createdAt: string
}

function readPayload(): PasswordSetupGuidePayload | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(PASSWORD_SETUP_GUIDE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PasswordSetupGuidePayload>
    if (typeof parsed.phone !== 'string' || !parsed.phone.trim()) return null
    if (typeof parsed.createdAt !== 'string' || !parsed.createdAt.trim()) return null
    return { phone: parsed.phone, createdAt: parsed.createdAt }
  } catch {
    return null
  }
}

export function markPasswordSetupGuidePending(phone: string): void {
  if (typeof window === 'undefined') return
  const normalizedPhone = String(phone || '').trim()
  if (!normalizedPhone) return
  const payload: PasswordSetupGuidePayload = {
    phone: normalizedPhone,
    createdAt: new Date().toISOString(),
  }
  window.sessionStorage.setItem(PASSWORD_SETUP_GUIDE_KEY, JSON.stringify(payload))
}

export function readPasswordSetupGuidePending(): PasswordSetupGuidePayload | null {
  return readPayload()
}

export function clearPasswordSetupGuidePending(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(PASSWORD_SETUP_GUIDE_KEY)
}

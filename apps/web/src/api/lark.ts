import { API_BASE } from './server'

export type LarkApp = { appId: string; brand: string }
export type LarkWikiNode = { node_token: string; title: string; obj_type: string; space_id: string; has_child: boolean }
export type LarkBase = { token: string; name: string; folder_token?: string }

function authHeaders(): HeadersInit {
  return {}
}

export async function getLarkApp(): Promise<LarkApp | null> {
  const r = await fetch(`${API_BASE}/lark/app`, {
    credentials: 'include',
    headers: authHeaders(),
  })
  if (!r.ok) throw new Error(`getLarkApp failed: ${r.status}`)
  const d = await r.json() as { app: LarkApp | null }
  return d.app
}

export async function saveLarkApp(input: { appId: string; appSecret: string; brand?: string }): Promise<LarkApp> {
  const r = await fetch(`${API_BASE}/lark/app`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ appId: input.appId, appSecret: input.appSecret, brand: input.brand ?? 'feishu' }),
  })
  if (!r.ok) throw new Error(`saveLarkApp failed: ${r.status}`)
  const d = await r.json() as { app: LarkApp }
  return d.app
}

export async function listLarkWiki(): Promise<LarkWikiNode[]> {
  const r = await fetch(`${API_BASE}/lark/wiki`, {
    credentials: 'include',
    headers: authHeaders(),
  })
  if (!r.ok) throw new Error(`listLarkWiki failed: ${r.status}`)
  const d = await r.json() as { items: LarkWikiNode[] }
  return d.items ?? []
}

export async function connectLarkWiki(url: string): Promise<void> {
  const r = await fetch(`${API_BASE}/lark/wiki/connect`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ url }),
  })
  const d = await r.json().catch(() => ({})) as { error?: string }
  if (!r.ok) throw new Error(d.error ?? `connectWiki failed: ${r.status}`)
}

export async function listLarkBases(): Promise<LarkBase[]> {
  const r = await fetch(`${API_BASE}/lark/bases`, {
    credentials: 'include',
    headers: authHeaders(),
  })
  if (!r.ok) throw new Error(`listLarkBases failed: ${r.status}`)
  const d = await r.json() as { items: LarkBase[] }
  return d.items ?? []
}

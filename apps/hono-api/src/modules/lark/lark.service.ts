import type { AppContext } from '../../types'
import { execute, queryOne } from '../../db/db'
import { randomUUID } from 'node:crypto'
import type { SaveLarkAppInput } from './lark.schemas'

const BRAND_BASE: Record<string, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
}

async function fetchTAT(appId: string, appSecret: string, brand: string): Promise<string> {
  const base = BRAND_BASE[brand] ?? BRAND_BASE.feishu
  const r = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  if (!r.ok) throw new Error(`TAT HTTP ${r.status}`)
  const d = await r.json() as { code: number; msg: string; tenant_access_token?: string }
  if (d.code !== 0 || !d.tenant_access_token) throw new Error(`TAT error [${d.code}]: ${d.msg}`)
  return d.tenant_access_token
}

export async function getLarkApp(c: AppContext, userId: string) {
  const row = await queryOne<{ id: string; app_id: string; brand: string; ticket_chat_id: string | null; ticket_mention_mobiles: string | null }>(
    c.env.DB,
    `SELECT id, app_id, brand, ticket_chat_id, ticket_mention_mobiles FROM user_lark_apps WHERE user_id = $1`,
    [userId],
  )
  if (!row) return null
  return {
    appId: row.app_id,
    brand: row.brand,
    ticketChatId: row.ticket_chat_id ?? null,
    ticketMentionMobiles: row.ticket_mention_mobiles
      ? String(row.ticket_mention_mobiles)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  }
}

export async function getLarkAppCredentials(c: AppContext, userId: string) {
  const row = await queryOne<{ app_id: string; app_secret: string; brand: string }>(
    c.env.DB,
    `SELECT app_id, app_secret, brand FROM user_lark_apps WHERE user_id = $1`,
    [userId],
  )
  if (!row) return null
  return { appId: row.app_id, appSecret: row.app_secret, brand: row.brand }
}

export async function saveLarkApp(c: AppContext, userId: string, input: SaveLarkAppInput) {
  const id = randomUUID()
  await execute(
    c.env.DB,
    `INSERT INTO user_lark_apps (id, user_id, app_id, app_secret, brand, ticket_chat_id, ticket_mention_mobiles, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
     ON CONFLICT (user_id) DO UPDATE SET app_id=$3, app_secret=$4, brand=$5, ticket_chat_id=$6, ticket_mention_mobiles=$7, updated_at=NOW()`,
    [
      id,
      userId,
      input.appId,
      input.appSecret,
      input.brand,
      input.ticketChatId ?? null,
      input.ticketMentionMobiles?.length ? input.ticketMentionMobiles.join(',') : null,
    ],
  )
  return {
    appId: input.appId,
    brand: input.brand,
    ticketChatId: input.ticketChatId ?? null,
    ticketMentionMobiles: input.ticketMentionMobiles ?? [],
  }
}

// connect: validate root node URL, store space_id + root_token
export async function connectLarkWiki(c: AppContext, userId: string, wikiUrl: string) {
  const row = await queryOne<{ app_id: string; app_secret: string; brand: string }>(
    c.env.DB,
    `SELECT app_id, app_secret, brand FROM user_lark_apps WHERE user_id = $1`,
    [userId],
  )
  if (!row) throw new Error('no_app')

  // extract node token from URL: /wiki/<token>
  const match = wikiUrl.match(/\/wiki\/([A-Za-z0-9]+)/)
  const rootToken = match?.[1]
  if (!rootToken) throw new Error('invalid_url')

  const tat = await fetchTAT(row.app_id, row.app_secret, row.brand)
  const base = BRAND_BASE[row.brand] ?? BRAND_BASE.feishu

  // resolve space_id via get_node
  const nodeRes = await fetch(`${base}/open-apis/wiki/v2/spaces/get_node?token=${rootToken}`, {
    headers: { Authorization: `Bearer ${tat}` },
  })
  const nodeData = await nodeRes.json() as { code: number; msg?: string; data?: { node?: { space_id?: string; node_token?: string } } }
  if (nodeData.code !== 0) throw new Error(`get_node failed [${nodeData.code}]: ${nodeData.msg}`)
  const spaceId = nodeData.data?.node?.space_id
  if (!spaceId) throw new Error('cannot resolve space_id')

  await execute(
    c.env.DB,
    `UPDATE user_lark_apps SET wiki_root_token=$1, wiki_space_id=$2, updated_at=NOW() WHERE user_id=$3`,
    [rootToken, spaceId, userId],
  )
  return { rootToken, spaceId }
}

export async function listLarkWiki(c: AppContext, userId: string) {
  const row = await queryOne<{ app_id: string; app_secret: string; brand: string; wiki_root_token: string | null; wiki_space_id: string | null }>(
    c.env.DB,
    `SELECT app_id, app_secret, brand, wiki_root_token, wiki_space_id FROM user_lark_apps WHERE user_id = $1`,
    [userId],
  )
  if (!row) throw new Error('no_app')
  if (!row.wiki_root_token || !row.wiki_space_id) return []

  const tat = await fetchTAT(row.app_id, row.app_secret, row.brand)
  const base = BRAND_BASE[row.brand] ?? BRAND_BASE.feishu
  const r = await fetch(
    `${base}/open-apis/wiki/v2/spaces/${row.wiki_space_id}/nodes?parent_node_token=${row.wiki_root_token}&page_size=50`,
    { headers: { Authorization: `Bearer ${tat}` } },
  )
  const d = await r.json() as { code: number; msg?: string; data?: { items?: unknown[] } }
  if (d.code !== 0) throw new Error(`wiki/nodes error [${d.code}]: ${d.msg}`)
  return d.data?.items ?? []
}

export async function listLarkBases(c: AppContext, userId: string) {
  const row = await queryOne<{ app_id: string; app_secret: string; brand: string }>(
    c.env.DB,
    `SELECT app_id, app_secret, brand FROM user_lark_apps WHERE user_id = $1`,
    [userId],
  )
  if (!row) throw new Error('no_app')
  const tat = await fetchTAT(row.app_id, row.app_secret, row.brand)
  const base = BRAND_BASE[row.brand] ?? BRAND_BASE.feishu
  const r = await fetch(`${base}/open-apis/drive/v1/files/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search_key: '', count: 50, types: ['bitable'] }),
  })
  const d = await r.json() as { code: number; data?: { files?: unknown[] } }
  if (d.code !== 0) throw new Error(`drive/search bitable error ${d.code}`)
  return d.data?.files ?? []
}

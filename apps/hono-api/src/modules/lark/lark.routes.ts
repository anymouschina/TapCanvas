import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { authMiddleware } from '../../middleware/auth'
import { SaveLarkAppSchema, TicketBridgeDebugPayloadSchema } from './lark.schemas'
import { getLarkApp, saveLarkApp, listLarkWiki, listLarkBases, connectLarkWiki } from './lark.service'
import { handleFeishuTicketReply, handleWecomTicketWebhook, verifyFeishuCallback, verifyWecomTicketHandshake } from './ticket-bridge.service'

export const larkRouter = new Hono<AppEnv>()
larkRouter.use('*', authMiddleware)

larkRouter.get('/app', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const app = await getLarkApp(c, userId)
  return c.json({ app })
})

larkRouter.put('/app', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({}))
  const parsed = SaveLarkAppSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  const app = await saveLarkApp(c, userId, parsed.data)
  return c.json({ app })
})

larkRouter.post('/wiki/connect', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({}))
  const url = String(body?.url ?? '').trim()
  if (!url) return c.json({ error: 'url is required' }, 400)
  try {
    const result = await connectLarkWiki(c, userId, url)
    return c.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'no_app') return c.json({ error: 'no_app' }, 404)
    if (msg === 'invalid_url') return c.json({ error: '无效的知识库链接' }, 400)
    return c.json({ error: msg }, 502)
  }
})

larkRouter.get('/wiki', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const items = await listLarkWiki(c, userId)
    return c.json({ items })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'no_app') return c.json({ error: 'no_app' }, 404)
    return c.json({ error: msg }, 502)
  }
})

larkRouter.get('/bases', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const items = await listLarkBases(c, userId)
    return c.json({ items })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'no_app') return c.json({ error: 'no_app' }, 404)
    return c.json({ error: msg }, 502)
  }
})

const ticketRouter = new Hono<AppEnv>()

ticketRouter.get('/wecom', async (c) => {
  return verifyWecomTicketHandshake(c)
})

ticketRouter.post('/wecom', async (c) => {
  const projectId = String(c.req.query('projectId') ?? '').trim() || null
  return handleWecomTicketWebhook(c, projectId)
})

ticketRouter.post('/feishu', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const challengeResponse = await verifyFeishuCallback(body)
  if (challengeResponse) return challengeResponse
  const projectId = String(c.req.query('projectId') ?? '').trim() || null
  return handleFeishuTicketReply(c, projectId)
})

larkRouter.route('/ticket', ticketRouter)

larkRouter.post('/ticket/debug/forward', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = TicketBridgeDebugPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const { projectId, externalUserId, senderName, content, imageUrl } = parsed.data
  const debugBody = {
    ToUserName: 'tapcanvas',
    FromUserName: externalUserId,
    CreateTime: Math.floor(Date.now() / 1000),
    MsgType: imageUrl ? 'image' : 'text',
    Content: content ?? '',
    MsgId: `debug_${Date.now()}`,
    PicUrl: imageUrl ?? '',
  }
  return c.json({ ok: true, projectId, payload: debugBody, note: 'use real /lark/ticket/wecom webhook to exercise encryption/signature path' })
})

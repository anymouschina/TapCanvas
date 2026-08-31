/**
 * 可靠地拉取视频/音频片段字节流(供 WebAV 合成使用)。
 *
 * 第一方对象存储片段优先走服务端 S3 数据面；第三方片段由服务端返回 400 后
 * 使用原始地址。网络瞬态错误按有限次数重试，并拒绝伪装成媒体的 HTML 响应。
 */

const viteEnv = ((import.meta as any).env || {}) as Record<string, any>
// 与 api/server.ts 的 API_BASE 解析保持一致,但不 import 那个重模块。
const API_BASE: string =
  typeof viteEnv.VITE_API_BASE === 'string' && viteEnv.VITE_API_BASE.trim()
    ? viteEnv.VITE_API_BASE.trim()
    : viteEnv.DEV
      ? 'http://localhost:8788'
      : ''

// 这些状态码视为瞬态(限流/网关/源站抖动),可重试。
const TRANSIENT_STATUS = new Set([404, 408, 425, 429, 500, 502, 503, 504])

export type FetchClipOptions = {
  signal?: AbortSignal
  /** 每个候选地址的尝试次数(含首次),默认 3 */
  attempts?: number
  /** 退避基准毫秒,默认 400(400 / 800 / 1600…) */
  baseDelayMs?: number
  /** 可注入的 sleep(测试用) */
  sleep?: (ms: number) => Promise<void>
}

/**
 * 把任意 http(s) 片段地址包装成服务端 S3 直读代理地址。
 * 非 http(s)(blob:/data: 等本地地址)返回 null —— 直接 fetch 原地址即可。
 */
export function objectStorageStreamUrl(clipUrl: string): string | null {
  if (!/^https?:\/\//i.test(clipUrl)) return null
  return `${API_BASE}/assets/storage-stream?url=${encodeURIComponent(clipUrl)}`
}

function isHtmlResponse(res: Response): boolean {
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  return ct.includes('text/html') || ct.includes('application/xhtml')
}

type FetchError = Error & { status?: number; transient?: boolean }

async function attemptOnce(url: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, signal ? { signal } : undefined)
  if (!res.ok) {
    const e: FetchError = new Error(`HTTP ${res.status} for ${url}`)
    e.status = res.status
    e.transient = TRANSIENT_STATUS.has(res.status)
    throw e
  }
  // 200 但返回 HTML = CDN 限流页伪装成功,丢弃并当瞬态失败重试。
  if (isHtmlResponse(res)) {
    const e: FetchError = new Error(`expected video bytes but got HTML for ${url}`)
    e.transient = true
    throw e
  }
  return res
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 拉取一个片段,返回可用的 Response(res.body 给 MP4Clip / AudioClip 用)。
 * 失败时抛出最后一次错误。
 */
export async function fetchClip(clipUrl: string, options?: FetchClipOptions): Promise<Response> {
  const signal = options?.signal
  const attempts = Math.max(1, options?.attempts ?? 3)
  const baseDelayMs = options?.baseDelayMs ?? 400
  const sleep = options?.sleep ?? defaultSleep

  const proxied = objectStorageStreamUrl(clipUrl)
  // 候选顺序:S3 直读代理 → 原始直链
  const candidates: { url: string; isProxy: boolean }[] = proxied
    ? [{ url: proxied, isProxy: true }, { url: clipUrl, isProxy: false }]
    : [{ url: clipUrl, isProxy: false }]

  let lastErr: unknown = new Error(`failed to fetch clip: ${clipUrl}`)

  for (const candidate of candidates) {
    for (let a = 0; a < attempts; a++) {
      if (signal?.aborted) throw new Error('合成已取消')
      try {
        return await attemptOnce(candidate.url, signal)
      } catch (err) {
        lastErr = err
        const fe = err as FetchError
        // 代理回 400 = 此 URL 非当前对象存储资产，改用原始第三方地址。
        if (candidate.isProxy && fe?.status === 400) break
        // 永久错误(如 403 过期签名)→ 不在本候选上继续重试,换下个候选。
        if (fe?.status != null && !TRANSIENT_STATUS.has(fe.status)) break
        if (a < attempts - 1) await sleep(baseDelayMs * 2 ** a)
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`failed to fetch clip: ${clipUrl}`)
}

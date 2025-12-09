import { Injectable, Logger } from '@nestjs/common'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import axios from 'axios'
import { randomUUID } from 'crypto'

interface UploadResult {
  key: string
  url: string
}

@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name)
  private readonly bucket = (process.env.R2_BUCKET || 'tapcanvas').trim()
  private readonly accountId = (process.env.R2_ACCOUNT_ID || '').trim()
  private readonly accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim()
  private readonly secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim()
  private readonly publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  private readonly endpoint = (
    process.env.R2_ENDPOINT ||
    (this.accountId ? `https://${this.accountId}.r2.cloudflarestorage.com` : '')
  )
    .trim()
    .replace(/\/+$/, '')
  private readonly proxyVideosBase = (process.env.R2_PROXY_VIDEOS_BASE || '').trim().replace(/\/+$/, '')
  private readonly proxySoraBase = (process.env.R2_PROXY_SORA_BASE || '').trim().replace(/\/+$/, '')
  private readonly proxyGoogleBase = (process.env.R2_PROXY_GOOGLE_BASE || '').trim().replace(/\/+$/, '')
  private readonly proxyOpenaiAuthBase = (process.env.R2_PROXY_OPENAI_AUTH_BASE || '').trim().replace(/\/+$/, '')

  private client: S3Client | null = null
  private warnedMissingConfig = false

  private ensureClient(): S3Client | null {
    if (this.client) return this.client
    if (!this.accessKeyId || !this.secretAccessKey || !this.endpoint) {
      if (!this.warnedMissingConfig) {
        this.logger.warn('R2 未配置（缺少 AccessKey/Secret/Endpoint），跳过上传')
        this.warnedMissingConfig = true
      }
      return null
    }
    this.client = new S3Client({
      region: 'auto',
      endpoint: this.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
    })
    return this.client
  }

  private detectExtension(url: string, contentType: string): string {
    const known: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
    }
    if (contentType && known[contentType]) return known[contentType]
    try {
      const parsed = new URL(url)
      const parts = parsed.pathname.split('.')
      if (parts.length > 1) {
        const ext = parts.pop() || ''
        if (ext && /^[a-z0-9]+$/i.test(ext)) return ext.toLowerCase()
      }
    } catch {
      // ignore url parse failures
    }
    return 'bin'
  }

  private buildKey(userId: string, ext: string, prefix?: string): string {
    const safeUser = (userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '_')
    const date = new Date()
    const datePrefix = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
    const random = randomUUID()
    const dir = prefix ? prefix.replace(/^\/+|\/+$/g, '') : 'gen'
    return `${dir}/${safeUser}/${datePrefix}/${random}.${ext || 'bin'}`
  }

  private buildPublicUrl(key: string): string {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${key}`
    }
    const base = this.endpoint || ''
    return `${base}/${this.bucket}/${key}`
  }

  private isHosted(url: string): boolean {
    if (!url) return false
    try {
      const targetHost = new URL(url).host
      const hosts = new Set<string>()
      if (this.publicBaseUrl) {
        hosts.add(new URL(this.publicBaseUrl).host)
      }
      if (this.endpoint) {
        hosts.add(new URL(this.endpoint).host)
      }
      return hosts.size > 0 && hosts.has(targetHost)
    } catch {
      return false
    }
  }

  private rewriteSourceUrl(url: string): string {
    try {
      const parsed = new URL(url)
      const host = parsed.host.toLowerCase()
      const rewrites: Array<{ match: string; proxy: string }> = [
        { match: 'videos.openai.com', proxy: this.proxyVideosBase },
        { match: 'sora.chatgpt.com', proxy: this.proxySoraBase },
        { match: 'generativelanguage.googleapis.com', proxy: this.proxyGoogleBase },
        { match: 'auth.openai.com', proxy: this.proxyOpenaiAuthBase },
      ].filter((r) => r.proxy)
      const matched = rewrites.find((r) => host === r.match || host.endsWith(`.${r.match}`))
      if (!matched) return url
      const proxyBase = new URL(matched.proxy)
      proxyBase.pathname = parsed.pathname
      proxyBase.search = parsed.search
      proxyBase.hash = parsed.hash
      const rewritten = proxyBase.toString()
      this.logger.log('使用代理拉取资源用于 R2 上传', {
        fromHost: host,
        proxyHost: proxyBase.host,
      })
      return rewritten
    } catch {
      return url
    }
  }

  async uploadFromUrl(params: { userId: string; sourceUrl: string; prefix?: string }): Promise<UploadResult | null> {
    const client = this.ensureClient()
    if (!client) return null

    const sourceUrl = (params.sourceUrl || '').trim()
    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
      return null
    }
    if (this.isHosted(sourceUrl)) {
      return { key: '', url: sourceUrl }
    }
    const fetchUrl = this.rewriteSourceUrl(sourceUrl)

    try {
      const res = await axios.get<ArrayBuffer>(fetchUrl, {
        responseType: 'arraybuffer',
        timeout: 90_000,
        maxContentLength: 150 * 1024 * 1024,
      })
      const contentType = (res.headers['content-type'] || 'application/octet-stream').split(';')[0].trim()
      const ext = this.detectExtension(sourceUrl, contentType)
      const key = this.buildKey(params.userId, ext, params.prefix)
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: Buffer.from(res.data),
          ContentType: contentType || undefined,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      )
      const url = this.buildPublicUrl(key)
      return { key, url }
    } catch (err: any) {
      this.logger.warn('上传到 R2 失败，使用原始地址', {
        message: err?.message,
        source: sourceUrl,
      })
      return null
    }
  }
}

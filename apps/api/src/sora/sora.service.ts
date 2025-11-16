import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import axios from 'axios'
import FormData from 'form-data'

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY

@Injectable()
export class SoraService {
  private readonly logger = new Logger(SoraService.name)
  constructor(private readonly prisma: PrismaService) {}

  async getDrafts(userId: string, tokenId?: string, cursor?: string, limit?: number) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    // 优先使用用户配置 / 共享的自定义 sora 域名；若未配置，再退回官方域名
    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL('/backend/project_y/profile/drafts', baseUrl).toString()

    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const params: Record<string, any> = {}
      if (cursor) params.cursor = cursor
      if (typeof limit === 'number' && !Number.isNaN(limit)) params.limit = limit

      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        params,
      })
      const data = res.data as any
      const rawItems: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
      const items = rawItems.map((item) => {
        const enc = item.encodings || {}
        const thumbnail =
          enc.thumbnail?.path ||
          item.preview_image_url ||
          item.thumbnail_url ||
          null
        const videoUrl =
          item.downloadable_url ||
          item.url ||
          enc.source?.path ||
          null
        return {
          id: item.id,
          kind: item.kind ?? 'sora_draft',
          title: item.title ?? null,
          prompt: item.prompt ?? item.creation_config?.prompt ?? null,
          width: item.width ?? null,
          height: item.height ?? null,
          generationType: item.generation_type ?? null,
          createdAt: item.created_at ?? null,
          thumbnailUrl: thumbnail,
          videoUrl,
          platform: 'sora' as const,
          raw: item,
        }
      })

      // persist/update a lightweight snapshot for later use
      await Promise.all(
        items.map((item) =>
          this.prisma.externalDraft.upsert({
            where: {
              userId_provider_remoteId: {
                userId,
                provider: 'sora',
                remoteId: item.id,
              },
            },
            update: {
              title: item.title,
              prompt: item.prompt,
              thumbnailUrl: item.thumbnailUrl,
              videoUrl: item.videoUrl,
              raw: item.raw as any,
              lastSeenAt: new Date(),
            },
            create: {
              userId,
              provider: 'sora',
              remoteId: item.id,
              title: item.title,
              prompt: item.prompt,
              thumbnailUrl: item.thumbnailUrl,
              videoUrl: item.videoUrl,
              raw: item.raw as any,
            },
          }),
        ),
      )

      // fill embeddings for new prompts using SiliconFlow + pgvector
      if (SILICONFLOW_API_KEY) {
        const ids = items.map((it) => it.id)
        if (ids.length) {
          const drafts = await this.prisma.externalDraft.findMany({
            where: {
              userId,
              provider: 'sora',
              remoteId: { in: ids },
            },
          })
          const needing = drafts.filter((d) => !(d as any).embedding && (d.prompt || '').trim().length > 0)
          if (needing.length) {
            try {
              const inputs = needing.map((d) => (d.prompt || '').trim())
              const embRes = await axios.post(
                'https://api.siliconflow.cn/v1/embeddings',
                {
                  model: 'BAAI/bge-m3',
                  input: inputs,
                },
                {
                  headers: {
                    Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  timeout: 10000,
                },
              )
              const vectors: number[][] = (embRes.data?.data || []).map(
                (d: any) => d.embedding as number[],
              )
              // update each embedding via raw SQL
              await Promise.all(
                needing.map((draft, idx) => {
                  const vec = vectors[idx]
                  if (!Array.isArray(vec) || !vec.length) return Promise.resolve()
                  const literal = '[' + vec.join(',') + ']'
                  return this.prisma.$executeRawUnsafe(
                    `UPDATE "ExternalDraft" SET "embedding" = '${literal}'::vector WHERE "id" = '${draft.id}'`,
                  )
                }),
              )
            } catch {
              // ignore embedding errors; suggestions will fall back as needed
            }
          }
        }
      }

      return {
        items: items.map(({ raw, ...rest }) => rest),
        cursor: data?.cursor ?? null,
      }
    } catch (err: any) {
      // If this is a shared configuration, register the failure and soft-disable if needed.
      if (token.shared) {
        await this.registerSharedFailure(token.id)
        throw new HttpException(
          { message: '当前配置不可用，请稍后再试', upstreamStatus: err?.response?.status ?? null },
          HttpStatus.SERVICE_UNAVAILABLE,
        )
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        'Sora drafts request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async getCharacters(userId: string, tokenId?: string, cursor?: string, limit?: number) {
    const token: any = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      // 优先从 Sora Token (JWT) 中解析 profile user id
      let profileId: string | undefined
      const rawToken = token.secretToken as string | undefined
      if (rawToken) {
        const parts = rawToken.split('.')
        if (parts.length >= 2) {
          try {
            const pad = (s: string) => s.padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')
            const payloadJson = Buffer.from(
              pad(parts[1]).replace(/-/g, '+').replace(/_/g, '/'),
              'base64',
            ).toString('utf8')
            const payload = JSON.parse(payloadJson)
            const auth = payload['https://api.openai.com/auth'] || {}
            const uid = auth.user_id || payload.user_id || undefined
            if (typeof uid === 'string' && uid.startsWith('user-')) {
              profileId = uid
            }
          } catch {
            // ignore decode errors, fall back to session call
          }
        }
      }

      // 若无法从 Token 中解析，则退回调用 /api/auth/session
      if (!profileId) {
        const sessionUrl = new URL('/api/auth/session', baseUrl).toString()
        const sessionRes = await axios.get(sessionUrl, {
          headers: {
            Authorization: `Bearer ${token.secretToken}`,
            'User-Agent': userAgent,
            Accept: 'application/json',
          },
          validateStatus: () => true,
        })

        if (sessionRes.status < 200 || sessionRes.status >= 300) {
          const msg =
            (sessionRes.data && (sessionRes.data.message || sessionRes.data.error)) ||
            `Sora session request failed with status ${sessionRes.status}`
          throw new Error(msg)
        }
        const sess = sessionRes.data as any
        profileId =
          sess?.user?.user_id ||
          sess?.user?.id ||
          sess?.user_id ||
          undefined
      }

      if (!profileId) {
        throw new Error('Sora session missing profile user id')
      }

      // 角色列表接口：需要带上 profile user 标识
      const url = new URL(`/backend/project_y/profile/${profileId}/characters`, baseUrl).toString()

      const params: Record<string, any> = {}
      if (cursor) params.cursor = cursor
      if (typeof limit === 'number' && !Number.isNaN(limit)) params.limit = limit

      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        params,
      })

      const data = res.data as any
      const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []

      return {
        items,
        cursor: data?.cursor ?? null,
      }
    } catch (err: any) {
      if (token.shared) {
        await this.registerSharedFailure(token.id)
        throw new HttpException(
          { message: '当前配置不可用，请稍后再试', upstreamStatus: err?.response?.status ?? null },
          HttpStatus.SERVICE_UNAVAILABLE,
        )
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        'Sora characters request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async deleteDraft(userId: string, tokenId: string, draftId: string) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL(`/backend/project_y/profile/drafts/${draftId}`, baseUrl).toString()

    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const res = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: '*/*',
        },
      })
      return { ok: true, status: res.status }
    } catch (err: any) {
      if (token.shared) {
        await this.registerSharedFailure(token.id)
        throw new HttpException(
          { message: '当前配置不可用，请稍后再试', upstreamStatus: err?.response?.status ?? null },
          HttpStatus.SERVICE_UNAVAILABLE,
        )
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        'Sora delete draft request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async deleteCharacter(userId: string, tokenId: string, characterId: string) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL(`/backend/project_y/characters/${characterId}`, baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const res = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: '*/*',
        },
      })
      return { ok: true, status: res.status }
    } catch (err: any) {
      if (token.shared) {
        await this.registerSharedFailure(token.id)
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        'Sora delete character request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async uploadCharacterVideo(
    userId: string,
    tokenId: string | undefined,
    file: any,
    range: [number, number],
  ) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL('/backend/characters/upload', baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'
    const [start, end] = range

    const form = new FormData()
    form.append('file', file.buffer, {
      filename: file.originalname || 'character.mp4',
      contentType: file.mimetype || 'video/mp4',
    })
    form.append('timestamps', `${start},${end}`)

    try {
      const res = await axios.post(url, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        maxBodyLength: Infinity,
      })
      return res.data
    } catch (err: any) {
      if (token.shared) {
        await this.registerSharedFailure(token.id)
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora upload character video request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  /**
   * 使用 Sora-2 nf/create 创建视频任务（纯文生视频，后续可扩展图生视频）
   */
  async createVideoTask(
    userId: string,
    tokenId: string | undefined,
    payload: {
      prompt: string
      orientation?: 'portrait' | 'landscape' | 'square'
      size?: string
      n_frames?: number
      inpaintFileId?: string | null
      imageUrl?: string | null
      remixTargetId?: string | null
    },
  ) {
    const token: any = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    // 若指定了 remix 目标，则优先走 remix 模式（不再尝试图生）
    let inpaintFileId = payload.inpaintFileId ?? null
    const remixTargetId = payload.remixTargetId || null

    // 若无 remix，且未显式提供 file_id，但有图片 URL，则尝试先上传图片到 Sora 获取 file_id
    if (!remixTargetId && !inpaintFileId && payload.imageUrl) {
      try {
        const imgRes = await axios.get(payload.imageUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
        })
        const contentType =
          (imgRes.headers && (imgRes.headers['content-type'] as string | undefined)) ||
          'image/png'

        const form = new FormData()
        form.append('file', imgRes.data, {
          filename: 'image',
          contentType,
        })
        form.append('use_case', 'profile')

        const uploadUrl = new URL('/backend/project_y/file/upload', baseUrl).toString()
        const uploadRes = await axios.post(uploadUrl, form, {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${token.secretToken}`,
            'User-Agent': userAgent,
            Accept: 'application/json',
          },
          maxBodyLength: Infinity,
          validateStatus: () => true,
        })

        if (uploadRes.status >= 200 && uploadRes.status < 300) {
          const up = uploadRes.data as any
          inpaintFileId = (up && (up.file_id as string | undefined)) || null
        }
      } catch {
        // 上传失败时忽略，退回纯文本生视频
        inpaintFileId = null
      }
    }

    // 三种模式互斥：
    // - 图生视频：仅图片，不带角色、不带 remix
    // - 角色引用：仅文本+角色，不带图片、不带 remix
    // - Remix：仅视频衍生视频，不带图片、不带角色

    const hasImage = !!inpaintFileId
    const hasRemix = !!remixTargetId
    const hasRole = /@\S+/.test(payload.prompt || '')

    // 同时存在 remix + 图生：不允许
    if (hasImage && hasRemix) {
      throw new HttpException(
        {
          message: 'Remix 模式与图生视频不能同时使用，请仅保留其中一种（移除图片或 Remix 目标）。',
          upstreamStatus: 400,
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Remix 模式下不允许角色 / 图片
    if (hasRemix && (hasImage || hasRole)) {
      throw new HttpException(
        {
          message: '视频 Remix 模式暂不支持图片或角色引用，请移除图片和 @角色，仅基于原视频进行提示词修改。',
          upstreamStatus: 400,
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // 图生视频模式下（有有效 inpaintFileId）不允许携带角色引用（@xxx）
    if (hasImage && !hasRemix && hasRole) {
      throw new HttpException(
        {
          message: '图生视频模式暂不支持角色引用，请移除 @角色 或改用纯文生视频',
          upstreamStatus: 400,
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const url = new URL('/backend/nf/create', baseUrl).toString()

    const body: any = {
      kind: 'video',
      prompt: payload.prompt,
      title: null,
      orientation: payload.orientation || 'portrait',
      size: payload.size || 'small',
      n_frames: typeof payload.n_frames === 'number' ? payload.n_frames : 300,
      inpaint_items: inpaintFileId
        ? [{ kind: 'file', file_id: inpaintFileId }]
        : [],
      remix_target_id: remixTargetId,
      metadata: null,
      cameo_ids: null,
      cameo_replacements: null,
      model: 'sy_8',
      style_id: null,
      audio_caption: null,
      audio_transcript: null,
      video_caption: null,
      storyboard_id: null,
    }

    try {
      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: '*/*',
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      })

      if (res.status < 200 || res.status >= 300) {
        const upstreamError =
          res.data?.error ||
          (typeof res.data?.message === 'object' ? res.data.message : null)
        const msg =
          (upstreamError && upstreamError.message) ||
          res.data?.message ||
          res.data?.error ||
          `Sora video create failed with status ${res.status}`

        // 共享 Token 失败计数
        if (token.shared) {
          await this.registerSharedFailure(token.id)
        }

        throw new HttpException(
          {
            message: msg,
            upstreamStatus: res.status,
            upstreamData: res.data ?? null,
          },
          res.status,
        )
      }

      return res.data
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw err
      }

      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora video create request failed'

      throw new HttpException(
        {
          message,
          upstreamStatus: err?.response?.status ?? null,
          upstreamData: err?.response?.data ?? null,
        },
        status,
      )
    }
  }

  async uploadProfileAsset(
    userId: string,
    tokenId: string | undefined,
    file: any,
  ) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(
      token,
      'sora',
      'https://sora.chatgpt.com',
    )
    const url = new URL('/backend/project_y/file/upload', baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    const form = new FormData()
    form.append('file', file.buffer, {
      filename: file.originalname || 'cover.png',
      contentType: file.mimetype || 'image/png',
    })
    form.append('use_case', 'profile')

    try {
      const res = await axios.post(url, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        maxBodyLength: Infinity,
      })
      return res.data
    } catch (err: any) {
      if (token.shared) {
        await this.registerSharedFailure(token.id)
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora upload profile asset request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async getCameoStatus(userId: string, tokenId: string | undefined, cameoId: string) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL(`/backend/project_y/cameos/in_progress/${cameoId}`, baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        validateStatus: () => true,
      })
      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.data && (res.data.message || res.data.error)) ||
          `Sora cameo status failed with status ${res.status}`
        throw new HttpException(
          { message: msg, upstreamStatus: res.status },
          res.status,
        )
      }
      return res.data
    } catch (err: any) {
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora cameo status request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async finalizeCharacter(
    userId: string,
    tokenId: string,
    payload: {
      cameo_id: string
      username: string
      display_name: string
      profile_asset_pointer: any
    },
  ) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL('/backend/characters/finalize', baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    const body = {
      cameo_id: payload.cameo_id,
      username: payload.username,
      display_name: payload.display_name,
      profile_asset_pointer: payload.profile_asset_pointer,
      instruction_set: null,
      safety_instruction_set: null,
    }

    try {
      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      })
      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.data && (res.data.message || res.data.error)) ||
          `Sora finalize character failed with status ${res.status}`
        // 打印上游返回，方便调试
        // eslint-disable-next-line no-console
        console.error('Sora finalizeCharacter upstream error:', {
          url,
          status: res.status,
          data: res.data,
          body,
        })
        throw new HttpException(
          { message: msg, upstreamStatus: res.status, upstreamData: res.data ?? null },
          res.status,
        )
      }
      return res.data
    } catch (err: any) {
      // 如果上面已经抛出了 HttpException，直接透传
      if (err instanceof HttpException) {
        // eslint-disable-next-line no-console
        console.error('Sora finalizeCharacter HttpException:', err.getResponse())
        throw err
      }

      // 其它未知错误，打印完整上下文
      // eslint-disable-next-line no-console
      console.error('Sora finalizeCharacter unexpected error:', {
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
        url: err?.config?.url,
        headers: err?.config?.headers,
      })

      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora finalize character request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null, upstreamData: err?.response?.data ?? null },
        status,
      )
    }
  }

  async setCameoPublic(userId: string, tokenId: string, cameoId: string) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL(
      `/backend/project_y/cameos/by_id/${cameoId}/update_v2`,
      baseUrl,
    ).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const res = await axios.post(
        url,
        { visibility: 'public' },
        {
          headers: {
            Authorization: `Bearer ${token.secretToken}`,
            'User-Agent': userAgent,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          validateStatus: () => true,
        },
      )
      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.data && (res.data.message || res.data.error)) ||
          `Sora set cameo public failed with status ${res.status}`
        throw new HttpException(
          { message: msg, upstreamStatus: res.status },
          res.status,
        )
      }
      return res.data
    } catch (err: any) {
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora set cameo public request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async checkCharacterUsername(userId: string, tokenId: string | undefined, username: string) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL('/backend/project_y/profile/username/check', baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const res = await axios.post(
        url,
        { username },
        {
          headers: {
            Authorization: `Bearer ${token.secretToken}`,
            'User-Agent': userAgent,
            Accept: '*/*',
            'Content-Type': 'application/json',
          },
          validateStatus: () => true,
        },
      )
      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.data && (res.data.message || res.data.error)) ||
          `Sora username check failed with status ${res.status}`
        throw new HttpException(
          { message: msg, upstreamStatus: res.status },
          res.status,
        )
      }
      return res.data
    } catch (err: any) {
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora username check request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async searchMentions(
    userId: string,
    tokenId: string | undefined,
    username: string,
    intent: string = 'cameo',
    limit: number = 10,
  ) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL('/backend/project_y/profile/search_mentions', baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: '*/*',
        },
        params: {
          username,
          intent,
          limit,
        },
        validateStatus: () => true,
      })

      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.data && (res.data.message || res.data.error)) ||
          `Sora search mentions failed with status ${res.status}`
        throw new HttpException(
          { message: msg, upstreamStatus: res.status, upstreamData: res.data ?? null },
          res.status,
        )
      }

      return res.data
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw err
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora search mentions request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null, upstreamData: err?.response?.data ?? null },
        status,
      )
    }
  }

  /**
   * 查询当前账号下 Sora 视频生成的排队 / 运行中任务列表（nf/pending）
   */
  async getPendingVideos(userId: string, tokenId?: string) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL('/backend/nf/pending', baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: '*/*',
        },
        validateStatus: () => true,
      })

      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.data && (res.data.message || res.data.error)) ||
          `Sora pending videos request failed with status ${res.status}`
        throw new HttpException(
          { message: msg, upstreamStatus: res.status, upstreamData: res.data ?? null },
          res.status,
        )
      }

      return res.data
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw err
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora pending videos request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null, upstreamData: err?.response?.data ?? null },
        status,
      )
    }
  }

  async updateCharacter(
    userId: string,
    tokenId: string,
    characterId: string,
    payload: { username?: string; display_name?: string | null; profile_asset_pointer?: any },
  ) {
    try {
      const token = await this.resolveSoraToken(userId, tokenId)
      if (!token || token.provider.vendor !== 'sora') {
        throw new Error('token not found or not a Sora token')
      }

      const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
      const url = new URL(`/backend/project_y/characters/${characterId}/update`, baseUrl).toString()
      const userAgent = token.userAgent || 'TapCanvas/1.0'
      const res = await axios.post(
        url,
        {
          username: payload.username,
          display_name:  null,
          profile_asset_pointer: null,
        },
        {
          headers: {
            Authorization: `Bearer ${token.secretToken}`,
            'User-Agent': userAgent,
          },
          validateStatus: () => true,
        },
      )
      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.data && (res.data.message || res.data.error)) ||
          `Sora update character failed with status ${res.status}`
        throw new HttpException(
          { message: msg, upstreamStatus: res.status },
          res.status,
        )
      }
      return res.data
    } catch (err: any) {
      // 调试信息：打印完整错误上下文，便于比对 access_token / UA 等
      // 注意：生产环境应考虑脱敏，这里优先满足本地调试需求。
      // eslint-disable-next-line no-console
      console.error('Sora updateCharacter error:', {
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
        url: err?.config?.url,
        headers: err?.config?.headers,
      })

      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        err?.message ||
        'Sora update character request failed'
      throw new HttpException(
        {
          message,
          upstreamStatus: err?.response?.status ?? null,
          upstreamData: err?.response?.data ?? null,
        },
        status,
      )
    }
  }

  private async resolveSoraToken(userId: string, tokenId?: string) {
    const includeConfig = {
      provider: {
        include: { endpoints: true },
      },
    } as const

    // If tokenId is provided, prefer the caller's own token, but allow falling back to a shared token with the same id.
    if (tokenId) {
      let token = await this.prisma.modelToken.findFirst({
        where: { id: tokenId, userId },
        include: includeConfig,
      })
      if (!token) {
        token = await this.prisma.modelToken.findFirst({
          where: { id: tokenId, shared: true },
          include: includeConfig,
        })
      }
      return token
    }

    // No tokenId: try a user-owned Sora token first.
    const owned = await this.prisma.modelToken.findFirst({
      where: { userId, enabled: true, provider: { vendor: 'sora' } },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })
    if (owned) return owned

    // Then fall back to a shared Sora token, if any.
    const now = new Date()
    let shared = await this.prisma.modelToken.findFirst({
      where: {
        shared: true,
        enabled: true,
        provider: { vendor: 'sora' },
        OR: [
          { sharedDisabledUntil: null },
          { sharedDisabledUntil: { lt: now } },
        ],
      },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })
    if (!shared) return null

    // If it was disabled until some time in the past, reset its counters for a new day.
    if (shared.sharedDisabledUntil && shared.sharedDisabledUntil < now) {
      shared = await this.prisma.modelToken.update({
        where: { id: shared.id },
        data: { sharedDisabledUntil: null, sharedFailureCount: 0 },
        include: includeConfig,
      })
    }
    return shared
  }

  private async resolveBaseUrl(
    token: {
      provider: {
        id: string
        vendor: string
        endpoints: { key: string; baseUrl: string | null | undefined }[]
      }
    },
    key: string,
    fallback: string,
  ): Promise<string> {
    // 1. 优先使用当前 provider 上配置的域名
    const own = token.provider.endpoints.find((e) => e.key === key && e.baseUrl)
    if (own?.baseUrl) return own.baseUrl

    // 2. 退回到任意共享的同 key 域名（通常由管理员配置）
    const shared = await this.prisma.modelEndpoint.findFirst({
      where: {
        key,
        shared: true,
        provider: { vendor: 'sora' },
      },
      orderBy: { createdAt: 'asc' },
    })
    if (shared?.baseUrl) return shared.baseUrl

    // 3. 最后使用内置默认
    return fallback
  }

  private async registerSharedFailure(tokenId: string) {
    const existing = await this.prisma.modelToken.findUnique({ where: { id: tokenId } })
    if (!existing || !existing.shared) return

    const now = new Date()
    const last = existing.sharedLastFailureAt
    const isSameDay =
      last &&
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate()

    let failureCount = existing.sharedFailureCount || 0
    if (isSameDay) {
      failureCount += 1
    } else {
      failureCount = 1
    }

    let disabledUntil = existing.sharedDisabledUntil || null
    if (failureCount >= 3) {
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)
      disabledUntil = endOfDay
    }

    await this.prisma.modelToken.update({
      where: { id: tokenId },
      data: {
        sharedFailureCount: failureCount,
        sharedLastFailureAt: now,
        sharedDisabledUntil: disabledUntil,
      },
    })
  }
}

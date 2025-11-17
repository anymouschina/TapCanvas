import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import axios from 'axios'
import FormData from 'form-data'
import { TokenRouterService } from './token-router.service'
import { VideoHistoryService } from '../video/video-history.service'

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY

// Sora 发布相关的常量
const SORA_POST_MAX_LENGTH = 2000

@Injectable()
export class SoraService {
  private readonly logger = new Logger(SoraService.name)
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenRouter: TokenRouterService,
    private readonly videoHistory: VideoHistoryService,
  ) {}

  /**
   * 智能截断文本到指定长度，尽量在句子或段落结尾截断
   */
  private truncateTextForPost(text: string, maxLength: number = SORA_POST_MAX_LENGTH): string {
    if (text.length <= maxLength) {
      return text
    }

    // 直接截断，因为中文字符截断在任何位置都是可以接受的
    const truncated = text.substring(0, maxLength)

    this.logger.log('Text truncated for Sora post', {
      originalLength: text.length,
      truncatedLength: truncated.length,
      maxLength,
    })

    return truncated
  }

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
      // 获取视频代理域名配置
      const videoProxyBase = await this.resolveBaseUrl(token, 'videos', 'https://videos.openai.com')
      const rewrite = (raw: string | null | undefined) => this.rewriteVideoUrl(raw || null, videoProxyBase)

      const items = rawItems.map((item) => {
        const enc = item.encodings || {}
        const rawThumbnail =
          enc.thumbnail?.path ||
          item.preview_image_url ||
          item.thumbnail_url ||
          null
        const rawVideoUrl =
          item.downloadable_url ||
          item.url ||
          enc.source?.path ||
          null

        // 重写URL为自定义域名
        const thumbnailUrl = rewrite(rawThumbnail)
        const videoUrl = rewrite(rawVideoUrl)

        return {
          id: item.id,
          kind: item.kind ?? 'sora_draft',
          title: item.title ?? null,
          prompt: item.prompt ?? item.creation_config?.prompt ?? null,
          width: item.width ?? null,
          height: item.height ?? null,
          generationType: item.generation_type ?? null,
          createdAt: item.created_at ?? null,
          thumbnailUrl,
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

  private async publishVideoPostIfNeeded(token: any, baseUrl: string, matched: any, userId: string): Promise<string | null> {
    const generationId = matched.generation_id || matched.id
    if (!generationId) {
      this.logger.warn('publishVideoPost: No generation_id found', { matched })
      return null
    }

    let text = matched.prompt || matched.creation_config?.prompt || ''
    if (!text) {
      this.logger.warn('publishVideoPost: No prompt found for post text', { matched })
      return null
    }

    // 使用智能截断确保不超过2000字符限制
    const originalLength = text.length
    text = this.truncateTextForPost(text, SORA_POST_MAX_LENGTH)

    if (originalLength > SORA_POST_MAX_LENGTH) {
      this.logger.log('publishVideoPost: Prompt truncated for Sora post', {
        originalLength,
        truncatedLength: text.length,
        maxLength: SORA_POST_MAX_LENGTH,
      })
    }

    const url = new URL('/backend/project_y/post', baseUrl).toString()
    const body = {
      attachments_to_create: [{ generation_id: generationId, kind: 'sora' }],
      post_text: text,
    }

    this.logger.log('publishVideoPost: Attempting to publish video', {
      generationId,
      baseUrl,
      textLength: text.length,
    })

    try {
      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': token.userAgent || 'TapCanvas/1.0',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          // 添加必要的headers以模拟浏览器行为
          'origin': baseUrl,
          'referer': `${baseUrl}/`,
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
        validateStatus: () => true,
        timeout: 30000, // 30秒超时
      })

      if (res.status >= 200 && res.status < 300) {
        const postId =
          (typeof res.data?.id === 'string' && res.data.id) ||
          (typeof res.data?.post?.id === 'string' && res.data.post.id) ||
          (typeof res.data?.post_id === 'string' && res.data.post_id) ||
          null

        if (postId) {
          this.logger.log('publishVideoPost: Success', {
            generationId,
            postId,
            status: res.status,
            baseUrl,
          })

          // 记录发布成功的视频到历史记录
          await this.recordPublishedVideo(
            userId,
            generationId,
            postId,
            baseUrl,
            token.id
          )

          return postId
        } else {
          this.logger.warn('publishVideoPost: Success but no postId returned', {
            generationId,
            status: res.status,
            data: res.data,
          })
        }
      } else {
        this.logger.error('publishVideoPost: HTTP error', {
          generationId,
          status: res.status,
          statusText: res.statusText,
          data: res.data,
          baseUrl,
        })
      }
      return null
    } catch (err: any) {
      this.logger.error('publishVideoPost: Exception occurred', {
        generationId,
        message: err?.message,
        status: err?.response?.status,
        statusText: err?.response?.statusText,
        data: err?.response?.data,
        baseUrl,
        config: {
          url: err?.config?.url,
          method: err?.config?.method,
          headers: err?.config?.headers,
        },
      })
      return null
    }
  }

  /**
   * 手动发布视频到Sora平台
   */
  async publishVideo(
    userId: string,
    tokenId: string | undefined,
    taskId: string,
    postText?: string
  ): Promise<{ success: boolean; postId?: string; message?: string }> {
    try {
      // 获取Token
      const token: any = await this.resolveSoraToken(userId, tokenId)
      if (!token || token.provider.vendor !== 'sora') {
        throw new Error('token not found or not a Sora token')
      }

      // 获取草稿信息
      const draft = await this.getDraftByTaskId(userId, tokenId, taskId)
      if (!draft || !draft.id) {
        throw new Error('draft not found for the given taskId')
      }

      const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
      const generationId = (draft as any).generation_id || draft.id

      if (!generationId) {
        throw new Error('No generation_id found in draft')
      }

      let text = postText || (draft as any).prompt || (draft as any).creation_config?.prompt || ''
      if (!text) {
        throw new Error('No post text available')
      }

      // 使用智能截断确保不超过2000字符限制
      const originalLength = text.length
      text = this.truncateTextForPost(text, SORA_POST_MAX_LENGTH)

      if (originalLength > SORA_POST_MAX_LENGTH) {
        this.logger.log('publishVideo: Post text truncated for Sora post', {
          originalLength,
          truncatedLength: text.length,
          maxLength: SORA_POST_MAX_LENGTH,
          taskId,
        })
      }

      const url = new URL('/backend/project_y/post', baseUrl).toString()
      const body = {
        attachments_to_create: [{ generation_id: generationId, kind: 'sora' }],
        post_text: text,
      }

      this.logger.log('publishVideo: Manual publish attempt', {
        userId,
        taskId,
        generationId,
        baseUrl,
        textLength: text.length,
      })

      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': token.userAgent || 'TapCanvas/1.0',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'origin': baseUrl,
          'referer': `${baseUrl}/`,
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
        validateStatus: () => true,
        timeout: 30000,
      })

      if (res.status >= 200 && res.status < 300) {
        const postId =
          (typeof res.data?.id === 'string' && res.data.id) ||
          (typeof res.data?.post?.id === 'string' && res.data.post.id) ||
          (typeof res.data?.post_id === 'string' && res.data.post_id) ||
          null

        if (postId) {
          // 记录发布历史
          await this.recordPublishedVideo(userId, generationId, postId, baseUrl, token.id)

          this.logger.log('publishVideo: Manual publish success', {
            userId,
            taskId,
            generationId,
            postId,
            baseUrl,
          })

          return {
            success: true,
            postId,
            message: 'Video published successfully'
          }
        } else {
          return {
            success: false,
            message: 'Publish succeeded but no postId returned'
          }
        }
      } else {
        return {
          success: false,
          message: `Publish failed with status ${res.status}: ${res.statusText || 'Unknown error'}`
        }
      }
    } catch (error: any) {
      this.logger.error('publishVideo: Manual publish failed', {
        userId,
        taskId,
        error: error.message,
        status: error?.response?.status,
        data: error?.response?.data,
      })

      return {
        success: false,
        message: error?.response?.data?.message || error?.message || 'Publish failed'
      }
    }
  }

  /**
   * 记录已发布的视频到历史记录
   */
  private async recordPublishedVideo(
    userId: string,
    generationId: string,
    postId: string,
    baseUrl: string,
    tokenId: string
  ): Promise<void> {
    try {
      // 更新VideoGenerationHistory表，添加postId
      await this.prisma.videoGenerationHistory.updateMany({
        where: {
          userId,
          generationId,
        },
        data: {
          postId,
        },
      })

      this.logger.log('recordPublishedVideo: postId saved to database', {
        userId,
        generationId,
        postId,
        baseUrl,
        tokenId,
      })
    } catch (error) {
      this.logger.error('recordPublishedVideo failed to save postId', {
        userId,
        generationId,
        postId,
        error: error.message,
      })
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

      // 获取视频代理域名配置并重写URL
      const videoProxyBase = await this.resolveBaseUrl(token, 'videos', 'https://videos.openai.com')
      const rewrite = (raw: string | null | undefined) => this.rewriteVideoUrl(raw || null, videoProxyBase)

      // 为角色数据重写相关URL
      const processedItems = items.map((item) => {
        // 处理角色的头像/封面图片URL
        if (item.profile_picture_url) {
          item.profile_picture_url = rewrite(item.profile_picture_url)
        }

        // 处理角色相关的视频URL（如果有的话）
        if (item.profile_video_url) {
          item.profile_video_url = rewrite(item.profile_video_url)
        }

        // 处理角色封面视频
        if (item.cover_video_url) {
          item.cover_video_url = rewrite(item.cover_video_url)
        }

        // 处理角色相关媒体资源URL
        if (item.media_assets && Array.isArray(item.media_assets)) {
          item.media_assets = item.media_assets.map((asset: any) => {
            if (asset.url) {
              asset.url = rewrite(asset.url)
            }
            if (asset.thumbnail_url) {
              asset.thumbnail_url = rewrite(asset.thumbnail_url)
            }
            if (asset.preview_url) {
              asset.preview_url = rewrite(asset.preview_url)
            }
            return asset
          })
        }

        // 处理角色展示视频URL
        if (item.showcase_video_url) {
          item.showcase_video_url = rewrite(item.showcase_video_url)
        }

        // 处理角色相关图片资源
        if (item.images && Array.isArray(item.images)) {
          item.images = item.images.map((img: any) => {
            if (img.url) {
              img.url = rewrite(img.url)
            }
            if (img.thumbnail_url) {
              img.thumbnail_url = rewrite(img.thumbnail_url)
            }
            return img
          })
        }

        // 处理角色的视频资源（如果存在）
        if (item.videos && Array.isArray(item.videos)) {
          item.videos = item.videos.map((video: any) => {
            if (video.url) {
              video.url = rewrite(video.url)
            }
            if (video.thumbnail_url) {
              video.thumbnail_url = rewrite(video.thumbnail_url)
            }
            return video
          })
        }

        return item
      })

      return {
        items: processedItems,
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
    triedTokenIds: string[] = [],
  ): Promise<any> {
    let token: any

    // 如果指定了 remixTargetId，需要先解析原视频使用的Token
    if (payload.remixTargetId) {
      this.logger.log('Resolving token for remix target', {
        userId,
        remixTargetId: payload.remixTargetId,
      })

      // 从VideoGenerationHistory查找原视频的Token信息
      // 优先按 postId 查找（s_ 开头），然后按 generationId 查找（gen_ 开头），最后按 taskId 查找（task_ 开头）
      const originalVideo = await this.prisma.videoGenerationHistory.findFirst({
        where: {
          userId, // 确保用户只能remix自己的视频
          OR: [
            { postId: payload.remixTargetId }, // 传入的是 s_ 开头的postId - 优先级最高
            { generationId: payload.remixTargetId }, // 传入的是 gen_ 开头的ID
            { taskId: payload.remixTargetId }, // 传入的是 task_ 开头的ID
          ],
        },
        select: {
          tokenId: true,
          status: true,
          taskId: true, // 保留 taskId 用于后续处理
          generationId: true, // 保留 generationId 用于日志
          postId: true, // 保留 postId 用于日志和后续使用
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      this.logger.log('Video search result in VideoGenerationHistory', {
        userId,
        remixTargetId: payload.remixTargetId,
        foundOriginalVideo: !!originalVideo,
        hasTokenId: !!originalVideo?.tokenId,
        hasPostId: !!originalVideo?.postId,
        generationId: originalVideo?.generationId,
      })

      if (originalVideo && originalVideo.tokenId) {
        // 如果有postId，说明是最新的记录，优先使用
        if (originalVideo.postId) {
          this.logger.log('Found video with postId for remix', {
            userId,
            remixTargetId: payload.remixTargetId,
            foundPostId: originalVideo.postId,
            foundGenerationId: originalVideo.generationId,
          })
        } else {
          // 如果没有postId，立即从草稿中获取对应的postId
          this.logger.log('Video found but missing postId, fetching from drafts to convert gen_ to s_', {
            userId,
            remixTargetId: payload.remixTargetId,
            foundGenerationId: originalVideo.generationId,
          })

          try {
            // 获取用户所有token来查找草稿，但使用更直接的方法
            const allUserTokens = await this.getAllUserSoraTokens(userId)
            let foundPostId: string | null = null
            let foundToken: any = null

            for (const searchToken of allUserTokens) {
              try {
                // 直接调用 Sora drafts API，避免递归
                const baseUrl = await this.resolveBaseUrl(searchToken, 'sora', 'https://sora.chatgpt.com')
                const url = new URL('/backend/project_y/profile/drafts', baseUrl).toString()

                const res = await axios.get(url, {
                  headers: {
                    Authorization: `Bearer ${searchToken.secretToken}`,
                    'User-Agent': searchToken.userAgent || 'TapCanvas/1.0',
                    Accept: 'application/json',
                  },
                  params: { limit: 50 },
                  validateStatus: () => true,
                  timeout: 10000,
                })

                if (res.status >= 200 && res.status < 300) {
                  const data = res.data as any
                  const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []

                  // 在草稿中搜索gen_ ID
                  const needle = String(payload.remixTargetId)
                  const matched = items.find((item) => {
                    try {
                      const text = JSON.stringify(item)
                      return text.includes(needle)
                    } catch {
                      return false
                    }
                  })

                  if (matched && matched.post_id) {
                    foundPostId = matched.post_id
                    foundToken = searchToken
                    this.logger.log('Found corresponding postId from Sora drafts API', {
                      userId,
                      generationId: payload.remixTargetId,
                      foundPostId: matched.post_id,
                      matchedId: matched.id,
                      searchTokenId: searchToken.id,
                    })
                    break
                  }
                }
              } catch (err) {
                this.logger.debug('Failed to search drafts with token', {
                  userId,
                  searchTokenId: searchToken.id,
                  error: err?.message,
                })
                continue
              }
            }

            if (foundPostId && foundToken) {
              this.logger.log('Converting gen_ to postId for remix', {
                userId,
                originalGenerationId: payload.remixTargetId,
                convertedPostId: foundPostId,
                tokenLabel: foundToken.label,
              })

              // 使用找到的postId重新创建任务
              return this.createVideoTask(userId, tokenId, {
                ...payload,
                remixTargetId: foundPostId, // 使用s_开头的postId
              }, triedTokenIds)
            } else {
              this.logger.warn('Could not find postId for generation, falling back to original logic', {
                userId,
                remixTargetId: payload.remixTargetId,
              })
            }
          } catch (err) {
            this.logger.warn('Failed to fetch postId from drafts, falling back to original logic', {
              userId,
              remixTargetId: payload.remixTargetId,
              error: err?.message,
            })
          }
        }

        // 使用原视频存储的实际taskId来查找Token映射
        const actualTaskId = originalVideo.taskId
        const tokenResult = await this.tokenRouter.resolveTaskToken(userId, actualTaskId, 'sora')
        if (tokenResult) {
          token = tokenResult.token
          this.logger.log('Using original token for remix', {
            userId,
            remixTargetId: payload.remixTargetId,
            actualTaskId,
            generationId: originalVideo.generationId,
            postId: originalVideo.postId,
            tokenId: token.id,
            originalStatus: originalVideo.status,
          })
        } else {
          this.logger.warn('Original token not found in TaskTokenMapping, trying direct token lookup', {
            userId,
            remixTargetId: payload.remixTargetId,
            actualTaskId,
            originalTokenId: originalVideo.tokenId,
            originalStatus: originalVideo.status,
          })
          // 尝试直接从原始Token ID获取Token
          try {
            const directToken = await this.prisma.modelToken.findUnique({
              where: { id: originalVideo.tokenId },
              include: {
                provider: { include: { endpoints: true } },
              },
            })
            if (directToken && directToken.provider.vendor === 'sora') {
              token = directToken
              this.logger.log('Using direct token lookup for remix', {
                userId,
                remixTargetId: payload.remixTargetId,
                tokenId: token.id,
              })
            } else {
              this.logger.warn('Direct token lookup failed, falling back to optimal token', {
                userId,
                remixTargetId: payload.remixTargetId,
                originalTokenId: originalVideo.tokenId,
              })
              token = await this.tokenRouter.selectOptimalToken(userId, 'sora', tokenId)
            }
          } catch (error) {
            this.logger.error('Error during direct token lookup', {
              userId,
              remixTargetId: payload.remixTargetId,
              originalTokenId: originalVideo.tokenId,
              error: error.message,
            })
            token = await this.tokenRouter.selectOptimalToken(userId, 'sora', tokenId)
          }
        }
      } else {
        // 如果在VideoGenerationHistory中找不到，检查是否是gen_开头的ID，尝试从草稿获取postId
        if (payload.remixTargetId?.startsWith('gen_')) {
          this.logger.log('gen_ ID not found in history, trying to find corresponding postId from drafts', {
            userId,
            remixTargetId: payload.remixTargetId,
          })

          try {
            // 尝试从所有token的草稿中找到这个gen_ ID对应的postId
            const allUserTokens = await this.getAllUserSoraTokens(userId)
            let foundPostId: string | null = null

            for (const searchToken of allUserTokens) {
              try {
                const draft = await this.getDraftByTaskId(userId, searchToken.id, payload.remixTargetId)
                if (draft && draft.raw?.post_id) {
                  foundPostId = draft.raw.post_id
                  this.logger.log('Found corresponding postId from drafts', {
                    userId,
                    generationId: payload.remixTargetId,
                    foundPostId,
                    searchTokenId: searchToken.id,
                  })
                  break
                }
              } catch (err) {
                // 忽略单个token的失败，继续尝试其他token
                continue
              }
            }

            if (foundPostId) {
              // 使用找到的postId重新调用自身，使用s_开头的postId
              return this.createVideoTask(userId, tokenId, {
                ...payload,
                remixTargetId: foundPostId, // 使用s_开头的postId
              }, triedTokenIds)
            }
          } catch (err) {
            this.logger.warn('Failed to find postId from drafts', {
              userId,
              remixTargetId: payload.remixTargetId,
              error: err?.message,
            })
          }
        }

        // 如果在VideoGenerationHistory中找不到，尝试直接从TaskTokenMapping查找
        this.logger.warn('Remix target video not found in VideoGenerationHistory, checking TaskTokenMapping', {
          userId,
          remixTargetId: payload.remixTargetId,
        })

        const taskTokenMapping = await this.prisma.taskTokenMapping.findFirst({
          where: {
            taskId: payload.remixTargetId,
            userId,
          },
          select: {
            tokenId: true,
          },
        })

        if (taskTokenMapping && taskTokenMapping.tokenId) {
          const tokenResult = await this.tokenRouter.resolveTaskToken(userId, payload.remixTargetId, 'sora')
          if (tokenResult) {
            token = tokenResult.token
            this.logger.log('Using original token from TaskTokenMapping for remix', {
              userId,
              remixTargetId: payload.remixTargetId,
              tokenId: token.id,
            })
          } else {
            this.logger.warn('Token from TaskTokenMapping not found, falling back to optimal token', {
              userId,
              remixTargetId: payload.remixTargetId,
              tokenMappingId: taskTokenMapping.tokenId,
            })
            token = await this.tokenRouter.selectOptimalToken(userId, 'sora', tokenId)
          }
        } else {
          // 提供更详细的错误信息和调试信息
          this.logger.warn('Remix target video not found in any records, falling back to optimal token', {
            userId,
            remixTargetId: payload.remixTargetId,
          })

          // 尝试查找用户最近的视频记录，用于调试
          const recentVideos = await this.prisma.videoGenerationHistory.findMany({
            where: { userId },
            select: {
              taskId: true,
              generationId: true,
              status: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
          })

          this.logger.log('Recent videos for user (for debugging)', {
            userId,
            recentVideos,
            remixTargetId: payload.remixTargetId,
          })

          token = await this.tokenRouter.selectOptimalToken(userId, 'sora', tokenId)
        }
      }
    } else {
      // 没有remixTargetId，使用Token路由服务选择最优Token
      token = await this.tokenRouter.selectOptimalToken(userId, 'sora', tokenId)
    }

    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    // 若指定了 remix 目标，则优先走 remix 模式（不再尝试图生）
    let inpaintFileId = this.normalizeSoraFileId(payload.inpaintFileId)
    const remixTargetId = payload.remixTargetId || null

    // 若无 remix，且未显式提供 file_id，但有图片 URL，则尝试先上传图片到 Sora 获取 file_id
    if (!remixTargetId && !inpaintFileId && payload.imageUrl) {
      try {
        // eslint-disable-next-line no-console
        console.log('Sora createVideoTask: start image upload for imageUrl', {
          imageUrl: payload.imageUrl,
        })
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
        // eslint-disable-next-line no-console
        console.log('Sora createVideoTask: uploading image to Sora', {
          uploadUrl,
          contentType,
        })
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
          inpaintFileId = this.normalizeSoraFileId(up && (up.file_id as string | undefined))
          // eslint-disable-next-line no-console
          console.log('Sora createVideoTask: image upload success', {
            status: uploadRes.status,
            file_id: inpaintFileId,
            asset_pointer: up?.asset_pointer,
            raw: up,
          })
        } else {
          // eslint-disable-next-line no-console
          console.log('Sora createVideoTask: image upload failed', {
            status: uploadRes.status,
            data: uploadRes.data,
          })
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
      // Sora 当前稳定支持 portrait，先固定为 portrait，避免 landscape/square 异常
      orientation: 'portrait',
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
      // eslint-disable-next-line no-console
      console.log('Sora createVideoTask: calling nf/create', url)
      // 展开请求体，包含 inpaint_items 具体内容
      // eslint-disable-next-line no-console
      console.log(
        'Sora createVideoTask: payload',
        typeof body === 'object' ? JSON.stringify(body, null, 2) : body,
      )
      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: '*/*',
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      })

      const videoProxyBase = await this.resolveBaseUrl(token, 'videos', 'https://videos.openai.com')
      const rewrite = (raw: string | null | undefined) => this.rewriteVideoUrl(raw || null, videoProxyBase)
      const dataWithUrls = res.data as any
      if (dataWithUrls?.downloadable_url) dataWithUrls.downloadable_url = rewrite(dataWithUrls.downloadable_url)
      if (dataWithUrls?.url) dataWithUrls.url = rewrite(dataWithUrls.url)
      const dataEnc = dataWithUrls?.encodings
      if (dataEnc) {
        if (dataEnc.source?.path) dataEnc.source.path = rewrite(dataEnc.source.path)
        if (dataEnc.thumbnail?.path) dataEnc.thumbnail.path = rewrite(dataEnc.thumbnail.path)
        if (dataEnc.md?.path) dataEnc.md.path = rewrite(dataEnc.md.path)
        if (dataEnc.gif?.path) dataEnc.gif.path = rewrite(dataEnc.gif.path)
      }

      const isRateLimited =
        res.status === 429 &&
        (res.data?.type === 'rate_limit_exhausted' ||
          res.data?.rate_limit_and_credit_balance?.rate_limit_reached === true)
      if (isRateLimited) {
        this.logger.warn('createVideoTask hit rate limit', {
          userId,
          tokenId: token.id,
          triedTokenIds: triedTokenIds,
          rateLimitData: res.data?.rate_limit_and_credit_balance,
        })
        const exclusionIds = Array.from(new Set([...triedTokenIds, token.id]))
        const altToken = await this.findAlternateSoraToken(userId, exclusionIds)
        if (altToken) {
          this.logger.warn('createVideoTask switching tokens', {
            userId,
            from: token.id,
            to: altToken.id,
            triedTokenIds: exclusionIds,
          })
          if (token.shared) {
            await this.registerSharedFailure(token.id)
          }
          return this.createVideoTask(
            userId,
            altToken.id,
            payload,
            exclusionIds,
          )
        }
        this.logger.warn('createVideoTask no alternate token available', {
          userId,
          excluded: exclusionIds,
        })
      }
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

      // 记录任务Token映射，确保后续查询使用同一个Token
      if (dataWithUrls.id) {
        await this.tokenRouter.recordTaskTokenMapping(
          userId,
          token.id,
          dataWithUrls.id,
          'sora'
        )

        // 更新任务状态为运行中
        await this.tokenRouter.updateTaskStatus(
          dataWithUrls.id,
          'sora',
          'running',
          dataWithUrls
        )

        // 记录视频生成历史（用于后续remix和token解析）
        await this.videoHistory.recordVideoGeneration(
          userId,
          '', // nodeId - video creation from sora controller may not have nodeId context
          undefined, // projectId - direct sora creation may not have project context
          payload.prompt,
          {
            orientation: payload.orientation,
            size: payload.size,
            n_frames: payload.n_frames,
            inpaintFileId: payload.inpaintFileId,
            imageUrl: payload.imageUrl,
            remixTargetId: payload.remixTargetId,
          },
          dataWithUrls.id,
          'pending', // initial status
          {
            provider: 'sora',
            model: undefined, // Sora doesn't expose model info in current implementation
            remixTargetId: payload.remixTargetId || undefined,
            tokenId: token.id, // 添加 tokenId - 这是最重要的修复！
          }
        )
      }

      dataWithUrls.__usedTokenId = token.id
      dataWithUrls.__switchedFromTokenIds = triedTokenIds
      dataWithUrls.__tokenSwitched = triedTokenIds.length > 0
      return dataWithUrls
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
   * 查询用户所有Token下的 Sora 视频生成排队 / 运行中任务列表
   * 如果指定tokenId，则只查询该Token；否则查询用户所有可用Token
   */
  async getPendingVideos(userId: string, tokenId?: string) {
    // 如果指定了tokenId，使用原有的逻辑
    if (tokenId) {
      return this.getPendingVideosForToken(userId, tokenId)
    }

    // 查询用户所有的Sora Token
    const userTokens = await this.getAllUserSoraTokens(userId)
    if (userTokens.length === 0) {
      return {
        items: [],
        cursor: null,
        message: 'No Sora tokens available'
      }
    }

    this.logger.log('Querying pending videos for all tokens', {
      userId,
      tokenCount: userTokens.length
    })

    // 并发查询所有Token的pending任务
    const pendingResults = await Promise.allSettled(
      userTokens.map(token => this.getPendingVideosForToken(userId, token.id))
    )

    // 合并结果并去重
    const allItems: any[] = []
    const seenTaskIds = new Set<string>()

    for (const result of pendingResults) {
      if (result.status === 'fulfilled') {
        const data = result.value
        const items = data?.items || data || []

        for (const item of items) {
          const taskId = item.id || item.task_id || item.generation_id
          if (taskId && !seenTaskIds.has(taskId)) {
            seenTaskIds.add(taskId)
            allItems.push({
              ...item,
              __sourceTokenId: item.__usedTokenId || 'unknown'
            })
          }
        }
      } else {
        this.logger.warn('Failed to query pending videos for token', {
          userId,
          error: result.reason?.message
        })
      }
    }

    // 按创建时间排序（最新的在前面）
    allItems.sort((a, b) => {
      const timeA = new Date(a.created_at || a.createdAt || 0).getTime()
      const timeB = new Date(b.created_at || b.createdAt || 0).getTime()
      return timeB - timeA
    })

    return {
      items: allItems,
      cursor: null, // 合并查询不支持分页
      totalTokens: userTokens.length,
      successfulTokens: pendingResults.filter(r => r.status === 'fulfilled').length
    }
  }

  /**
   * 获取用户的所有可用Sora Token（包括自有和共享的）
   */
  private async getAllUserSoraTokens(userId: string): Promise<any[]> {
    const includeConfig = {
      provider: {
        include: { endpoints: true },
      },
    } as const

    // 用户自有Token
    const ownTokens = await this.prisma.modelToken.findMany({
      where: {
        userId,
        enabled: true,
        provider: { vendor: 'sora' },
      },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })

    // 共享Token
    const now = new Date()
    const sharedTokens = await this.prisma.modelToken.findMany({
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

    // 合并并去重（避免同一个Token同时存在于自有和共享中）
    const allTokens = [...ownTokens]
    for (const sharedToken of sharedTokens) {
      if (!ownTokens.find(own => own.id === sharedToken.id)) {
        allTokens.push(sharedToken)
      }
    }

    return allTokens
  }

  /**
   * 查询单个Token的pending任务
   */
  private async getPendingVideosForToken(userId: string, tokenId: string): Promise<any> {
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
        timeout: 10000, // 10秒超时
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

      // 标记数据来源Token
      const data = res.data
      if (data?.items && Array.isArray(data.items)) {
        data.items.forEach((item: any) => {
          item.__usedTokenId = token.id
          item.__tokenLabel = token.label
          item.__isShared = token.shared
        })
      }

      return data
    } catch (err: any) {
      if (token.shared) {
        await this.registerSharedFailure(token.id)
      }

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

  /**
   * 直接获取草稿详情（根据 gen_ ID）
   */
  async getDraftDetailsById(userId: string, tokenId: string | undefined, generationId: string) {
    const token: any = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL(`/backend/project_y/profile/drafts/v2/${generationId}`, baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    this.logger.log('getDraftDetailsById: Fetching draft details', { userId, generationId, tokenId })

    try {
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        validateStatus: () => true,
        timeout: 15000,
      })

      if (res.status < 200 || res.status >= 300) {
        const msg = (res.data && (res.data.message || res.data.error)) || `Draft details fetch failed with status ${res.status}`
        this.logger.error('getDraftDetailsById upstream error', { generationId, tokenId, status: res.status, data: res.data })
        throw new HttpException({ message: msg, upstreamStatus: res.status }, res.status)
      }

      this.logger.log('getDraftDetailsById: Success', { generationId, tokenId })
      return res.data
    } catch (err: any) {
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message = err?.response?.data?.message || err?.response?.statusText || err?.message || 'Draft details fetch failed'
      this.logger.error('getDraftDetailsById exception', { generationId, tokenId, status, message })
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null, upstreamData: err?.response?.data ?? null },
        status,
      )
    }
  }

  /**
   * 获取发布详情（根据 s_ ID）
   */
  async getPostDetailsById(userId: string, tokenId: string | undefined, postId: string) {
    const token: any = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL(`/backend/project_y/post/${postId}`, baseUrl).toString()
    const userAgent = token.userAgent || 'TapCanvas/1.0'

    this.logger.log('getPostDetailsById: Fetching post details', { userId, postId, tokenId })

    try {
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        validateStatus: () => true,
        timeout: 15000,
      })

      if (res.status < 200 || res.status >= 300) {
        const msg = (res.data && (res.data.message || res.data.error)) || `Post details fetch failed with status ${res.status}`
        this.logger.error('getPostDetailsById upstream error', { postId, tokenId, status: res.status, data: res.data })
        throw new HttpException({ message: msg, upstreamStatus: res.status }, res.status)
      }

      this.logger.log('getPostDetailsById: Success', { postId, tokenId })
      return res.data
    } catch (err: any) {
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message = err?.response?.data?.message || err?.response?.statusText || err?.message || 'Post details fetch failed'
      this.logger.error('getPostDetailsById exception', { postId, tokenId, status, message })
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null, upstreamData: err?.response?.data ?? null },
        status,
      )
    }
  }

  /**
   * 根据 task_id 反查对应的草稿信息（用于获取最终视频 URL）
   * 更新：优先使用直接 API 调用，避免列表匹配
   */
  async getDraftByTaskId(userId: string, tokenId: string | undefined, taskId: string) {
    this.logger.log('getDraftByTaskId: Starting optimized search', { userId, tokenId, taskId })

    // 软性状态检查：优先信任实际的草稿数据
    let taskStatus = null
    try {
      taskStatus = await this.prisma.taskStatus.findUnique({
        where: {
          taskId_provider: {
            taskId,
            provider: 'sora'
          }
        },
        select: {
          status: true,
          data: true,
          updatedAt: true
        }
      })
    } catch (error: any) {
      this.logger.warn('Failed to check task status, proceeding with draft search', {
        userId,
        taskId,
        error: error.message
      })
    }

    // 如果任务状态明确显示还在处理中，记录警告但不阻塞查询
    if (taskStatus && (taskStatus.status === 'pending' || taskStatus.status === 'running')) {
      this.logger.log('Task status shows still running, but checking for completed draft anyway', {
        userId,
        taskId,
        status: taskStatus.status,
        updatedAt: taskStatus.updatedAt
      })
    }

    this.logger.log('Proceeding with draft search', {
      userId,
      taskId,
      taskStatus: taskStatus?.status || 'unknown'
    })

    // 优先使用任务Token映射来获取正确的Token
    const taskTokenResult = await this.tokenRouter.resolveTaskToken(userId, taskId, 'sora')
    let token: any
    let usedMethod = 'unknown'

    if (taskTokenResult) {
      token = taskTokenResult.token
      usedMethod = 'task-mapped'
      this.logger.log('Using task-mapped token for draft lookup', {
        userId,
        taskId,
        tokenId: taskTokenResult.tokenId,
        tokenLabel: taskTokenResult.token.label,
      })
    } else {
      // 回退到传入的tokenId或默认Token
      token = await this.resolveSoraToken(userId, tokenId)
      if (!token || token.provider.vendor !== 'sora') {
        throw new Error('token not found or not a Sora token')
      }
      usedMethod = 'fallback'
      this.logger.warn('Task token mapping not found, using fallback token', {
        userId,
        taskId,
        tokenId,
        tokenLabel: token.label,
      })
    }

    // 尝试直接使用 gen_ ID 获取草稿详情
    if (taskId.startsWith('gen_')) {
      try {
        const draftDetails = await this.getDraftDetailsById(userId, token.id, taskId)
        this.logger.log('getDraftByTaskId: Success using direct draft API', {
          userId,
          taskId,
          tokenId: token.id,
          usedMethod,
          hasVideoUrl: !!draftDetails.videoUrl,
          hasPostId: !!draftDetails.postId,
        })

        const videoProxyBase = await this.resolveBaseUrl(token, 'videos', 'https://videos.openai.com')
        const rewrite = (raw: string | null | undefined) => this.rewriteVideoUrl(raw || null, videoProxyBase)

        const result = {
          id: draftDetails.id,
          title: draftDetails.title,
          prompt: draftDetails.prompt,
          thumbnailUrl: rewrite(draftDetails.thumbnailUrl),
          videoUrl: rewrite(draftDetails.videoUrl),
          postId: draftDetails.postId,
          raw: draftDetails,
        }

        return result
      } catch (error: any) {
        this.logger.warn('Direct draft API failed, trying legacy method', {
          userId,
          taskId,
          tokenId: token.id,
          error: error.message,
          status: error?.response?.status,
        })
      }
    }

    // 如果 gen_ ID 查找失败，尝试 s_ ID 查找发布详情
    if (taskId.startsWith('s_')) {
      try {
        const postDetails = await this.getPostDetailsById(userId, token.id, taskId)
        this.logger.log('getDraftByTaskId: Success using post API', {
          userId,
          taskId,
          tokenId: token.id,
          usedMethod,
          hasVideoUrl: !!postDetails.videoUrl,
        })

        const videoProxyBase = await this.resolveBaseUrl(token, 'videos', 'https://videos.openai.com')
        const rewrite = (raw: string | null | undefined) => this.rewriteVideoUrl(raw || null, videoProxyBase)

        const result = {
          id: postDetails.id,
          title: postDetails.title,
          prompt: postDetails.prompt,
          thumbnailUrl: rewrite(postDetails.thumbnailUrl),
          videoUrl: rewrite(postDetails.videoUrl),
          postId: postDetails.id,
          raw: postDetails,
        }

        return result
      } catch (error: any) {
        this.logger.warn('Post API failed, falling back to legacy method', {
          userId,
          taskId,
          tokenId: token.id,
          error: error.message,
          status: error?.response?.status,
        })
      }
    }

    // 如果直接API调用都失败，回退到原来的列表匹配方法
    this.logger.warn('Direct APIs failed, falling back to legacy draft search', {
      userId,
      taskId,
      tokenId: token.id,
    })

    let tokens: any[] = []
    let searchOrder: string[] = []

    if (taskTokenResult) {
      tokens = [taskTokenResult.token]
      searchOrder = ['task-mapped']
      this.logger.log('Using task-mapped token for search', {
        userId,
        taskId,
        tokenId: taskTokenResult.tokenId,
        tokenLabel: taskTokenResult.token.label
      })
    } else {
      // 获取用户所有的 Sora Token（包括自有和共享的）
      const allUserTokens = await this.getAllUserSoraTokens(userId)

      // 如果传入了tokenId，优先使用指定的token
      if (tokenId) {
        const specifiedToken = allUserTokens.find(t => t.id === tokenId)
        if (specifiedToken) {
          tokens = [specifiedToken, ...allUserTokens.filter(t => t.id !== tokenId)]
          searchOrder = ['specified', 'all-others']
        } else {
          tokens = allUserTokens
          searchOrder = ['all-user-tokens']
        }
      } else {
        tokens = allUserTokens
        searchOrder = ['all-user-tokens']
      }

      this.logger.log('Searching across all user tokens', {
        userId,
        taskId,
        totalTokens: tokens.length,
        searchOrder,
        tokenId
      })
    }

    // 如果没有找到任何token，抛出错误
    if (tokens.length === 0) {
      throw new Error('No Sora tokens available for search')
    }

    // 逐个Token搜索草稿
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex]
      const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
      const url = new URL('/backend/project_y/profile/drafts', baseUrl).toString()
      const userAgent = token.userAgent || 'TapCanvas/1.0'

      this.logger.log(`Searching token ${tokenIndex + 1}/${tokens.length}`, {
        userId,
        taskId,
        tokenId: token.id,
        tokenLabel: token.label,
        isShared: token.shared,
        baseUrl,
      })

      let lastError: any = null

      try {
        const maxAttempts = 3
        const retryDelayMs = 3000 // 稍微减少重试延迟，因为我们有多个token要搜索

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const res = await axios.get(url, {
            headers: {
              Authorization: `Bearer ${token.secretToken}`,
              'User-Agent': userAgent,
              Accept: 'application/json',
            },
            params: { limit: 20 }, // 增加limit，提高找到的概率
            validateStatus: () => true,
          })

          if (res.status < 200 || res.status >= 300) {
            this.logger.warn('Token search failed', {
              taskId,
              tokenId: token.id,
              tokenLabel: token.label,
              attempt,
              status: res.status,
              error: res.data?.message || res.statusText,
            })

            // 如果是认证错误，跳到下一个token
            if (res.status === 401 || res.status === 403) {
              this.logger.warn('Token authentication failed, trying next token', {
                taskId,
                tokenId: token.id,
              })
              break // 跳出重试循环，尝试下一个token
            }

            if (attempt < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, retryDelayMs))
              continue
            }

            // 最后一次重试失败，记录但不抛出异常，继续尝试下一个token
            this.logger.error('All attempts failed for token', {
              taskId,
              tokenId: token.id,
              finalStatus: res.status,
            })
            break
          }

          const data = res.data as any
          const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []

          this.logger.log('Draft search response', {
            tokenIndex: tokenIndex + 1,
            tokenId: token.id,
            attempt,
            taskId,
            itemsCount: items.length,
            hasCursor: !!data?.cursor,
          })

          const needle = String(taskId)
          const matched = items.find((item) => {
            try {
              const text = JSON.stringify(item)
              return text.includes(needle)
            } catch {
              return false
            }
          })

          if (matched) {
            this.logger.log('Found match in token search', {
              taskId,
              tokenId: token.id,
              tokenLabel: token.label,
              matchedId: matched.id,
              attempt,
            })

            const enc = matched.encodings || {}

            const thumbnail =
              enc.thumbnail?.path ||
              matched.preview_image_url ||
              matched.thumbnail_url ||
              null
            const videoUrl =
              matched.downloadable_url ||
              matched.url ||
              enc.source?.path ||
              null

            const videoProxyBase = await this.resolveBaseUrl(token, 'videos', 'https://videos.openai.com')
            const rewrite = (raw: string | null | undefined) => this.rewriteVideoUrl(raw || null, videoProxyBase)
            const thumbnailUrl = rewrite(thumbnail)
            const finalVideoUrl = rewrite(videoUrl)

            if (thumbnailUrl) {
              matched.thumbnail_url = thumbnailUrl
              if (enc.thumbnail) enc.thumbnail.path = thumbnailUrl
            }
            if (finalVideoUrl) {
              matched.downloadable_url = finalVideoUrl
              matched.url = finalVideoUrl
              if (enc.source) enc.source.path = finalVideoUrl
            }

            this.logger.log('getDraftByTaskId success', {
              taskId,
              foundTokenId: token.id,
              foundTokenLabel: token.label,
              matchedId: matched.id,
              videoUrl: finalVideoUrl || videoUrl,
              thumbnail: thumbnailUrl || thumbnail,
              searchOrder,
              tokensSearched: tokenIndex + 1,
            })

            // 更新视频生成历史状态为成功
            await this.videoHistory.updateVideoGeneration(taskId, {
              status: 'success',
              videoUrl: finalVideoUrl || videoUrl || undefined,
              thumbnailUrl: thumbnailUrl || thumbnail || undefined,
              duration: matched.duration || undefined,
              width: matched.width || undefined,
              height: matched.height || undefined,
              generationId: (matched as any).generation_id || (matched as any).id, // 存储gen_开头的ID
            })

            this.logger.log('Video generation history updated with generation ID', {
              taskId,
              generationId: (matched as any).generation_id || (matched as any).id,
              status: 'success',
              foundTokenId: token.id,
            })

            // 更新任务状态为成功
            await this.tokenRouter.updateTaskStatus(taskId, 'sora', 'success', {
              videoUrl: finalVideoUrl || videoUrl,
              thumbnailUrl: thumbnailUrl || thumbnail,
              width: matched.width,
              height: matched.height,
              duration: matched.duration,
            })

            const postId = await this.publishVideoPostIfNeeded(token, baseUrl, matched, userId)

            return {
              id: matched.id,
              title: matched.title ?? null,
              prompt: matched.prompt ?? matched.creation_config?.prompt ?? null,
              thumbnailUrl: thumbnailUrl || thumbnail,
              videoUrl: finalVideoUrl || videoUrl,
              postId,
              raw: matched,
            }
          }

          // 如果没找到匹配项，但还有重试机会
          if (attempt < maxAttempts) {
            this.logger.warn('No match in this attempt, retrying', {
              taskId,
              tokenId: token.id,
              attempt,
              itemsCount: items.length,
            })
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
            continue
          }

          // 这个Token的所有重试都失败了
          this.logger.warn('No match found in token after all attempts', {
            taskId,
            tokenId: token.id,
            tokenLabel: token.label,
            totalAttempts: maxAttempts,
            finalItemsCount: items.length,
          })
        }

        // 如果当前token的所有尝试都失败，继续尝试下一个token
        // 这个逻辑会在循环结束后自然执行
      } catch (err: any) {
        lastError = err
        this.logger.error('Error searching token', {
          taskId,
          tokenId: token.id,
          tokenLabel: token.label,
          error: err?.message || 'Unknown error',
        })

        // 如果是认证错误，直接跳到下一个token
        if (err?.response?.status === 401 || err?.response?.status === 403) {
          this.logger.warn('Token authentication failed, skipping to next token', {
            taskId,
            tokenId: token.id,
          })
          break // 跳出重试循环，尝试下一个token
        }
      }
    }

    // 如果所有token都搜索完了还没找到
    this.logger.error('Video not found in any user token', {
      userId,
      taskId,
      totalTokensSearched: tokens.length,
      searchOrder,
      tokenId,
    })

    // 更新视频生成历史状态为失败
    await this.videoHistory.updateVideoGeneration(taskId, {
      status: 'error',
    })

    // 更新任务状态为失败
    await this.tokenRouter.updateTaskStatus(taskId, 'sora', 'error', {
      error: 'Video not found in any Sora token drafts',
    })

    throw new HttpException(
      {
        message: `在所有 ${tokens.length} 个 Sora 账号的草稿中都未找到对应视频，请确认任务ID是否正确或稍后再试`,
        upstreamStatus: 404
      },
      HttpStatus.NOT_FOUND,
    )
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

  private async findAlternateSoraToken(userId: string, excludeIds: string[]): Promise<any | null> {
    const includeConfig = {
      provider: {
        include: { endpoints: true },
      },
    } as const
    const filtered = (excludeIds || []).filter(Boolean)

    const owned = await this.prisma.modelToken.findFirst({
      where: {
        userId,
        enabled: true,
        provider: { vendor: 'sora' },
        NOT: filtered.length ? { id: { in: filtered } } : undefined,
      },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })
    if (owned) return owned

    const now = new Date()
    const shared = await this.prisma.modelToken.findFirst({
      where: {
        shared: true,
        enabled: true,
        provider: { vendor: 'sora' },
        OR: [
          { sharedDisabledUntil: null },
          { sharedDisabledUntil: { lt: now } },
        ],
        NOT: filtered.length ? { id: { in: filtered } } : undefined,
      },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })
    return shared || null
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

  /**
   * 将 Sora 各类 file id 规范化为纯 `file_...` 形式。
   * 示例：
   * - `file_00000000491071f6a497cfeba74fe8dd` → 原样返回
   * - `5b9033ba1441172#file_00000000765871f79cb1e713eef290eb#thumbnail` → 截成 `file_00000000765871f79cb1e713eef290eb`
   */
  private normalizeSoraFileId(id: string | null | undefined): string | null {
    if (!id) return null
    if (id.startsWith('file_')) return id
    const m = id.match(/file_[^#]+/)
    if (m && m[0]) return m[0]
    return id
  }

  private rewriteVideoUrl(url: string | null, proxyBase: string): string | null {
    if (!url) return null
    try {
      const parsed = new URL(url)
      const baseParsed = new URL(proxyBase)
      parsed.protocol = baseParsed.protocol
      parsed.host = baseParsed.host
      return parsed.toString()
    } catch {
      return url
    }
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

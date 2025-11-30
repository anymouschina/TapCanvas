import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

export interface VideoGenerationRecord {
  id: string
  prompt: string
  parameters?: any
  imageUrl?: string | null
  taskId: string
  generationId?: string | null
  status: string
  videoUrl?: string | null
  thumbnailUrl?: string | null
  duration?: number
  width?: number
  height?: number
  tokenId?: string | null
  provider: string
  model?: string | null
  cost?: number | null
  createdAt: string
  isFavorite?: boolean
  rating?: number | null
  notes?: string | null
}

@Injectable()
export class VideoHistoryService {
  private readonly logger = new Logger(VideoHistoryService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录视频生成历史
   */
  async recordVideoGeneration(
    userId: string,
    nodeId: string,
    projectId: string | undefined,
    prompt: string,
    parameters: any,
    taskId: string,
    status: string,
    options: {
      imageUrl?: string
      videoUrl?: string
      thumbnailUrl?: string
      duration?: number
      width?: number
      height?: number
      tokenId?: string
      provider: string
      model?: string
      cost?: number
      remixTargetId?: string
    }
  ): Promise<void> {
    try {
      await this.prisma.videoGenerationHistory.create({
        data: {
          userId,
          nodeId,
          projectId,
          prompt,
          parameters,
          imageUrl: options.imageUrl,
          remixTargetId: options.remixTargetId,
          taskId,
          status,
          videoUrl: options.videoUrl,
          thumbnailUrl: options.thumbnailUrl,
          duration: options.duration,
          width: options.width,
          height: options.height,
          tokenId: options.tokenId,
          provider: options.provider,
          model: options.model,
          cost: options.cost,
        },
      })

      this.logger.log('Video generation recorded', {
        userId,
        nodeId,
        taskId,
        status,
      })
    } catch (error) {
      this.logger.error('Failed to record video generation', {
        userId,
        nodeId,
        taskId,
        error: error.message,
      })
    }
  }

  /**
   * 更新视频生成状态和结果
   */
  async updateVideoGeneration(
    taskId: string,
    updates: {
      status?: string
      videoUrl?: string
      thumbnailUrl?: string
      duration?: number
      width?: number
      height?: number
      cost?: number
      generationId?: string
    }
  ): Promise<void> {
    try {
      await this.prisma.videoGenerationHistory.updateMany({
        where: { taskId },
        data: updates,
      })

      this.logger.log('Video generation updated', { taskId, updates })
    } catch (error) {
      this.logger.error('Failed to update video generation', {
        taskId,
        updates,
        error: error.message,
      })
    }
  }

  /**
   * 获取节点的视频生成历史
   */
  async getNodeHistory(
    userId: string,
    nodeId: string,
    limit: number = 20
  ): Promise<VideoGenerationRecord[]> {
    try {
      const records = await this.prisma.videoGenerationHistory.findMany({
        where: {
          userId,
          nodeId,
          status: 'success', // 只返回成功的记录
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          prompt: true,
          parameters: true,
          imageUrl: true,
          taskId: true,
          generationId: true,
          status: true,
          videoUrl: true,
          thumbnailUrl: true,
          duration: true,
          width: true,
          height: true,
          tokenId: true,
          provider: true,
          model: true,
          cost: true,
          createdAt: true,
        },
      })

      return records.map(record => ({
        ...record,
        createdAt: record.createdAt.toISOString(),
        duration: record.duration || undefined,
        width: record.width || undefined,
        height: record.height || undefined,
        cost: record.cost || undefined,
        model: record.model || undefined,
        tokenId: record.tokenId || undefined,
        videoUrl: record.videoUrl || undefined,
        thumbnailUrl: record.thumbnailUrl || undefined,
        imageUrl: record.imageUrl || undefined,
      }))
    } catch (error) {
      this.logger.error('Failed to get node video history', {
        userId,
        nodeId,
        error: error.message,
      })
      return []
    }
  }

  /**
   * 获取用户的所有视频生成历史
   */
  async getUserHistory(
    userId: string,
    filters: {
      projectId?: string
      status?: string
      limit?: number
      offset?: number
      isFavorite?: boolean
      provider?: string | string[]
    } = {},
  ): Promise<{ records: VideoGenerationRecord[]; total: number }> {
    try {
      const where: any = { userId }

      if (filters.projectId) {
        where.projectId = filters.projectId
      }

      if (filters.status) {
        where.status = filters.status
      }

      if (filters.isFavorite !== undefined) {
        where.isFavorite = filters.isFavorite
      }

      if (filters.provider) {
        if (Array.isArray(filters.provider)) {
          where.provider = { in: filters.provider }
        } else {
          where.provider = filters.provider
        }
      }

      const [records, total] = await Promise.all([
        this.prisma.videoGenerationHistory.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: filters.limit || 50,
          skip: filters.offset || 0,
          select: {
            id: true,
            prompt: true,
            parameters: true,
            imageUrl: true,
            taskId: true,
            generationId: true,
            status: true,
            videoUrl: true,
            thumbnailUrl: true,
            duration: true,
            width: true,
            height: true,
            tokenId: true,
            provider: true,
            model: true,
            cost: true,
            isFavorite: true,
            rating: true,
            notes: true,
            createdAt: true,
          },
        }),
        this.prisma.videoGenerationHistory.count({ where }),
      ])

      return {
        records: records.map(record => ({
          ...record,
          createdAt: record.createdAt.toISOString(),
          duration: record.duration || undefined,
          width: record.width || undefined,
          height: record.height || undefined,
          cost: record.cost || undefined,
          model: record.model || undefined,
          tokenId: record.tokenId || undefined,
          videoUrl: record.videoUrl || undefined,
          thumbnailUrl: record.thumbnailUrl || undefined,
          imageUrl: record.imageUrl || undefined,
        })),
        total,
      }
    } catch (error) {
      this.logger.error('Failed to get user video history', {
        userId,
        error: error.message,
      })
      return { records: [], total: 0 }
    }
  }

  /**
   * 设置/取消收藏
   */
  async toggleFavorite(
    userId: string,
    recordId: string,
    isFavorite: boolean
  ): Promise<void> {
    try {
      await this.prisma.videoGenerationHistory.updateMany({
        where: {
          id: recordId,
          userId, // 确保用户只能操作自己的记录
        },
        data: { isFavorite },
      })

      this.logger.log('Video favorite toggled', { userId, recordId, isFavorite })
    } catch (error) {
      this.logger.error('Failed to toggle video favorite', {
        userId,
        recordId,
        isFavorite,
        error: error.message,
      })
    }
  }

  /**
   * 添加评分和备注
   */
  async addRatingAndNotes(
    userId: string,
    recordId: string,
    rating?: number,
    notes?: string
  ): Promise<void> {
    try {
      const updateData: any = {}
      if (rating !== undefined) {
        updateData.rating = Math.max(1, Math.min(5, rating)) // 限制在1-5之间
      }
      if (notes !== undefined) {
        updateData.notes = notes
      }

      await this.prisma.videoGenerationHistory.updateMany({
        where: {
          id: recordId,
          userId,
        },
        data: updateData,
      })

      this.logger.log('Video rating and notes added', { userId, recordId, rating })
    } catch (error) {
      this.logger.error('Failed to add video rating and notes', {
        userId,
        recordId,
        rating,
        notes,
        error: error.message,
      })
    }
  }

  /**
   * 删除历史记录
   */
  async deleteRecord(
    userId: string,
    recordId: string
  ): Promise<boolean> {
    try {
      const result = await this.prisma.videoGenerationHistory.deleteMany({
        where: {
          id: recordId,
          userId,
        },
      })

      return result.count > 0
    } catch (error) {
      this.logger.error('Failed to delete video record', {
        userId,
        recordId,
        error: error.message,
      })
      return false
    }
  }

  /**
   * 获取统计数据
   */
  async getStatistics(
    userId: string,
    projectId?: string
  ): Promise<{
    totalGenerations: number
    successfulGenerations: number
    totalCost: number
    averageDuration: number
    favoriteCount: number
  }> {
    try {
      const where: any = { userId }
      if (projectId) {
        where.projectId = projectId
      }

      const [total, success, costResult, durationResult, favoriteResult] = await Promise.all([
        this.prisma.videoGenerationHistory.count({ where }),
        this.prisma.videoGenerationHistory.count({ where: { ...where, status: 'success' } }),
        this.prisma.videoGenerationHistory.aggregate({
          where: { ...where, status: 'success' },
          _sum: { cost: true },
        }),
        this.prisma.videoGenerationHistory.aggregate({
          where: { ...where, status: 'success', duration: { not: null } },
          _avg: { duration: true },
        }),
        this.prisma.videoGenerationHistory.count({ where: { ...where, isFavorite: true } }),
      ])

      return {
        totalGenerations: total,
        successfulGenerations: success,
        totalCost: costResult._sum.cost || 0,
        averageDuration: durationResult._avg.duration || 0,
        favoriteCount: favoriteResult,
      }
    } catch (error) {
      this.logger.error('Failed to get video statistics', {
        userId,
        projectId,
        error: error.message,
      })
      return {
        totalGenerations: 0,
        successfulGenerations: 0,
        totalCost: 0,
        averageDuration: 0,
        favoriteCount: 0,
      }
    }
  }
}

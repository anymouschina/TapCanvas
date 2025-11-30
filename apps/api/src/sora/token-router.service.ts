import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class TokenRouterService {
  private readonly logger = new Logger(TokenRouterService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建任务时记录使用的Token
   * @param userId 用户ID
   * @param tokenId 使用的Token ID
   * @param taskId 任务唯一标识
   * @param provider 提供商名称
   */
  async recordTaskTokenMapping(
    userId: string,
    tokenId: string,
    taskId: string,
    provider: string = 'sora'
  ): Promise<void> {
    // 设置7天后过期，避免数据无限增长
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    try {
      await this.prisma.taskTokenMapping.upsert({
        where: {
          taskId_provider: {
            taskId,
            provider,
          },
        },
        update: {
          tokenId,
          userId,
          expiresAt,
        },
        create: {
          taskId,
          provider,
          tokenId,
          userId,
          expiresAt,
        },
      })

      // 记录任务状态
      await this.prisma.taskStatus.upsert({
        where: {
          taskId_provider: {
            taskId,
            provider,
          },
        },
        update: {
          status: 'pending',
          updatedAt: new Date(),
          userId,
        },
        create: {
          taskId,
          provider,
          status: 'pending',
          userId,
        },
      })

      this.logger.log('Task token mapping recorded', { userId, tokenId, taskId, provider })
    } catch (error) {
      this.logger.error('Failed to record task token mapping', {
        userId,
        tokenId,
        taskId,
        provider,
        error: error.message,
      })
      // 不抛出异常，避免影响主流程
    }
  }

  /**
   * 根据任务ID获取创建时使用的Token
   * @param userId 用户ID
   * @param taskId 任务唯一标识
   * @param provider 提供商名称
   * @returns Token信息或null
   */
  async resolveTaskToken(
    userId: string,
    taskId: string,
    provider: string = 'sora'
  ): Promise<{ tokenId: string; token: any } | null> {
    try {
      // 清理过期的映射记录
      await this.cleanupExpiredMappings()

      // 查询任务Token映射
      const mapping = await this.prisma.taskTokenMapping.findUnique({
        where: {
          taskId_provider: {
            taskId,
            provider,
          },
        },
        include: {
          token: {
            include: {
              provider: {
                include: {
                  endpoints: true,
                },
              },
            },
          },
        },
      })

      if (!mapping) {
        this.logger.warn('Task token mapping not found', { userId, taskId, provider })
        return null
      }

      // 验证用户权限（只能查询自己创建的任务）
      if (mapping.userId !== userId) {
        this.logger.warn('User tried to access another user\'s task', {
          userId,
          taskUserId: mapping.userId,
          taskId,
        })
        return null
      }

      // 验证Token是否仍然有效
      if (!mapping.token.enabled) {
        this.logger.warn('Token disabled for task', { tokenId: mapping.tokenId, taskId })
        return null
      }

      // 处理共享Token的临时禁用
      if (mapping.token.shared) {
        const now = new Date()
        if (
          mapping.token.sharedDisabledUntil &&
          mapping.token.sharedDisabledUntil > now
        ) {
          this.logger.warn('Shared token temporarily disabled', {
            tokenId: mapping.tokenId,
            disabledUntil: mapping.token.sharedDisabledUntil,
            taskId,
          })
          return null
        }
      }

      this.logger.log('Task token resolved successfully', {
        userId,
        tokenId: mapping.tokenId,
        taskId,
      })

      return {
        tokenId: mapping.tokenId,
        token: mapping.token,
      }
    } catch (error) {
      this.logger.error('Failed to resolve task token', {
        userId,
        taskId,
        provider,
        error: error.message,
      })
      return null
    }
  }

  /**
   * 更新任务状态
   * @param taskId 任务ID
   * @param provider 提供商
   * @param status 任务状态
   * @param data 任务相关数据
   */
  async updateTaskStatus(
    taskId: string,
    provider: string,
    status: string,
    data?: any,
    userId?: string,
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      }

      if (data) {
        updateData.data = data
      }

       if (userId) {
        updateData.userId = userId
      }

      if (status === 'success' || status === 'error' || status === 'canceled') {
        updateData.completedAt = new Date()
      }

      await this.prisma.taskStatus.upsert({
        where: {
          taskId_provider: {
            taskId,
            provider,
          },
        },
        update: updateData,
        create: {
          taskId,
          provider,
          status,
          data,
          userId,
        },
      })

      this.logger.log('Task status updated', { taskId, provider, status })
    } catch (error) {
      this.logger.error('Failed to update task status', {
        taskId,
        provider,
        status,
        error: error.message,
      })
    }
  }

  /**
   * 智能Token选择（用于创建任务时）
   * @param userId 用户ID
   * @param provider 提供商
   * @param preferredTokenId 偏好的Token ID（可选）
   * @returns 最优Token
   */
  async selectOptimalToken(
    userId: string,
    provider: string = 'sora',
    preferredTokenId?: string
  ): Promise<any | null> {
    const includeConfig = {
      provider: {
        include: { endpoints: true },
      },
    } as const

    // 如果指定了Token ID，优先使用
    if (preferredTokenId) {
      let token = await this.prisma.modelToken.findFirst({
        where: { id: preferredTokenId, userId },
        include: includeConfig,
      })

      if (!token) {
        // 尝试共享Token
        token = await this.prisma.modelToken.findFirst({
          where: { id: preferredTokenId, shared: true },
          include: includeConfig,
        })
      }

      if (token && token.enabled) {
        return token
      }
    }

    // 用户自有Token
    const ownToken = await this.prisma.modelToken.findFirst({
      where: {
        userId,
        enabled: true,
        provider: { vendor: provider }
      },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })

    if (ownToken) return ownToken

    // 共享Token
    const now = new Date()
    const sharedToken = await this.prisma.modelToken.findFirst({
      where: {
        shared: true,
        enabled: true,
        provider: { vendor: provider },
        OR: [
          { sharedDisabledUntil: null },
          { sharedDisabledUntil: { lt: now } },
        ],
      },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })

    return sharedToken || null
  }

  /**
   * 清理过期的映射记录
   */
  private async cleanupExpiredMappings(): Promise<void> {
    try {
      const now = new Date()
      const result = await this.prisma.taskTokenMapping.deleteMany({
        where: {
          expiresAt: {
            lt: now,
          },
        },
      })

      if (result.count > 0) {
        this.logger.log('Cleaned up expired task token mappings', {
          deletedCount: result.count,
        })
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired mappings', {
        error: error.message,
      })
    }
  }

  /**
   * 获取用户的任务列表
   * @param userId 用户ID
   * @param provider 提供商
   * @param status 状态过滤（可选）
   * @param limit 限制数量
   * @param cursor 分页游标
   */
  async getUserTasks(
    userId: string,
    provider: string = 'sora',
    status?: string,
    limit?: number,
    cursor?: string
  ): Promise<{ items: any[]; cursor?: string }> {
    const where: any = {
      userId,
      provider,
    }

    if (status) {
      where.status = status
    }

    // 先查询任务状态
    const tasks = await this.prisma.taskStatus.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit || 50,
      ...(cursor && { cursor: { id: cursor } }),
    })

    // 然后查询关联的Token映射信息
    const taskIds = tasks.map(task => task.taskId)
    const mappings = taskIds.length > 0
      ? await this.prisma.taskTokenMapping.findMany({
          where: {
            taskId: { in: taskIds },
            provider,
          },
          include: {
            token: {
              select: {
                id: true,
                label: true,
                shared: true,
                user: {
                  select: {
                    id: true,
                    login: true,
                    name: true,
                  },
                },
              },
            },
          },
        })
      : []

    // 组合数据
    const items = tasks.map(task => {
      const mapping = mappings.find(m => m.taskId === task.taskId)
      return {
        ...task,
        taskTokenMapping: mapping || null,
      }
    })

    return {
      items,
      cursor: items.length === (limit || 50) ? items[items.length - 1].id : undefined,
    }
  }
}

import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    // 获取用户的所有资产，不限制项目
    return this.prisma.asset.findMany({
      where: { ownerId: String(userId) },
      orderBy: { updatedAt: 'desc' }
    })
  }

  create(userId: string, input: { name: string; data: any }) {
    // 创建用户级别的资产，不绑定项目
    return this.prisma.asset.create({
      data: {
        name: input.name,
        data: input.data as any,
        ownerId: String(userId),
        projectId: null // 明确设置为null
      }
    })
  }

  rename(userId: string, id: string, name: string) {
    return this.prisma.asset.update({ where: { id }, data: { name } })
  }

  remove(userId: string, id: string) {
    return this.prisma.asset.delete({ where: { id } })
  }
}


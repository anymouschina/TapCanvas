import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.project.findMany({
      where: { ownerId: String(userId) },
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: {
          select: { login: true, name: true }
        }
      }
    })
  }

  async listPublic() {
    return this.prisma.project.findMany({
      where: { isPublic: true },
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: {
          select: { login: true, name: true }
        }
      }
    })
  }

  async upsert(userId: string, input: { id?: string; name: string }) {
    if (input.id) {
      // 验证所有权
      const project = await this.prisma.project.findUnique({ where: { id: input.id } })
      if (!project) throw new BadRequestException('Project not found')
      if (project.ownerId !== String(userId)) throw new ForbiddenException('Not project owner')

      return this.prisma.project.update({ where: { id: input.id }, data: { name: input.name } })
    }
    return this.prisma.project.create({
      data: { name: input.name, ownerId: String(userId) },
      include: {
        owner: {
          select: { login: true, name: true }
        }
      }
    })
  }

  async togglePublic(userId: string, projectId: string, isPublic: boolean) {
    // 验证所有权
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new BadRequestException('Project not found')
    if (project.ownerId !== String(userId)) throw new ForbiddenException('Not project owner')

    return this.prisma.project.update({
      where: { id: projectId },
      data: { isPublic },
      include: {
        owner: {
          select: { login: true, name: true }
        }
      }
    })
  }

  async clone(userId: string, projectId: string, newName?: string) {
    // 验证源项目存在且公开
    const sourceProject = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: {
          select: { login: true, name: true }
        }
      }
    })
    if (!sourceProject) throw new BadRequestException('Project not found')
    if (!sourceProject.isPublic && sourceProject.ownerId !== String(userId)) {
      throw new ForbiddenException('Project is not public')
    }

    // 创建新项目
    const clonedProject = await this.prisma.project.create({
      data: {
        name: newName || `${sourceProject.name} (Cloned)`,
        ownerId: String(userId)
      },
      include: {
        owner: {
          select: { login: true, name: true }
        }
      }
    })

    // 复制所有工作流
    const sourceFlows = await this.prisma.flow.findMany({ where: { projectId } })
    if (sourceFlows.length > 0) {
      await this.prisma.flow.createMany({
        data: sourceFlows.map(flow => ({
          name: flow.name,
          data: flow.data as any, // 类型转换解决 Prisma 类型问题
          ownerId: String(userId),
          projectId: clonedProject.id
        }))
      })
    }

    return clonedProject
  }

  async getProjectFlows(projectId: string) {
    // 验证项目存在且公开
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new BadRequestException('Project not found')
    if (!project.isPublic) throw new ForbiddenException('Project is not public')

    return this.prisma.flow.findMany({
      where: { projectId },
      orderBy: { updatedAt: 'desc' }
    })
  }
}


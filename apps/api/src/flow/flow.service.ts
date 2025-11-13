import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class FlowService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.flow.findMany({ where: { ownerId: String(userId) }, orderBy: { updatedAt: 'desc' } })
  }

  get(id: string, userId: string) {
    return this.prisma.flow.findFirst({ where: { id, ownerId: String(userId) } })
  }

  async upsert(userId: string, input: { id?: string; name: string; data: any; projectId?: string|null }) {
    if (input.id) {
      const updated = await this.prisma.flow.update({ where: { id: input.id }, data: { name: input.name, data: input.data as any, ownerId: String(userId), projectId: input.projectId || undefined } })
      await this.prisma.flowVersion.create({ data: { flowId: updated.id, name: updated.name, data: (updated as any).data as any, userId } })
      return updated
    }
    const created = await this.prisma.flow.create({ data: { name: input.name, data: input.data as any, ownerId: String(userId), projectId: input.projectId || undefined } })
    await this.prisma.flowVersion.create({ data: { flowId: created.id, name: created.name, data: (created as any).data as any, userId } })
    return created
  }

  remove(id: string, userId: string) {
    return this.prisma.flow.delete({ where: { id } })
  }

  versions(flowId: string, userId: string) {
    return this.prisma.flowVersion.findMany({ where: { flowId }, orderBy: { createdAt: 'desc' } })
  }

  async rollback(flowId: string, versionId: string, userId: string) {
    const v = await this.prisma.flowVersion.findFirst({ where: { id: versionId, flowId } })
    if (!v) throw new Error('version not found')
    const updated = await this.prisma.flow.update({ where: { id: flowId }, data: { name: v.name, data: v.data as any } })
    await this.prisma.flowVersion.create({ data: { flowId, name: updated.name, data: (updated as any).data as any, userId } })
    return updated
  }
}

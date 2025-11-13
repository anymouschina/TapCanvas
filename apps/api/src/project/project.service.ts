import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.project.findMany({ where: { ownerId: String(userId) }, orderBy: { updatedAt: 'desc' } })
  }

  async upsert(userId: string, input: { id?: string; name: string }) {
    if (input.id) return this.prisma.project.update({ where: { id: input.id }, data: { name: input.name } })
    return this.prisma.project.create({ data: { name: input.name, ownerId: String(userId) } })
  }
}


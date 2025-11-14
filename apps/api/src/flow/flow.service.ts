import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import { TemporalService } from '../temporal/temporal.service'

@Injectable()
export class FlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
  ) {}

  list(userId: string, projectId?: string) {
    return this.prisma.flow.findMany({ where: { ownerId: String(userId), ...(projectId ? { projectId } : {}) }, orderBy: { updatedAt: 'desc' } })
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

  async execute(flowId: string, userId: string) {
    const flow = await this.get(flowId, userId)
    if (!flow) {
      throw new Error('flow not found')
    }

    const execution = await this.prisma.flowExecution.create({
      data: {
        flowId,
        userId,
        workflowId: `flow-${flowId}-${Date.now()}`,
        status: 'PENDING',
      },
    })

    const client = this.temporal.workflowClient

    const handle = await client.start('flowExecutionWorkflow', {
      taskQueue: 'flow-task-queue',
      workflowId: execution.workflowId,
      args: [
        {
          executionId: execution.id,
          flowId,
          userId,
          data: (flow as any).data,
        },
      ],
    })

    await this.prisma.flowExecution.update({
      where: { id: execution.id },
      data: {
        runId: handle.firstExecutionRunId,
        status: 'RUNNING',
      },
    })

    return {
      executionId: execution.id,
      workflowId: execution.workflowId,
      runId: handle.firstExecutionRunId,
      flowId,
    }
  }

  async getExecution(executionId: string, userId: string) {
    const execution = await this.prisma.flowExecution.findFirst({
      where: { id: executionId, userId },
      include: { logs: { orderBy: { createdAt: 'asc' } } },
    })
    if (!execution) {
      throw new Error('execution not found')
    }
    return execution
  }
}

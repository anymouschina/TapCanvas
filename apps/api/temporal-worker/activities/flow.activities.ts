import { PrismaClient, FlowExecutionStatus } from '@prisma/client'

const prisma = new PrismaClient()

export async function executeFlowNode(params: { executionId: string; flowId: string; userId: string; data: any }): Promise<void> {
  // TODO: translate params.data (TapCanvas flow JSON) into real execution steps.
  // For now we just write a couple of log entries to demonstrate persistence.
  await prisma.flowExecutionLog.create({
    data: {
      executionId: params.executionId,
      level: 'info',
      message: 'Execution started',
    },
  })

  // Here you would loop over nodes/edges from params.data and perform real work.

  await prisma.flowExecutionLog.create({
    data: {
      executionId: params.executionId,
      level: 'info',
      message: 'Execution finished (stub)',
    },
  })
}

export async function markExecutionStatus(params: { executionId: string; status: FlowExecutionStatus }): Promise<void> {
  await prisma.flowExecution.update({
    where: { id: params.executionId },
    data: { status: params.status },
  })
}

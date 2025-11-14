import { proxyActivities } from '@temporalio/workflow'

const { executeFlowNode, markExecutionStatus } = proxyActivities<{
  executeFlowNode: (params: { executionId: string; flowId: string; userId: string; data: any }) => Promise<void>
  markExecutionStatus: (params: { executionId: string; status: 'SUCCESS' | 'ERROR' }) => Promise<void>
}>({
  startToCloseTimeout: '10 minutes',
})

export interface FlowExecutionInput {
  executionId: string
  flowId: string
  userId: string
  data: any
}

export async function flowExecutionWorkflow(input: FlowExecutionInput): Promise<void> {
  try {
    await executeFlowNode(input)
    await markExecutionStatus({ executionId: input.executionId, status: 'SUCCESS' })
  } catch (err) {
    await markExecutionStatus({ executionId: input.executionId, status: 'ERROR' })
    throw err
  }
}

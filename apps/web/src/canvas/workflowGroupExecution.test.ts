import { describe, expect, it } from 'vitest'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import {
  isAgentWorkflowGroup,
  isWorkflowGroup,
  resolveWorkflowGroupTrigger,
  validateWorkflowCapabilitySelection,
} from './workflowGroupExecution'

const workflowGroup = {
  id: 'workflow-group',
  type: 'groupNode',
  position: { x: 0, y: 0 },
  data: {
    adminWorkflow: true,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowInstanceId: 'workflow-1',
  },
}

const workflowTrigger = {
  id: 'workflow-trigger',
  type: 'taskNode',
  parentId: 'workflow-group',
  position: { x: 0, y: 0 },
  data: {
    kind: 'workflowTrigger',
    adminWorkflow: true,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowInstanceId: 'workflow-1',
  },
}

const workflowStage = {
  id: 'workflow-stage',
  type: 'taskNode',
  parentId: 'workflow-group',
  position: { x: 100, y: 0 },
  data: {
    kind: 'workflowStage',
    adminWorkflow: true,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowInstanceId: 'workflow-1',
  },
}

describe('workflow group execution', () => {
  it('routes an admin Agent workflow group to its unique trigger', () => {
    expect(isAgentWorkflowGroup(workflowGroup)).toBe(true)
    expect(resolveWorkflowGroupTrigger('workflow-group', [workflowGroup, workflowTrigger])).toBe('workflow-trigger')
  })

  it('recognizes both Agent and video workflow groups for one-click arrangement', () => {
    const videoWorkflowGroup = {
      ...workflowGroup,
      data: {
        ...workflowGroup.data,
        workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
      },
    }

    expect(isWorkflowGroup(workflowGroup)).toBe(true)
    expect(isWorkflowGroup(videoWorkflowGroup)).toBe(true)
    expect(isAgentWorkflowGroup(videoWorkflowGroup)).toBe(false)
    expect(resolveWorkflowGroupTrigger('workflow-group', [
      videoWorkflowGroup,
      {
        ...workflowTrigger,
        data: {
          ...workflowTrigger.data,
          workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
        },
      },
    ])).toBe('workflow-trigger')
  })

  it('recognizes a persisted workflow instance even when its outer group has no workflow key', () => {
    const persistedWorkflowGroup = {
      ...workflowGroup,
      data: {
        adminWorkflow: true,
        workflowInstanceId: 'persisted-workflow-instance',
      },
    }

    expect(isWorkflowGroup(persistedWorkflowGroup)).toBe(true)
    expect(isAgentWorkflowGroup(persistedWorkflowGroup)).toBe(false)
  })

  it('leaves an ordinary canvas group on the generic DAG path', () => {
    const ordinaryGroup = { ...workflowGroup, data: { label: '普通素材组' } }
    expect(resolveWorkflowGroupTrigger('workflow-group', [ordinaryGroup, workflowTrigger])).toBeNull()
  })

  it('fails explicitly when a workflow group has no unique trigger', () => {
    expect(() => resolveWorkflowGroupTrigger('workflow-group', [workflowGroup])).toThrow(/唯一触发器/u)
    expect(() => resolveWorkflowGroupTrigger('workflow-group', [
      workflowGroup,
      workflowTrigger,
      { ...workflowTrigger, id: 'workflow-trigger-2' },
    ])).toThrow(/当前为 2 个/u)
  })

  it('accepts a selected group that fully represents a saved Flow capability', () => {
    expect(validateWorkflowCapabilitySelection('workflow-group', [
      workflowGroup,
      workflowTrigger,
      workflowStage,
      { id: 'note', type: 'taskNode', data: { kind: 'text' } },
    ])).toEqual({ eligible: true, triggerNodeId: 'workflow-trigger' })
  })

  it('uses the persisted trigger/stage structure even when the outer group predates the Agent workflow marker', () => {
    const legacyOuterGroup = {
      ...workflowGroup,
      data: { label: '一键成片 · 原子工作流' },
    }
    expect(validateWorkflowCapabilitySelection('workflow-group', [
      legacyOuterGroup,
      workflowTrigger,
      workflowStage,
    ])).toEqual({ eligible: true, triggerNodeId: 'workflow-trigger' })
  })

  it('rejects a selected group when workflow nodes elsewhere would silently join the capability', () => {
    expect(validateWorkflowCapabilitySelection('workflow-group', [
      workflowGroup,
      workflowTrigger,
      workflowStage,
      {
        ...workflowStage,
        id: 'outside-stage',
        parentId: undefined,
      },
    ])).toEqual({
      eligible: false,
      reason: '画布中还有不属于当前组的工作流节点；Agent 配置会添加整张已保存工作流，请先拆成独立工作流',
    })
  })

  it('rejects an empty workflow before opening the capability bay', () => {
    expect(validateWorkflowCapabilitySelection('workflow-group', [workflowGroup, workflowTrigger])).toEqual({
      eligible: false,
      reason: '空工作流不能添加到 Agent 配置',
    })
  })
})

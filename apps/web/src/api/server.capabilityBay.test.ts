import { describe, expect, it } from 'vitest'

import { WorkflowCapabilityDescriptorDtoSchema } from './server'

const descriptor = {
  protocolVersion: 'tapcanvas.agent-capability/v1' as const,
  capabilityId: 'workflow:film-production',
  kind: 'workflow' as const,
  name: '一键成片',
  summary: '根据当前项目上下文执行完整视频工作流',
  sourceId: 'flow-1',
  sourceVersionId: 'flow-version-1',
  sourceRevision: 1,
  projectId: 'project-1',
  triggerNodeId: 'trigger-1',
  nodeCount: 5,
  operations: ['execute'],
  requiredSkills: [],
  requiredTools: [],
  inputArtifacts: [],
  outputArtifacts: ['video'],
  permissions: [],
  sideEffects: ['paid_generation'] as const,
  semanticEvidence: [],
}

describe('WorkflowCapabilityDescriptorDtoSchema', () => {
  it('accepts trigger fields derived from unpinned video and image generation nodes', () => {
    const parsed = WorkflowCapabilityDescriptorDtoSchema.parse({
      ...descriptor,
      invocation: {
        sourceMode: 'project_context',
        requiredTriggerPayloadFields: [
          'videoModelKey',
          'imageModelKey',
          'aspectRatio',
          'imageSize',
        ],
      },
    })

    expect(parsed.invocation?.requiredTriggerPayloadFields).toEqual([
      'videoModelKey',
      'imageModelKey',
      'aspectRatio',
      'imageSize',
    ])
  })

  it('accepts the structured video execution variant exposed by workflow descriptors', () => {
    const parsed = WorkflowCapabilityDescriptorDtoSchema.parse({
      ...descriptor,
      invocation: {
        sourceMode: 'project_context',
        requiredTriggerPayloadFields: [],
        executionVariant: 'full_video',
      },
    })

    expect(parsed.invocation?.executionVariant).toBe('full_video')
  })

  it('rejects blank trigger field names instead of silently dropping contract facts', () => {
    expect(() => WorkflowCapabilityDescriptorDtoSchema.parse({
      ...descriptor,
      invocation: {
        sourceMode: 'inline_text',
        requiredTriggerPayloadFields: ['source', '   '],
      },
    })).toThrow()
  })
})

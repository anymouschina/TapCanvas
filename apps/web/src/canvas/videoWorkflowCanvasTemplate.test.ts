import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { Node } from '@xyflow/react'
import { useRFStore } from './store'
import {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
  VIDEO_WORKFLOW_EXECUTION_CONCURRENCY,
  VIDEO_ATOMIC_WORKFLOW_NODES,
  VIDEO_ATOMIC_WORKFLOW_EDGES,
  VIDEO_FIRST_VIDEO_WORKFLOW_NODES,
  VIDEO_FIRST_VIDEO_WORKFLOW_EDGES,
  bindVideoWorkflowSourceGroup,
  buildVideoWorkflowCanvasDefinitionPatch,
  createVideoWorkflowCanvasTemplate,
  needsVideoWorkflowCanvasDefinitionUpgrade,
  restoreVideoWorkflowDefaultConnections,
  upgradeVideoWorkflowCanvasDefinition,
} from './videoWorkflowCanvasTemplate'

function canonicalDefinitionFingerprint(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (!candidate || typeof candidate !== 'object') {
      return typeof candidate === 'string'
        ? candidate
            .replaceAll('workflow-contract-fixture', '<workflow-instance>')
            .replaceAll('workflow-contract-group', '<workflow-group>')
        : candidate
    }
    const record = candidate as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().flatMap((key) => (
      key === 'workflowCanvasDefinitionFingerprint'
        ? []
        : [[key, normalize(record[key])] as const]
    )))
  }
  return `sha256:${createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')}`
}

const sourceGroup: Node = {
  id: 'source-group',
  type: 'groupNode',
  position: { x: 100, y: 200 },
  selected: true,
  style: { width: 500, height: 360 },
  data: { label: '来源素材' },
}

describe('one-click film workflow canvas template', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'workflow-test-id' })
    useRFStore.getState().reset()
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
  })

  it('creates one admin trigger plus the atomic one-click film operations', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const state = useRFStore.getState()
    const workflowNodes = state.nodes.filter((node) => {
      const data = node.data as Record<string, unknown>
      return data.workflowInstanceId === result.workflowInstanceId && node.type === 'taskNode'
    })

    expect(result.nodeIds).toHaveLength(VIDEO_ATOMIC_WORKFLOW_NODES.length + 1)
    expect(VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION).toBe(71)
    expect(workflowNodes).toHaveLength(VIDEO_ATOMIC_WORKFLOW_NODES.length + 1)
		expect(workflowNodes.every((node) => (
			(node.data as Record<string, unknown>).workflowCanvasDefinitionVersion === VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION
		))).toBe(true)
		expect(workflowNodes.every((node) => (
			(node.data as Record<string, unknown>).workflowCanvasDefinitionFingerprint === VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT
		))).toBe(true)
		expect(workflowNodes.filter((node) => (
			(node.data as Record<string, unknown>).kind === 'workflowTrigger'
		)).every((node) => (
			(node.data as Record<string, unknown>).workflowExecutionRecoveryPolicy === 'fresh_only'
		))).toBe(true)
    expect(workflowNodes.map((node) => (node.data as Record<string, unknown>).kind)).toEqual([
      'workflowTrigger',
      ...VIDEO_ATOMIC_WORKFLOW_NODES.map(() => 'workflowStage'),
    ])
    expect(workflowNodes.every((node) => (node.data as Record<string, unknown>).adminWorkflow === true)).toBe(true)
		const runtimeNodeData = (nodeId: string): Record<string, unknown> => {
			const node = workflowNodes.find((candidate) => candidate.id.endsWith(`:${nodeId}`))
			if (!node) throw new Error(`Missing workflow node ${nodeId}`)
			return node.data as Record<string, unknown>
		}
		expect(runtimeNodeData('voice-materialize').workflowAtomicSpec).toMatchObject({
			executorRef: 'video.voice-manifest.empty/v1',
			inputPorts: ['trigger'],
		})
		expect(runtimeNodeData('production-handoff')).toMatchObject({ workflowReferenceAudioPolicy: 'optional' })
		expect(runtimeNodeData('beat-sheet-format')).toMatchObject({
			label: 'Clip 上限',
			workflowBeatSheetTakeCount: 24,
			workflowAtomicSpec: {
				operation: 'max_clip',
				executorRef: 'video.beat-sheet.take/v1',
				executionMode: 'once',
				inputPorts: ['beat-sheet'],
				outputPorts: ['beat-sheet'],
			},
		})
		const beatSheetData = runtimeNodeData('beat-sheet-agent')
		const beatSheetInstruction = String(beatSheetData.workflowInstruction ?? '')
		expect(beatSheetInstruction).toContain('只把它及其自动加载 references 作为章级改编方法真源')
		expect(beatSheetInstruction).not.toContain('进入状态→触发→选择/起势')
		expect(beatSheetData.workflowAgentJsonObjectContract).toMatchObject({
			arrayItemAllowedFields: {
				beats: expect.not.arrayContaining(['dialogueScript']),
			},
		})
		const clipWriterData = runtimeNodeData('clip-writer-agent')
		const clipWriterInstruction = String(clipWriterData.workflowInstruction ?? '')
		expect(clipWriterInstruction).toContain('只把它们作为单 Clip 创作方法真源')
		expect(clipWriterInstruction).toContain('宿主只编译机器身份')
		expect(clipWriterInstruction).toContain('SpeechEvent 与时长参数必须由 writer 一次写对')
		expect(clipWriterInstruction).toContain('runtime 不会把校验错误返回给 writer')
		expect(clipWriterInstruction).not.toContain('shots 只用 speechEventIds')
		expect(String(runtimeNodeData('prompt-package').workflowDeliveryRequirement ?? ''))
			.not.toContain('每个 shot 必须有非空 visualTask 与 action')
		expect(runtimeNodeData('asset-fan-out')).toMatchObject({
			workflowOutputArtifactType: 'tapcanvas.asset-plan-items/v2',
			workflowAtomicSpec: {
				outputArtifactTypes: { 'asset-items': ['tapcanvas.asset-plan-items/v2'] },
			},
		})
		expect(runtimeNodeData('asset-image-generate')).toMatchObject({
			workflowAtomicSpec: {
				inputArtifactTypes: { 'asset-items': ['tapcanvas.asset-plan-items/v2'] },
			},
		})
    expect(state.edges).toHaveLength(VIDEO_ATOMIC_WORKFLOW_EDGES.length)
    expect(state.edges[0]).toMatchObject({
      source: expect.stringContaining('manual-trigger'),
      target: expect.stringContaining('canvas-source'),
      sourceHandle: 'out-workflow:trigger',
      targetHandle: 'in-workflow:trigger',
    })
    const fanOutInputs = state.edges
      .filter((edge) => edge.target.endsWith(':clip-fan-out'))
      .map((edge) => edge.targetHandle)
      .sort()
    expect(fanOutInputs).toEqual([
      'in-workflow:beat-sheet',
      'in-workflow:delivery-contract',
    ])
    const promptPackageInputs = state.edges
      .filter((edge) => edge.target.endsWith(':prompt-package'))
      .map((edge) => edge.targetHandle)
      .sort()
    expect(promptPackageInputs).toEqual([
      'in-workflow:asset-items',
      'in-workflow:clip-contexts',
      'in-workflow:clip-prompts',
    ])
  })

  it('pins the complete executable template to one shared definition fingerprint', () => {
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId: 'workflow-contract-fixture',
      workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery',
      executionVariant: 'full_video',
      existingEdges: [],
    })

    expect(canonicalDefinitionFingerprint(patch)).toBe(VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT)
  })

  it('requires an upgrade when either the structural version or fingerprint differs', () => {
    expect(needsVideoWorkflowCanvasDefinitionUpgrade({
      workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
      workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
    })).toBe(false)
    expect(needsVideoWorkflowCanvasDefinitionUpgrade({
      workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
      workflowCanvasDefinitionFingerprint: 'sha256:stale-contract',
    })).toBe(true)
    expect(needsVideoWorkflowCanvasDefinitionUpgrade({
      workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION - 1,
      workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
    })).toBe(true)
  })

  it('starts first-video production from an immutable launch prefix with identity assets', () => {
    const result = createVideoWorkflowCanvasTemplate({
      executionScope: 'media_delivery',
      executionVariant: 'first_video',
    })
    const state = useRFStore.getState()
    const workflowNodes = state.nodes.filter((node) => (
      (node.data as Record<string, unknown>).workflowInstanceId === result.workflowInstanceId
      && node.type === 'taskNode'
    ))

    expect(result.nodeIds).toHaveLength(VIDEO_FIRST_VIDEO_WORKFLOW_NODES.length + 1)
    expect(workflowNodes).toHaveLength(VIDEO_FIRST_VIDEO_WORKFLOW_NODES.length + 1)
    expect(state.edges).toHaveLength(VIDEO_FIRST_VIDEO_WORKFLOW_EDGES.length)
    expect(workflowNodes.some((node) => node.id.endsWith(':concat'))).toBe(false)
    expect(workflowNodes.some((node) => node.id.endsWith(':delivery-verify'))).toBe(true)
    expect(workflowNodes.some((node) => node.id.endsWith(':first-video-output'))).toBe(false)
    expect(workflowNodes.some((node) => node.id.endsWith(':beat-sheet-agent'))).toBe(false)
    expect(workflowNodes.some((node) => node.id.endsWith(':launch-beat-agent'))).toBe(true)
    expect(workflowNodes.some((node) => node.id.endsWith(':launch-empty-asset-bindings'))).toBe(false)
    expect(workflowNodes.some((node) => node.id.endsWith(':launch-asset-image-generate'))).toBe(true)

    const firstBeat = workflowNodes.find((node) => node.id.endsWith(':launch-beat-take'))
    expect(firstBeat?.data).toMatchObject({
      workflowExecutionVariant: 'first_video',
      workflowBeatSheetTakeCount: 1,
      workflowAtomicSpec: {
        executorRef: 'video.beat-sheet.take/v1',
        inputPorts: ['beat-sheet'],
        outputPorts: ['beat-sheet'],
      },
    })
    expect(state.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: expect.stringContaining(':launch-beat-agent'),
        target: expect.stringContaining(':launch-beat-take'),
      }),
      expect.objectContaining({
        source: expect.stringContaining(':launch-beat-take'),
        target: expect.stringContaining(':launch-clip-fan-out'),
      }),
      expect.objectContaining({
        source: expect.stringContaining(':launch-asset-image-generate'),
        target: expect.stringContaining(':launch-production-handoff'),
      }),
      expect.objectContaining({
        source: expect.stringContaining(':launch-asset-fan-out'),
        target: expect.stringContaining(':launch-asset-image-generate'),
      }),
      expect.objectContaining({
        source: expect.stringContaining(':launch-video-results'),
        target: expect.stringContaining(':delivery-verify'),
        sourceHandle: 'out-workflow:video-assets',
        targetHandle: 'in-workflow:video-assets',
      }),
    ]))
    const deliveryVerify = workflowNodes.find((node) => node.id.endsWith(':delivery-verify'))
    expect(deliveryVerify?.data).toMatchObject({
      workflowDeliveryArtifactType: 'tapcanvas.video/v1',
      workflowOutputArtifactType: 'tapcanvas.delivery-evidence/v2',
      workflowAtomicSpec: {
        executorRef: 'agents.delivery.verify/v2',
        inputPorts: ['video-assets'],
        outputPorts: ['delivery-evidence'],
      },
    })
    expect(state.edges.some((edge) => (
      edge.source.endsWith(':production-handoff')
      && edge.target.endsWith(':first-video-take')
    ))).toBe(false)
  })

  it('fans the formal full-video production out directly without a serial first-clip branch', () => {
    createVideoWorkflowCanvasTemplate({
      executionScope: 'media_delivery',
      executionVariant: 'full_video',
    })
    const state = useRFStore.getState()
		expect(state.nodes.some((node) => node.id.includes(':launch-'))).toBe(false)
		expect(state.nodes.some((node) => node.id.endsWith(':remainder-production-plan'))).toBe(false)
		expect(state.nodes.some((node) => node.id.endsWith(':all-video-results'))).toBe(false)
    expect(state.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: expect.stringContaining(':asset-image-generate'),
        target: expect.stringContaining(':production-handoff'),
      }),
      expect.objectContaining({
        source: expect.stringContaining(':production-handoff'),
			target: expect.stringContaining(':video-submit'),
      }),
      expect.objectContaining({
			source: expect.stringContaining(':video-results'),
        target: expect.stringContaining(':concat'),
      }),
      expect.objectContaining({
			source: expect.stringContaining(':clip-fan-out'),
			target: expect.stringContaining(':clip-writer-agent'),
			targetHandle: 'in-workflow:clip-contexts',
      }),
    ]))
  })

  it('hard-cuts a polluted persisted workflow back to the current generic definition', () => {
    const workflowInstanceId = 'video-workflow-existing'
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId,
      workflowGroupId: 'workflow-group',
      executionScope: 'media_delivery',
      existingNodes: [
        { id: `${workflowInstanceId}:manual-trigger`, parentId: 'workflow-group' },
        { id: `${workflowInstanceId}:voice-plan-agent`, parentId: 'workflow-group' },
        { id: `${workflowInstanceId}:voice-catalog`, parentId: 'workflow-group' },
        { id: 'other-workflow:voice-plan-agent', parentId: 'other-group' },
      ],
      existingEdges: [{
        id: 'polluted-trigger-edge',
        source: `${workflowInstanceId}:manual-trigger`,
        target: `${workflowInstanceId}:beat-sheet-agent`,
        sourceHandle: 'out-workflow:trigger',
        targetHandle: 'in-workflow:trigger',
      }],
    })

    const beatSheetPatch = patch.patchNodeData.find((entry) => entry.id.endsWith(':beat-sheet-agent'))
    const assetPatch = patch.patchNodeData.find((entry) => entry.id.endsWith(':asset-coverage'))
    const writerPatch = patch.patchNodeData.find((entry) => entry.id.endsWith(':clip-writer-agent'))
    const triggerPatch = patch.patchNodeData.find((entry) => entry.id.endsWith(':manual-trigger'))
    expect(beatSheetPatch?.data).toMatchObject({
      label: 'BeatSheet 创作 Agent',
      workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
      workflowNodeKind: 'beat_sheet_authoring',
      workflowAtomicSpec: {
        category: 'agent',
        executorRef: 'agents.logical-task/v2',
		inputPorts: ['trigger', 'delivery-contract'],
      },
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentDefinitionId: 'writer',
      workflowAgentOutputArtifactType: 'tapcanvas.beat-sheet/v2',
    })
    expect(beatSheetPatch?.data.workflowAgentJsonObjectContract).toMatchObject({
      arrayItemRequiredStringArrayFields: { objectRegistry: ['referenceImageNodeIds'] },
    })
    expect(String(assetPatch?.data.workflowInstruction)).not.toContain('阿乔')
    expect(String(writerPatch?.data.workflowInstruction)).not.toContain('clip-001')
    expect(triggerPatch?.data.workflowTriggerPayload).toBeNull()
    expect(triggerPatch?.data.workflowExecutionConcurrency).toBe(VIDEO_WORKFLOW_EXECUTION_CONCURRENCY)
		expect(patch.patchNodeData.some((entry) => entry.id.includes(':launch-'))).toBe(false)
    expect(patch.deleteNodeIds).toEqual([
      `${workflowInstanceId}:voice-plan-agent`,
      `${workflowInstanceId}:voice-catalog`,
    ])
    expect(patch.deleteEdgeIds).toEqual([])
    expect(patch.createEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: `${workflowInstanceId}:delivery-contract`,
        target: `${workflowInstanceId}:beat-sheet-agent`,
        sourceHandle: 'out-workflow:delivery-contract',
        targetHandle: 'in-workflow:delivery-contract',
      }),
      expect.objectContaining({
        source: `${workflowInstanceId}:prompt-package`,
        target: `${workflowInstanceId}:concat`,
      }),
    ]))
  })

  it('projects the complete output identity contract for every logical Agent node', () => {
    createVideoWorkflowCanvasTemplate()
    const logicalAgentNodes = useRFStore.getState().nodes.filter((node) => {
      const atomicSpec = node.data.workflowAtomicSpec
      return atomicSpec
        && typeof atomicSpec === 'object'
        && !Array.isArray(atomicSpec)
        && (atomicSpec as Record<string, unknown>).executorRef === 'agents.logical-task/v2'
    })

		expect(logicalAgentNodes).toHaveLength(2)
    for (const node of logicalAgentNodes) {
      expect(node.data.workflowAgentDefinitionId).toEqual(expect.any(String))
      expect(node.data.workflowInstruction).toEqual(expect.any(String))
      expect(node.data.workflowAgentOutputArtifactType).toEqual(expect.any(String))
      expect(node.data.workflowAgentOutputEncoding).toMatch(/^json_(?:object|array)$/)
      expect(node.data.workflowAgentDeliveryRequirement).toEqual(expect.any(String))
    }
  })

  it('upgrades an existing workflow in place while preserving explicit model selections', () => {
    const result = createVideoWorkflowCanvasTemplate({ executionScope: 'media_delivery' })
    const beatSheetNodeId = `${result.workflowInstanceId}:beat-sheet-agent`
    const videoNodeId = `${result.workflowInstanceId}:video-submit`
    const maxClipNodeId = `${result.workflowInstanceId}:beat-sheet-format`
    useRFStore.getState().updateNodeData(beatSheetNodeId, {
      workflowCanvasDefinitionVersion: 1,
      workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
      workflowPreparedBeatSheetJsonObjectContract: { requiredObjectFields: ['filmBible'] },
    })
    const assetCoverageNodeId = `${result.workflowInstanceId}:asset-coverage`
    useRFStore.getState().updateNodeData(assetCoverageNodeId, {
      workflowRequiredSkills: [],
      workflowAllowedTools: ['skill_search', 'knowledge_search', 'knowledge_read'],
      workflowKnowledgeQuery: 'stale query',
    })
    useRFStore.getState().updateNodeData(videoNodeId, {
      workflowVideoModelKey: 'doubao-seedance-2.0',
      workflowVideoResolution: '480p',
    })
    useRFStore.getState().updateNodeData(maxClipNodeId, {
      workflowBeatSheetTakeCount: 7,
    })

    const upgraded = upgradeVideoWorkflowCanvasDefinition(result.workflowInstanceId)
    const state = useRFStore.getState()
    const beatSheet = state.nodes.find((node) => node.id === beatSheetNodeId)
    const assetCoverage = state.nodes.find((node) => node.id === assetCoverageNodeId)
    const videoNode = state.nodes.find((node) => node.id === videoNodeId)
    const maxClipNode = state.nodes.find((node) => node.id === maxClipNodeId)

    expect(upgraded.upgradedNodeCount).toBe(VIDEO_ATOMIC_WORKFLOW_NODES.length + 2)
    expect(beatSheet?.data).toMatchObject({
      workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
      workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
    })
    expect(beatSheet?.data.workflowPreparedBeatSheetJsonObjectContract).toBeUndefined()
    expect(assetCoverage?.data).toMatchObject({
      workflowInputPorts: ['beat-sheet'],
      workflowOptionalInputPorts: [],
		workflowAtomicSpec: { executorRef: 'video.asset-plans.project/v1' },
    })
		expect(assetCoverage?.data.workflowRequiredSkills).toBeUndefined()
    expect(assetCoverage?.data.workflowAllowedTools).toBeUndefined()
    expect(assetCoverage?.data.workflowKnowledgeQuery).toBeUndefined()
    expect(videoNode?.data).toMatchObject({
      workflowVideoModelKey: 'doubao-seedance-2.0',
      workflowVideoResolution: '480p',
    })
    expect(maxClipNode?.data).toMatchObject({
      workflowBeatSheetTakeCount: 7,
      workflowAtomicSpec: {
        operation: 'max_clip',
        executorRef: 'video.beat-sheet.take/v1',
      },
    })
  })

	it('migrates a persisted first-video topology by creating new stages and removing retired stages', () => {
		const result = createVideoWorkflowCanvasTemplate({
			executionScope: 'media_delivery',
			executionVariant: 'first_video',
		})
		const firstBeatNodeId = `${result.workflowInstanceId}:launch-beat-take`
		const retiredTakeNodeId = `${result.workflowInstanceId}:first-video-take`
		useRFStore.getState().onNodesChange([{ id: firstBeatNodeId, type: 'remove' }])
		useRFStore.getState().addNode('taskNode', '旧首视频截取', {
			nodeId: retiredTakeNodeId,
			autoLabel: false,
			parentId: result.workflowGroupId,
			position: { x: 8, y: 8 },
			kind: 'workflowStage',
			workflowInstanceId: result.workflowInstanceId,
			workflowCanvasDefinitionVersion: 42,
			workflowAtomicSpec: {
				version: 1,
				category: 'control',
				operation: 'collection_take',
				executorRef: 'workflow.collection.take/v1',
				executionMode: 'once',
				inputPorts: ['items'],
				outputPorts: ['production-plan'],
			},
		})
		useRFStore.getState().onConnect({
			source: `${result.workflowInstanceId}:production-handoff`,
			target: retiredTakeNodeId,
			sourceHandle: 'out-workflow:production-plan',
			targetHandle: 'in-workflow:items',
		})
		useRFStore.getState().onConnect({
			source: retiredTakeNodeId,
			target: `${result.workflowInstanceId}:video-submit`,
			sourceHandle: 'out-workflow:production-plan',
			targetHandle: 'in-workflow:production-plan',
		})

		upgradeVideoWorkflowCanvasDefinition(result.workflowInstanceId)

		const state = useRFStore.getState()
		expect(state.nodes.some((node) => node.id === firstBeatNodeId)).toBe(true)
		expect(state.nodes.some((node) => node.id === retiredTakeNodeId)).toBe(false)
		expect(state.edges).toEqual(expect.arrayContaining([
			expect.objectContaining({
				source: `${result.workflowInstanceId}:launch-beat-agent`,
				target: firstBeatNodeId,
			}),
			expect.objectContaining({
				source: firstBeatNodeId,
				target: `${result.workflowInstanceId}:launch-clip-fan-out`,
			}),
		]))
		expect(state.edges.some((edge) => edge.source === retiredTakeNodeId || edge.target === retiredTakeNodeId)).toBe(false)
	})

  it('uses one direct JSON object contract for every clip prompt', () => {
    createVideoWorkflowCanvasTemplate()
    const clipWriter = useRFStore.getState().nodes.find((node) => {
      const data = node.data as Record<string, unknown>
      return data.workflowNodeId === 'clip-writer-agent'
    })

    expect(clipWriter?.data).toMatchObject({
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        requiredArrayFields: ['clips'],
        allowedFields: ['clips', 'selfQaNote', 'creativeReview', 'sourceFidelityAudit'],
      },
    })
		expect(String(clipWriter?.data.workflowInstruction)).toContain('tapcanvas-video-prompt-writer')
		expect(String(clipWriter?.data.workflowInstruction)).toContain('只把它们作为单 Clip 创作方法真源')
		expect(String(clipWriter?.data.workflowInstruction)).toContain('当前节点指令只声明职责与传输协议')
		expect(String(clipWriter?.data.workflowInstruction)).toContain('宿主只编译机器身份')
		expect(String(clipWriter?.data.workflowInstruction)).toContain('SpeechEvent 与时长参数必须由 writer 一次写对')
		expect(String(clipWriter?.data.workflowInstruction)).toContain('runtime 不会把校验错误返回给 writer')
		expect(String(clipWriter?.data.workflowInstruction)).not.toContain('每个 shot 必须有非空 visualTask 与 action')
		expect(clipWriter?.data.workflowAgentMaxOutputTokens).toBe(4096)
  })

  it('persists bounded parallelism and exact asset-consumer contracts on executable nodes', () => {
    createVideoWorkflowCanvasTemplate()
    const workflowNodes = useRFStore.getState().nodes
    const data = (workflowNodeId: string): Record<string, unknown> => {
      const node = workflowNodes.find((candidate) => candidate.data.workflowNodeId === workflowNodeId)
      if (!node) throw new Error(`Missing workflow node ${workflowNodeId}`)
      return node.data as Record<string, unknown>
    }
    const concurrency = (workflowNodeId: string): number | undefined => {
      const spec = data(workflowNodeId).workflowAtomicSpec
      return spec && typeof spec === 'object' && !Array.isArray(spec)
        ? (spec as Record<string, unknown>).itemConcurrency as number | undefined
        : undefined
    }

    expect(concurrency('asset-image-generate')).toBe(16)
    expect(concurrency('clip-writer-agent')).toBe(16)
    expect(concurrency('video-submit')).toBe(16)
		expect(data('video-submit').workflowVideoReferencePolicy).toBe('forbidden')
		for (const node of workflowNodes) {
			const spec = node.data.workflowAtomicSpec
			if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue
			const itemConcurrency = (spec as Record<string, unknown>).itemConcurrency
			if (itemConcurrency === undefined) continue
			expect(Number.isInteger(itemConcurrency)).toBe(true)
			expect(itemConcurrency).toBeGreaterThanOrEqual(1)
			expect(itemConcurrency).toBeLessThanOrEqual(16)
		}
  expect(data('beat-sheet-agent').workflowAgentMaxOutputTokens).toBe(8192)
		expect(data('beat-sheet-agent').workflowAgentReasoningEffort).toBeUndefined()
		expect(data('asset-coverage').workflowAgentMaxOutputTokens).toBeUndefined()
    expect(data('clip-writer-agent').workflowAgentJsonObjectContract).toEqual(expect.not.objectContaining({
      itemExactAssetIds: expect.anything(),
    }))
		expect(data('asset-coverage').workflowAgentJsonArrayContract).toBeUndefined()
		expect(data('asset-coverage').workflowAtomicSpec).toMatchObject({
			executorRef: 'video.asset-plans.project/v1',
			inputPorts: ['beat-sheet'],
			outputPorts: ['asset-plans'],
		})
		expect(data('asset-coverage').workflowInputPorts).toEqual(['beat-sheet'])
		expect(data('asset-fan-out').workflowInputPorts).toEqual(['asset-plans', 'beat-sheet'])
		expect(String(data('beat-sheet-agent').workflowInstruction)).toContain('canvasFacts.authoritativeSources；后者是唯一故事事实源')
		expect(String(data('beat-sheet-agent').workflowInstruction)).toContain('只把它及其自动加载 references 作为章级改编方法真源')
		expect(String(data('beat-sheet-agent').workflowInstruction)).toContain('规划完整章级 BeatSheet')
		expect(String(data('beat-sheet-agent').workflowInstruction)).not.toContain('进入状态→触发→选择/起势')
		expect(String(data('beat-sheet-agent').workflowInstruction)).toContain('sourceFidelityAudit 可省略')
		expect(String(data('beat-sheet-agent').workflowInstruction)).toContain('只作为模型自检诊断')
		expect(String(data('beat-sheet-agent').workflowInstruction)).toContain('宿主不会生成或修订它')
    expect(data('delivery-contract').workflowTargetDurationSeconds).toBeUndefined()
    expect(data('beat-sheet-agent').workflowAgentJsonObjectContract).toMatchObject({
	      requiredObjectFields: ['sourceCoveragePlan', 'chapterArc'],
      allowedFields: expect.arrayContaining(['sourceCoveragePlan', 'sourceFidelityAudit', 'chapterArc']),
		arrayItemRequiredStringFields: {
			assetPlans: ['role', 'prompt', 'negativePrompt'],
			beats: expect.arrayContaining(['dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext']),
			objectRegistry: expect.any(Array),
		},
    })
		expect(data('beat-sheet-agent').workflowAgentJsonObjectContract)
			.not.toHaveProperty('arrayItemMergeKeyFields')
    expect(data('beat-sheet-format').workflowAtomicSpec).toMatchObject({
      operation: 'max_clip',
      executorRef: 'video.beat-sheet.take/v1',
      inputPorts: ['beat-sheet'],
      outputPorts: ['beat-sheet'],
    })
    expect(data('beat-sheet-format').workflowBeatSheetTakeCount).toBe(24)
  })

  it('keeps full Skill and knowledge discovery implicit while preserving media example prefetch', () => {
    createVideoWorkflowCanvasTemplate()
    const workflowNodes = useRFStore.getState().nodes
    const agent = (workflowNodeId: string): Record<string, unknown> => {
      const node = workflowNodes.find((candidate) => candidate.data.workflowNodeId === workflowNodeId)
      if (!node) throw new Error(`Missing workflow node ${workflowNodeId}`)
      return node.data as Record<string, unknown>
    }

    expect(agent('beat-sheet-agent')).toMatchObject({
      workflowOptionalInputPorts: [],
      workflowAtomicSpec: {
        category: 'agent',
        executorRef: 'agents.logical-task/v2',
      },
    })
    expect(agent('beat-sheet-agent').workflowAgentOutputEncoding).toBe('json_object')
    expect(agent('beat-sheet-agent').workflowRequiredSkills).toEqual(['tapcanvas-dramatic-adapter'])
    expect(agent('beat-sheet-agent').workflowAllowedTools).toBeUndefined()
    expect(agent('beat-sheet-agent').workflowAgentJsonObjectContract).toMatchObject({
	      requiredObjectFields: ['sourceCoveragePlan', 'chapterArc'],
      allowedFields: expect.arrayContaining(['sourceCoveragePlan', 'sourceFidelityAudit', 'chapterArc']),
    })
    expect(agent('beat-sheet-format').workflowAgentOutputEncoding).toBeUndefined()
    expect(agent('asset-coverage')).toMatchObject({
      workflowOptionalInputPorts: [],
		workflowAtomicSpec: { executorRef: 'video.asset-plans.project/v1' },
    })
		expect(agent('asset-coverage').workflowRequiredSkills).toBeUndefined()
    expect(agent('asset-coverage').workflowAllowedTools).toBeUndefined()
    expect(agent('clip-writer-agent')).toMatchObject({
      workflowOptionalInputPorts: ['skills', 'tools', 'knowledge-candidates', 'knowledge-evidence'],
      workflowPromptExampleMediaType: 'video',
      workflowAgentJsonObjectContract: {
        requiredArrayFields: ['clips'],
        allowedFields: ['clips', 'selfQaNote', 'creativeReview', 'sourceFidelityAudit'],
      },
    })
    expect(agent('clip-writer-agent').workflowRequiredSkills).toEqual(['tapcanvas-video-prompt-writer'])
    expect(agent('clip-writer-agent').workflowAllowedTools).toBeUndefined()
		expect(String(agent('clip-writer-agent').workflowInstruction)).toContain('只把它们作为单 Clip 创作方法真源')
		expect(String(agent('clip-writer-agent').workflowInstruction)).toContain('宿主只编译机器身份')
		expect(String(agent('clip-writer-agent').workflowInstruction)).toContain('runtime 不会把校验错误返回给 writer')
		expect(String(agent('clip-writer-agent').workflowInstruction)).not.toContain('shots 只用 speechEventIds')
    expect(String(agent('prompt-package').workflowDeliveryRequirement)).toContain('纯执行提示词')
		expect(String(agent('beat-sheet-agent').workflowInstruction)).toContain('一次性规划完整章级 BeatSheet')
		expect(String(agent('beat-sheet-agent').workflowInstruction)).not.toContain('不可改写的生产前缀')
    expect(agent('beat-sheet-agent').workflowAgentRole).toBeUndefined()
    expect(agent('beat-sheet-agent').workflowAgentOutputEncoding).toBe('json_object')
  })

  it('rejects a second workflow projection for the same source group', () => {
    createVideoWorkflowCanvasTemplate()
    useRFStore.setState((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, selected: node.id === 'source-group' })),
    }))

    expect(() => createVideoWorkflowCanvasTemplate()).toThrow(
      '该来源组已经绑定其他一键成片工作流',
    )
  })

  it('creates an unbound template without requiring a selected source group', () => {
    useRFStore.getState().reset()

    const result = createVideoWorkflowCanvasTemplate()

    expect(result.sourceGroupId).toBeNull()
    const sourceNode = useRFStore.getState().nodes.find((node) => {
      const data = node.data as Record<string, unknown>
      return data.workflowNodeId === 'canvas-source'
    })
    expect(sourceNode?.data).toMatchObject({
			sourceBindingStatus: 'unbound',
			workflowSourceMode: 'project_context',
		})
  })

  it('binds the source from the explicit canvas-source configuration', () => {
    useRFStore.getState().reset()
    const result = createVideoWorkflowCanvasTemplate()
    useRFStore.setState((state) => ({ nodes: [...state.nodes, { ...sourceGroup, selected: false }] }))

    bindVideoWorkflowSourceGroup(result.workflowInstanceId, sourceGroup.id)

    const workflowNodes = useRFStore.getState().nodes.filter((node) => {
      const data = node.data as Record<string, unknown>
      return data.workflowInstanceId === result.workflowInstanceId
    })
    expect(workflowNodes.every((node) => (node.data as Record<string, unknown>).sourceGroupId === sourceGroup.id)).toBe(true)
  })

  it('repairs only missing default port connections and leaves existing edges intact', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const originalEdges = useRFStore.getState().edges
    const removed = originalEdges[0]
    if (!removed) throw new Error('test template did not create edges')
    useRFStore.setState({ edges: originalEdges.slice(1) })

    expect(restoreVideoWorkflowDefaultConnections(result.workflowInstanceId)).toBe(1)
    expect(useRFStore.getState().edges).toHaveLength(VIDEO_ATOMIC_WORKFLOW_EDGES.length)
    expect(restoreVideoWorkflowDefaultConnections(result.workflowInstanceId)).toBe(0)
  })
})

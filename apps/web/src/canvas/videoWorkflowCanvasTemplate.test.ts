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
  VIDEO_PROMPT_ONLY_WORKFLOW_NODES,
  VIDEO_PROMPT_ONLY_WORKFLOW_EDGES,
  bindVideoWorkflowSourceGroup,
  buildVideoWorkflowCanvasDefinitionPatch,
  createVideoWorkflowCanvasTemplate,
  restoreVideoWorkflowDefaultConnections,
} from './videoWorkflowCanvasTemplate'

function canonicalDefinitionFingerprint(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (!candidate || typeof candidate !== 'object') {
      return typeof candidate === 'string'
        ? candidate
            .split('workflow-contract-fixture').join('<workflow-instance>')
            .split('workflow-contract-group').join('<workflow-group>')
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
  it('starts reference images from chapter assets and binds consumers only after design', () => {
    createVideoWorkflowCanvasTemplate()
    const edges = useRFStore.getState().edges
    const parents = (id: string) => edges.filter(edge => edge.target.endsWith(`:${id}`)).map(edge => edge.source.split(':').at(-1))
    expect(parents('chapter-asset-prepare')).toEqual(['chapter-assets-agent'])
    expect(parents('asset-image-generate')).toEqual(['chapter-asset-prepare'])
    expect(parents('asset-consumer-bind').sort()).toEqual(['asset-fan-out', 'asset-image-generate'])
    expect(parents('clip-writer-agent')).toContain('asset-consumer-bind')
  })

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
    expect(VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION).toBe(90)
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
			!Object.prototype.hasOwnProperty.call(node.data, 'workflowExecutionRecoveryPolicy')
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
			workflowBeatSheetTakeCount: 80,
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
		expect(beatSheetInstruction).toContain('tapcanvas-video-authoring-stages')
		expect(beatSheetInstruction).not.toContain('进入状态→触发→选择/起势')
		expect(beatSheetData.workflowAgentJsonObjectContract).toMatchObject({
			jsonSchema: { properties: { beats: { items: { required: expect.arrayContaining(['storyEvents', 'durationSeconds']) } } } },
		})
		const clipWriterData = runtimeNodeData('clip-writer-agent')
		const clipWriterInstruction = String(clipWriterData.workflowInstruction ?? '')
		expect(clipWriterInstruction).toContain('本节点不复制创作规则')
		expect(clipWriterInstruction).toContain('宿主只执行确定性投影')
	expect(clipWriterInstruction).toContain('镜头、对白、对象身份和同链创作自检均由该 Skill 统一定义')
	expect(clipWriterInstruction).toContain('结构性拒因沿同一逻辑任务回灌 writer 修订')
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

  it('persists separate chapter, shared assets and parallel clip design stages with no monolithic bypass', () => {
    for (const [nodes, edges] of [
      [VIDEO_ATOMIC_WORKFLOW_NODES, VIDEO_ATOMIC_WORKFLOW_EDGES],
      [VIDEO_PROMPT_ONLY_WORKFLOW_NODES, VIDEO_PROMPT_ONLY_WORKFLOW_EDGES],
    ] as const) {
      const byId = new Map(nodes.map(node => [node.nodeId, node]));
      expect(byId.get('beat-sheet-agent')?.outputPorts).toEqual(['chapter-plan']);
      expect(byId.get('chapter-assets-agent')?.inputPorts).toEqual(['delivery-contract']);
      expect(byId.get('clip-design-agent')?.executionMode).toBe('each');
      expect(byId.get('beat-sheet-assemble')?.executionMode).toBe('collect');
      expect(edges.filter(edge => edge.targetNodeId === 'beat-sheet-format')).toEqual([
        { sourceNodeId: 'beat-sheet-assemble', sourcePort: 'beat-sheet', targetNodeId: 'beat-sheet-format', targetPort: 'beat-sheet' },
      ]);
      for (const edge of edges) {
        if (edge.sourceNodeId !== 'manual-trigger') expect(byId.get(edge.sourceNodeId)?.outputPorts).toContain(edge.sourcePort);
        expect(byId.get(edge.targetNodeId)?.inputPorts).toContain(edge.targetPort);
      }
    }
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
        target: expect.stringContaining(':launch-blocking-diagrams'),
      }),
      expect.objectContaining({
        source: expect.stringContaining(':launch-blocking-diagrams'),
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
        source: expect.stringContaining(':asset-consumer-bind'),
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
      label: '章节剧情规划 Agent',
      workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
      workflowNodeKind: 'beat_sheet_authoring',
      workflowAtomicSpec: {
        category: 'agent',
        executorRef: 'agents.logical-task/v2',
		inputPorts: ['trigger', 'delivery-contract'],
      },
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentDefinitionId: 'writer',
      workflowAgentOutputArtifactType: 'tapcanvas.chapter-beat-plan/v1',
    })
    expect(beatSheetPatch?.data.workflowAgentJsonObjectContract).toMatchObject({
      jsonSchema: { required: expect.arrayContaining(['beats', 'sourceCoveragePlan']) },
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

  expect(logicalAgentNodes).toHaveLength(5)
    for (const node of logicalAgentNodes) {
      expect(node.data.workflowAgentDefinitionId).toEqual(expect.any(String))
      expect(node.data.workflowInstruction).toEqual(expect.any(String))
      expect(node.data.workflowAgentOutputArtifactType).toEqual(expect.any(String))
      expect(node.data.workflowAgentOutputEncoding).toMatch(/^(?:json_(?:object|array)|plain_text)$/)
      expect(node.data.workflowAgentDeliveryRequirement).toEqual(expect.any(String))
    }
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
		expect(String(clipWriter?.data.workflowInstruction)).toContain('本节点不复制创作规则')
		expect(String(clipWriter?.data.workflowInstruction)).toContain('以冻结 clip-context')
		expect(String(clipWriter?.data.workflowInstruction)).toContain('宿主只执行确定性投影')
	expect(String(clipWriter?.data.workflowInstruction)).toContain('镜头、对白、对象身份和同链创作自检均由该 Skill 统一定义')
	expect(String(clipWriter?.data.workflowInstruction)).toContain('结构性拒因沿同一逻辑任务回灌 writer 修订')
		expect(String(clipWriter?.data.workflowInstruction)).not.toContain('每个 shot 必须有非空 visualTask 与 action')
		expect(clipWriter?.data.workflowAgentMaxOutputTokens).toBe(65536)
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
  expect(data('beat-sheet-agent').workflowAgentMaxOutputTokens).toBe(65536)
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
		expect(data('asset-fan-out').workflowInputPorts).toEqual(['asset-plans', 'beat-sheet', 'asset-bindings'])
    expect(String(data('beat-sheet-agent').workflowInstruction)).toContain('tapcanvas-video-authoring-stages')
    expect(data('delivery-contract').workflowTargetDurationSeconds).toBeUndefined()
    expect(data('beat-sheet-agent').workflowAgentJsonObjectContract).toMatchObject({
      allowedFields: expect.arrayContaining(['sourceCoveragePlan', 'sourceFidelityAudit', 'chapterArc']),
      jsonSchema: { additionalProperties: false },
    })
    expect(data('beat-sheet-agent').workflowAgentJsonObjectContract).not.toHaveProperty('arrayItemMergeKeyFields')
    expect(data('beat-sheet-format').workflowAtomicSpec).toMatchObject({
      operation: 'max_clip',
      executorRef: 'video.beat-sheet.take/v1',
      inputPorts: ['beat-sheet'],
      outputPorts: ['beat-sheet'],
    })
    expect(data('beat-sheet-format').workflowBeatSheetTakeCount).toBe(80)
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
    expect(agent('beat-sheet-agent').workflowRequiredSkills).toEqual(['tapcanvas-video-authoring-stages'])
    expect(agent('beat-sheet-agent').workflowAllowedTools).toBeUndefined()
    expect(agent('beat-sheet-agent').workflowAgentJsonObjectContract).toMatchObject({
	      jsonSchema: { required: expect.arrayContaining(['sourceCoveragePlan', 'chapterArc']) },
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
      workflowOptionalInputPorts: ['skills', 'tools', 'knowledge-candidates', 'knowledge-evidence', 'asset-bindings', 'delivery-contract'],
      workflowPromptExampleMediaType: 'video',
      workflowAtomicSpec: {
        inputAlignment: {
          strategy: 'keyed_join',
          primaryPort: 'clip-contexts',
          primaryKeyPath: 'beat.clipId',
          candidateKeyPath: 'assetPlan.consumerClipIds',
          candidatePorts: ['asset-bindings'],
        },
      },
      workflowAgentJsonObjectContract: {
        requiredArrayFields: ['clips'],
        allowedFields: ['clips', 'selfQaNote', 'creativeReview', 'sourceFidelityAudit'],
      },
    })
    expect(agent('clip-writer-agent').workflowRequiredSkills).toEqual(['tapcanvas-video-prompt-writer', 'tapcanvas-dialogue-drama'])
    expect(agent('clip-writer-agent').workflowAllowedTools).toBeUndefined()
		expect(String(agent('clip-writer-agent').workflowInstruction)).toContain('本节点不复制创作规则')
		expect(String(agent('clip-writer-agent').workflowInstruction)).toContain('宿主只执行确定性投影')
	expect(String(agent('clip-writer-agent').workflowInstruction)).toContain('结构性拒因沿同一逻辑任务回灌 writer 修订')
		expect(String(agent('clip-writer-agent').workflowInstruction)).not.toContain('shots 只用 speechEventIds')
    expect(String(agent('prompt-package').workflowDeliveryRequirement)).toContain('纯执行提示词')
		expect(String(agent('beat-sheet-agent').workflowInstruction)).toContain('tapcanvas-video-authoring-stages')
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

it('branches node preparation away from paid video submission', () => {
  expect(VIDEO_ATOMIC_WORKFLOW_EDGES).toContainEqual({ sourceNodeId: 'video-execution-choice', sourcePort: 'matched', targetNodeId: 'video-node-prepare', targetPort: 'authorization' })
  expect(VIDEO_ATOMIC_WORKFLOW_EDGES).toContainEqual({ sourceNodeId: 'video-execution-choice', sourcePort: 'unmatched', targetNodeId: 'video-submit', targetPort: 'authorization' })
  expect(VIDEO_ATOMIC_WORKFLOW_EDGES.filter(edge => edge.sourceNodeId === 'video-node-prepare')).toEqual([])
})

it('upgrades saved workflows with missing branch nodes and declares selective outputs', () => {
  const patch = buildVideoWorkflowCanvasDefinitionPatch({ workflowInstanceId: 'upgrade', workflowGroupId: 'group', executionScope: 'media_delivery', executionVariant: 'full_video', existingNodes: [{ id: 'group' }], existingEdges: [] })
  expect(patch.createNodes?.some(node => node.id === 'upgrade:video-node-prepare')).toBe(true)
  expect(patch.patchNodeData.find(node => node.id === 'upgrade:video-execution-choice')?.data.workflowAtomicSpec).toMatchObject({ selectiveOutputPorts: ['matched', 'unmatched'] })
})

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	buildVideoWorkflowCanvasDefinitionPatch,
	type VideoWorkflowExistingEdge,
	type VideoWorkflowExistingNode,
} from './videoWorkflowCanvasTemplate'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim() || value.trim() !== value) {
		throw new Error(`${label} must be a non-empty, unpadded string`)
	}
	return value
}

function parseEnvelope(value: unknown): Readonly<{
	flowId: string
	nodes: readonly JsonRecord[]
	edges: readonly JsonRecord[]
}> {
	if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.data)) {
		throw new Error('Input must be a flowGet response with data.data.nodes and data.data.edges')
	}
	const flow = value.data.data
	if (!Array.isArray(flow.nodes) || !flow.nodes.every(isRecord)) {
		throw new Error('flowGet data.data.nodes must be an array of objects')
	}
	if (!Array.isArray(flow.edges) || !flow.edges.every(isRecord)) {
		throw new Error('flowGet data.data.edges must be an array of objects')
	}
	return {
		flowId: requiredString(value.data.id, 'flowGet data.id'),
		nodes: flow.nodes,
		edges: flow.edges,
	}
}

function readWorkflowInput(envelope: ReturnType<typeof parseEnvelope>): Readonly<{
	input: Parameters<typeof buildVideoWorkflowCanvasDefinitionPatch>[0]
	canvasDefinitionVersion: number | null
	workflowGroupId: string
}> {
	const groups = envelope.nodes.filter((node) => (
		node.type === 'groupNode'
		&& isRecord(node.data)
		&& node.data.workflowKey === 'one-click-production/v1'
	))
	if (groups.length !== 1) throw new Error(`Expected exactly one workflow group; found ${groups.length}`)
	const group = groups[0]
	if (!group || !isRecord(group.data)) throw new Error('Workflow group data is missing')
	const workflowGroupId = requiredString(group.id, 'workflow group id')
	const workflowInstanceId = requiredString(group.data.workflowInstanceId, 'workflowInstanceId')
	const executionScope = group.data.workflowExecutionScope
	if (executionScope !== 'prompt_only' && executionScope !== 'media_delivery') {
		throw new Error('Workflow group has no valid workflowExecutionScope')
	}
	const executionVariant = group.data.workflowExecutionVariant
	if (executionVariant !== undefined && executionVariant !== 'full_video' && executionVariant !== 'first_video') {
		throw new Error('Workflow group has no valid workflowExecutionVariant')
	}
	const canvasDefinitionVersion = group.data.workflowCanvasDefinitionVersion
	if (canvasDefinitionVersion !== undefined && (typeof canvasDefinitionVersion !== 'number' || !Number.isSafeInteger(canvasDefinitionVersion))) {
		throw new Error('workflowCanvasDefinitionVersion must be a safe integer')
	}
	const existingNodes: VideoWorkflowExistingNode[] = envelope.nodes.map((node, index) => {
		const parentId = node.parentId
		if (parentId !== undefined && parentId !== null && typeof parentId !== 'string') {
			throw new Error(`flowGet node[${index}].parentId must be a string or null`)
		}
		return {
			id: requiredString(node.id, `flowGet node[${index}].id`),
			...(parentId === undefined ? {} : { parentId }),
			...(isRecord(node.data) ? { data: node.data } : {}),
		}
	})
	const existingEdges: VideoWorkflowExistingEdge[] = envelope.edges.map((edge, index) => {
		const id = edge.id
		const sourceHandle = edge.sourceHandle
		const targetHandle = edge.targetHandle
		if (id !== undefined && typeof id !== 'string') throw new Error(`flowGet edge[${index}].id must be a string`)
		if (sourceHandle !== undefined && sourceHandle !== null && typeof sourceHandle !== 'string') {
			throw new Error(`flowGet edge[${index}].sourceHandle must be a string or null`)
		}
		if (targetHandle !== undefined && targetHandle !== null && typeof targetHandle !== 'string') {
			throw new Error(`flowGet edge[${index}].targetHandle must be a string or null`)
		}
		return {
			...(typeof id === 'string' ? { id } : {}),
			source: requiredString(edge.source, `flowGet edge[${index}].source`),
			target: requiredString(edge.target, `flowGet edge[${index}].target`),
			...(sourceHandle === undefined ? {} : { sourceHandle }),
			...(targetHandle === undefined ? {} : { targetHandle }),
		}
	})
	return {
		workflowGroupId,
		canvasDefinitionVersion: typeof canvasDefinitionVersion === 'number' ? canvasDefinitionVersion : null,
		input: {
			workflowInstanceId,
			workflowGroupId,
			executionScope,
			executionVariant,
			existingNodes,
			existingEdges,
		},
	}
}

const exportEnabled = process.env.TAPCANVAS_WORKFLOW_PATCH_INPUT !== undefined

describe.skipIf(!exportEnabled)('workflow template patch export (explicit opt-in)', () => {
	it('writes the complete patch derived from a saved flowGet response', async () => {
		const inputPath = process.env.TAPCANVAS_WORKFLOW_PATCH_INPUT
		const outputPathValue = process.env.TAPCANVAS_WORKFLOW_PATCH_OUTPUT
		if (!inputPath || !outputPathValue) {
			throw new Error('Set both TAPCANVAS_WORKFLOW_PATCH_INPUT and TAPCANVAS_WORKFLOW_PATCH_OUTPUT')
		}
		const outputPath = resolve(outputPathValue)
		if (resolve(inputPath) === outputPath) throw new Error('Input and output paths must be different')
		const envelope = parseEnvelope(JSON.parse(await readFile(inputPath, 'utf8')) as unknown)
		const resolved = readWorkflowInput(envelope)
		const rawPatch = buildVideoWorkflowCanvasDefinitionPatch(resolved.input)
		const patch = { ...rawPatch, createNodes: rawPatch.createNodes ?? [] }
		expect(Array.isArray(patch.createNodes)).toBe(true)
		expect(Array.isArray(patch.patchNodeData)).toBe(true)
		expect(Array.isArray(patch.createEdges)).toBe(true)
		expect(Array.isArray(patch.deleteNodeIds)).toBe(true)
		expect(Array.isArray(patch.deleteEdgeIds)).toBe(true)
		await mkdir(dirname(outputPath), { recursive: true })
		await writeFile(outputPath, `${JSON.stringify(patch, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
		console.info(JSON.stringify({
			flowId: envelope.flowId,
			workflowInstanceId: resolved.input.workflowInstanceId,
			workflowGroupId: resolved.workflowGroupId,
			inputCanvasDefinitionVersion: resolved.canvasDefinitionVersion,
			inputNodeCount: envelope.nodes.length,
			inputEdgeCount: envelope.edges.length,
			patch: {
				createNodes: patch.createNodes.length,
				patchNodeData: patch.patchNodeData.length,
				createEdges: patch.createEdges.length,
				deleteNodeIds: patch.deleteNodeIds.length,
				deleteEdgeIds: patch.deleteEdgeIds.length,
			},
			outputPath,
		}))
	})
})

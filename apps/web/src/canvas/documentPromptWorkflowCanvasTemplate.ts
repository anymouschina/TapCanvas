import {
  ADMIN_WORKFLOW_PERMISSION,
  AGENT_WORKFLOW_KEY,
  createManualWorkflowTriggerSpec,
} from '@tapcanvas/workflow-kernel-protocol'
import { isCurrentUserAdmin } from '../auth/isAdmin'
import {
  ATOMIC_WORKFLOW_PRESETS,
  atomicNodeExtra,
  atomicSpec,
  connectWorkflowEdge,
  createIdentity,
  workflowAnchor,
  type AgentWorkflowCanvasTemplateResult,
  type AtomicWorkflowPresetId,
} from './agentWorkflowCanvasTemplate'
import { useRFStore } from './store'
import { WORKFLOW_ICON_NODE_COLUMN_STRIDE, WORKFLOW_ICON_NODE_SIZE } from './workflowNodeGeometry'

type DocumentPromptStage = Readonly<{
  id: string
  presetId: AtomicWorkflowPresetId
  label: string
  executionMode?: 'once' | 'each' | 'collect'
  overrides: Record<string, unknown>
}>

export const DOCUMENT_SOURCE_STRUCTURE_SCRIPT = String.raw`const source = String(input ?? '').replace(/\r\n?/gu, '\n').trim();
if (!source) throw new Error('文档输入为空，无法整理正文结构');

const paragraphs = source
  .split(/\n{2,}/gu)
  .map((paragraph) => paragraph.trim())
  .filter(Boolean);
if (paragraphs.length === 0) throw new Error('文档没有可执行的文本段落');

const structuredParagraphs = paragraphs.map((text, index) => ({
    paragraphId: 'paragraph-' + String(index + 1).padStart(4, '0'),
    text,
}));
const maxChunkCharacters = 1800;
const maxChunkParagraphs = 18;
const chunks = [];
let pending = [];
let pendingCharacters = 0;
const flush = () => {
  if (pending.length === 0) return;
  const chunkId = 'chunk-' + String(chunks.length + 1).padStart(4, '0');
  chunks.push({
    chunkId,
    text: pending.map((paragraph) => paragraph.text).join('\n\n'),
    paragraphIds: pending.map((paragraph) => paragraph.paragraphId),
  });
  pending = [];
  pendingCharacters = 0;
};
for (const paragraph of structuredParagraphs) {
  const separatorCharacters = pending.length > 0 ? 2 : 0;
  const wouldExceedCharacters = pending.length > 0
    && pendingCharacters + separatorCharacters + paragraph.text.length > maxChunkCharacters;
  const wouldExceedParagraphs = pending.length >= maxChunkParagraphs;
  if (wouldExceedCharacters || wouldExceedParagraphs) flush();
  pending.push(paragraph);
  pendingCharacters += (pending.length > 1 ? 2 : 0) + paragraph.text.length;
}
flush();
return chunks;`

const DOCUMENT_VIDEO_STAGES: readonly DocumentPromptStage[] = [
  { id: 'document', presetId: 'textInput', label: '小说 / 文档输入', overrides: { workflowTextInput: '' } },
  {
    id: 'source-structure',
    presetId: 'javascript',
    label: '整理正文结构',
    executionMode: 'once',
    overrides: {
      workflowJavascriptCode: DOCUMENT_SOURCE_STRUCTURE_SCRIPT,
    },
  },
  {
    id: 'source-chunks',
    presetId: 'collectionSplit',
    label: '拆分为结构批次',
    overrides: {
      workflowCollectionPath: '',
      workflowCollectionParseJson: false,
      workflowCollectionItemIdField: 'chunkId',
    },
  },
  {
    id: 'clip-planner',
    presetId: 'agent',
    label: '按内容规划动态 Clip 数组',
    executionMode: 'each',
    overrides: {
      workflowAtomicSpec: { ...atomicSpec(ATOMIC_WORKFLOW_PRESETS.agent), inputPorts: ['input'], executionMode: 'each', itemConcurrency: 3 },
      workflowInputPorts: ['input'],
      workflowInstruction: '读取当前一个无丢失结构批次，按叙事语义和可在 15 秒视频中清晰呈现的内容容量，动态拆分为若干连续生产单元。只输出合法 JSON 数组；每项必须包含唯一非空字符串 clipId、非空字符串 text 与 durationSeconds=15，clipId 必须以输入 chunkId 开头，并保持原文顺序和来源事实。当前批次正文必须完整覆盖且不重复；数量由内容决定，不得固定数量，不得用字符数机械代替叙事拆分，不得添加 Markdown 代码围栏或说明文字。',
      workflowAgentOutputArtifactType: 'tapcanvas.json/v1',
      workflowAgentOutputEncoding: 'json_array',
      workflowAgentJsonArrayContract: {
        itemRequiredStringFields: ['clipId', 'text'],
        itemRequiredNumberFields: ['durationSeconds'],
        itemExactNumberFields: { durationSeconds: 15 },
        itemAllowedFields: ['clipId', 'text', 'durationSeconds'],
      },
      workflowAgentDeliveryRequirement: '为当前结构批次交付一个可解析 JSON 数组；每项均有唯一非空 clipId、非空 text 与 durationSeconds=15，完整覆盖当前批次正文且顺序一致，数据项数量由正文内容动态决定。',
      workflowAgentDefinitionId: 'writer',
    },
  },
  {
    id: 'clips',
    presetId: 'collectionSplit',
    label: 'Split · 按数组实际长度展开',
    overrides: {
      workflowCollectionPath: 'text',
      workflowCollectionParseJson: true,
      workflowCollectionItemIdField: 'clipId',
    },
  },
  {
    id: 'prompt-agent',
    presetId: 'agent',
    label: '逐项生成视频提示词',
    overrides: {
      workflowAtomicSpec: { ...atomicSpec(ATOMIC_WORKFLOW_PRESETS.agent), inputPorts: ['input'], itemConcurrency: 3 },
      workflowInputPorts: ['input'],
      workflowInstruction: '把当前一个来源数据项提炼并编译为一条可直接交给视频模型执行的中文视频提示词。严格采用当前项的 durationSeconds，保留该项的来源事实、时序、人物、场景、动作、镜头与声音要求，不扩写其他数据项。',
      workflowAgentOutputArtifactType: 'tapcanvas.video-prompt/v1',
      workflowAgentOutputEncoding: 'json_artifact',
      workflowAgentDeliveryRequirement: '交付一条非空、可直接执行、时长严格等于当前数据项 durationSeconds 且仅对应该数据项的视频提示词文本。',
      workflowAgentDefinitionId: 'video-prompt-writer',
      workflowPromptExampleMediaType: 'video',
    },
  },
  {
    id: 'video',
    presetId: 'videoGeneration',
    label: '逐项生成 15 秒视频',
    overrides: {
      workflowAtomicSpec: { ...atomicSpec(ATOMIC_WORKFLOW_PRESETS.videoGeneration), itemConcurrency: 1 },
    },
  },
  {
    id: 'delivery',
    presetId: 'delivery',
    label: '验收全部视频',
    overrides: {
      workflowDeliveryRequirement: '所有动态数据项均须得到各自独立的真实持久视频 URL，并保留 itemId、逐项执行记录、来源谱系、供应商任务身份与生成证据。',
      workflowDeliveryArtifactType: 'tapcanvas.video/v1',
    },
  },
]

const DOCUMENT_PROMPT_STAGES: readonly DocumentPromptStage[] = [
  ...DOCUMENT_VIDEO_STAGES.slice(0, 6),
  {
    id: 'delivery',
    presetId: 'delivery',
    label: '验收并输出全部提示词',
    overrides: {
      workflowDeliveryRequirement: '每个动态数据项都必须交付一条非空、可直接执行且仅对应其来源片段的 15 秒视频提示词，并保留 itemId、来源谱系、逐项执行记录与 agents-cli 交付证据。',
      workflowDeliveryArtifactType: 'tapcanvas.video-prompt/v1',
    },
  },
]

function createDocumentPromptWorkflowCanvasTemplate(input: Readonly<{
  stages: readonly DocumentPromptStage[]
  groupLabel: string
}>): AgentWorkflowCanvasTemplateResult {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以创建工作流编排节点')
  const store = useRFStore.getState()
  const workflowInstanceId = createIdentity('document-prompts-workflow')
  const anchor = workflowAnchor(store.nodes)
  const triggerNodeId = `${workflowInstanceId}:manual-trigger`
  store.addNode('taskNode', '手动触发', {
    nodeId: triggerNodeId,
    autoLabel: false,
    position: anchor,
    kind: 'workflowTrigger',
    nodeWidth: WORKFLOW_ICON_NODE_SIZE,
    nodeHeight: WORKFLOW_ICON_NODE_SIZE,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowDefinitionVersion: 1,
    workflowInstanceId,
    workflowTriggerSpec: createManualWorkflowTriggerSpec(),
    workflowOutputPorts: ['trigger'],
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
    status: 'idle',
  })

  const nodeIds = [triggerNodeId]
  input.stages.forEach((stage, index) => {
    const preset = ATOMIC_WORKFLOW_PRESETS[stage.presetId]
    const nodeId = `${workflowInstanceId}:${stage.id}`
    const baseSpec = atomicSpec(preset)
    const overrideSpec = stage.overrides.workflowAtomicSpec
    store.addNode('taskNode', stage.label, {
      ...atomicNodeExtra(workflowInstanceId, preset, nodeId),
      position: { x: anchor.x + (index + 1) * WORKFLOW_ICON_NODE_COLUMN_STRIDE, y: anchor.y },
      ...stage.overrides,
      workflowAtomicSpec: {
        ...baseSpec,
        ...(overrideSpec && typeof overrideSpec === 'object' && !Array.isArray(overrideSpec)
          ? overrideSpec as Record<string, unknown>
          : {}),
        executionMode: stage.executionMode ?? baseSpec.executionMode,
      },
    })
    nodeIds.push(nodeId)
  })

  const stageIds = input.stages.map((stage) => stage.id)
  const edges = stageIds.map((stageId, index) => {
    const sourceId = index === 0 ? 'manual-trigger' : stageIds[index - 1]
    const sourceNode = index === 0
      ? { outputPort: 'trigger' }
      : { outputPort: ATOMIC_WORKFLOW_PRESETS[input.stages[index - 1].presetId].outputPorts[0] }
    const targetPort = ATOMIC_WORKFLOW_PRESETS[input.stages[index].presetId].inputPorts[0]
    if (!sourceId || !sourceNode.outputPort || !targetPort) {
      throw new Error(`工作流阶段 ${stageId} 缺少可连接的输入或输出端口`)
    }
    return {
      source: `${workflowInstanceId}:${sourceId}`,
      sourcePort: sourceNode.outputPort,
      target: `${workflowInstanceId}:${stageId}`,
      targetPort,
    }
  })
  edges.forEach(connectWorkflowEdge)
  const workflowGroupId = store.createGroupForNodeIds(nodeIds, input.groupLabel, { preserveLayout: true })
  if (!workflowGroupId) throw new Error('工作流节点已经创建，但未能建立工作流组')
  useRFStore.getState().updateNodeData(workflowGroupId, {
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowDefinitionVersion: 1,
    workflowInstanceId,
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
  })
  useRFStore.getState().arrangeGroupChildren(workflowGroupId, 'flow')
  return { workflowInstanceId, workflowGroupId, nodeIds }
}

/**
 * Executable prompt-only one-click film graph. Agent nodes run as durable workflow nodes and
 * persist per-item history; this path never dispatches an AI chat turn or creates media nodes.
 */
export function createDocumentToVideoPromptsWorkflowCanvasTemplate(): AgentWorkflowCanvasTemplateResult {
  return createDocumentPromptWorkflowCanvasTemplate({
    stages: DOCUMENT_PROMPT_STAGES,
    groupLabel: '一键成片 · 仅输出提示词',
  })
}

/**
 * One compact authoring graph expands over runtime collections. Running to the prompt Agent is
 * the non-media preview path; running the complete graph submits one durable video task per item.
 */
export function createDocumentToDynamicVideosWorkflowCanvasTemplate(): AgentWorkflowCanvasTemplateResult {
  return createDocumentPromptWorkflowCanvasTemplate({
    stages: DOCUMENT_VIDEO_STAGES,
    groupLabel: '文档 → 动态 15 秒视频',
  })
}

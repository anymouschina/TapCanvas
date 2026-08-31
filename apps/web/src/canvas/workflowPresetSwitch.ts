import type { Node } from '@xyflow/react'

export type WorkflowPreset = {
  key: string
  name: string
  themeBrief: string
  layoutAssetId: string
  styleAssetId: string
}

export type WorkflowPresetAsset = { id: string; url: string; width: number | null; height: number | null }

export type WorkflowPresetSwitchContract = {
  selectorNodeId: string
  groupNodeId: string
  imageGenerationNodeId: string
  layoutNodeId: string
  styleNodeId: string
  presets: WorkflowPreset[]
  activePresetKey: string
}

export type WorkflowPresetResolvedAssets = { layout: WorkflowPresetAsset; style: WorkflowPresetAsset }

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : ''
}

function parseWorkflowPreset(value: unknown): WorkflowPreset | null {
  const record = readRecord(value)
  if (!record) return null
  const preset = {
    key: readRequiredString(record, 'key'),
    name: readRequiredString(record, 'name'),
    themeBrief: readRequiredString(record, 'themeBrief'),
    layoutAssetId: readRequiredString(record, 'layoutAssetId'),
    styleAssetId: readRequiredString(record, 'styleAssetId'),
  }
  return Object.values(preset).every(Boolean) ? preset : null
}

export function readWorkflowPresets(data: Record<string, unknown>): WorkflowPreset[] {
  if (!Array.isArray(data.presets)) return []
  const presets = data.presets.map(parseWorkflowPreset).filter((preset): preset is WorkflowPreset => preset !== null)
  return new Set(presets.map((preset) => preset.key)).size === presets.length ? presets : []
}

export function readWorkflowPresetSwitchContract(input: { selectorNodeId: string; nodes: readonly Node[] }): WorkflowPresetSwitchContract {
  const selector = input.nodes.find((node) => node.id === input.selectorNodeId)
  const data = readRecord(selector?.data)
  if (!selector || !data || data.workflowPresetSelectorVersion !== 2) throw new Error('主题切换失败：节点不是动态主题输入节点')
  const presets = readWorkflowPresets(data)
  if (presets.length === 0) throw new Error('主题切换失败：没有完整且唯一的主题入口合同')
  const groupNodeId = typeof selector.parentId === 'string' ? selector.parentId.trim() : ''
  const imageGenerationNodeId = readRequiredString(data, 'imageGenerationNodeId')
  const layoutNodeId = readRequiredString(data, 'layoutNodeId')
  const styleNodeId = readRequiredString(data, 'styleNodeId')
  const requiredNodeIds = [groupNodeId, imageGenerationNodeId, layoutNodeId, styleNodeId]
  if (requiredNodeIds.some((nodeId) => !nodeId || !input.nodes.some((node) => node.id === nodeId))) throw new Error('主题切换失败：工作流目标节点合同不完整')
  const protectedNodeIds = requiredNodeIds.filter((nodeId) => readRecord(input.nodes.find((node) => node.id === nodeId)?.data)?.readOnly === true)
  if (protectedNodeIds.length > 0) throw new Error(`主题切换失败：目标节点为只读状态：${protectedNodeIds.join(', ')}`)
  const requested = readRequiredString(data, 'activePresetKey')
  return { selectorNodeId: input.selectorNodeId, groupNodeId, imageGenerationNodeId, layoutNodeId, styleNodeId, presets, activePresetKey: presets.some((preset) => preset.key === requested) ? requested : presets[0].key }
}

function buildMediaPatch(label: string, asset: WorkflowPresetAsset, role: 'layout' | 'style'): Readonly<Record<string, unknown>> {
  return { label, status: 'success', imageUrl: asset.url, imageResults: [{ url: asset.url, title: label, assetId: asset.id }], imagePrimaryIndex: 0, assetId: asset.id, sourceAssetId: asset.id, referenceAssetIds: [asset.id], referenceRole: role, mediaNaturalSize: asset.width && asset.height ? { width: asset.width, height: asset.height, url: asset.url } : null }
}

export function buildWorkflowPresetPatches(input: { contract: WorkflowPresetSwitchContract; presetKey: string; assets: WorkflowPresetResolvedAssets }): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const preset = input.contract.presets.find((candidate) => candidate.key === input.presetKey)
  if (!preset) throw new Error(`主题切换失败：找不到主题 ${input.presetKey}`)
  if (input.assets.layout.id !== preset.layoutAssetId || input.assets.style.id !== preset.styleAssetId) throw new Error('主题切换失败：解析后的资产与主题合同不一致')
  return new Map([
    [input.contract.groupNodeId, { activePresetKey: preset.key }],
    [input.contract.selectorNodeId, { activePresetKey: preset.key, workflowTextInput: preset.themeBrief, content: `当前主题：${preset.name}。这只是 Agent 的主题输入；最终 prompt / negativePrompt 会在每次运行时由 LLM 动态生成。` }],
    [input.contract.layoutNodeId, { ...buildMediaPatch(`布局参考｜${preset.name}`, input.assets.layout, 'layout'), activePresetKey: preset.key }],
    [input.contract.styleNodeId, { ...buildMediaPatch(`风格参考｜${preset.name}`, input.assets.style, 'style'), activePresetKey: preset.key }],
    [input.contract.imageGenerationNodeId, { activePresetKey: preset.key, workflowImageReferenceAssetBindings: [{ assetId: preset.layoutAssetId, role: 'layout', strength: 0.8 }, { assetId: preset.styleAssetId, role: 'style', strength: 0.55 }] }],
  ])
}

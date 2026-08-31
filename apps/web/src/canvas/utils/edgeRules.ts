import {
  getTaskNodeCoreType,
  normalizeTaskNodeKind,
  type TaskNodeCoreType,
  type TaskNodeKind,
} from '../nodes/taskNodeSchema'

type EdgeRuleMap = Record<string, string[]>

const defaultEdgeRules: EdgeRuleMap = {
  text: ['image', 'video', 'audio'],
  image: ['image', 'storyboard', 'video'],
  storyboard: ['image', 'video'],
  video: ['video'],
  // 音频 → 视频/视频合成：作为配音轨输入（生成后服务端 ffmpeg 混音）
  audio: ['video'],
}

const exactTargetRules: Partial<Record<TaskNodeCoreType, readonly TaskNodeKind[]>> = {
  video: ['videoAnalysis'],
}

const isExactTargetAllowed = (sourceKind: string, targetKind: string): boolean => {
  const source = normalizeTaskNodeKind(sourceKind)
  const target = normalizeTaskNodeKind(targetKind)
  if (!source || !target) return false
  if (source === 'workflowTrigger' || target === 'workflowTrigger' || source === 'workflowStage' || target === 'workflowStage') {
    return (source === 'workflowTrigger' && target === 'workflowStage')
      || (source === 'workflowStage' && target === 'workflowStage')
  }
  return exactTargetRules[getTaskNodeCoreType(sourceKind)]?.includes(target) ?? false
}

export const buildEdgeValidator =
  (rules: EdgeRuleMap = defaultEdgeRules) =>
  (sourceKind?: string | null, targetKind?: string | null) => {
    if (!sourceKind || !targetKind) return true
    const normalizedSource = normalizeTaskNodeKind(sourceKind)
    const normalizedTarget = normalizeTaskNodeKind(targetKind)
    if (normalizedSource === 'workflowTrigger' || normalizedTarget === 'workflowTrigger' || normalizedSource === 'workflowStage' || normalizedTarget === 'workflowStage') {
      return (normalizedSource === 'workflowTrigger' && normalizedTarget === 'workflowStage')
        || (normalizedSource === 'workflowStage' && normalizedTarget === 'workflowStage')
    }
    if (isExactTargetAllowed(sourceKind, targetKind)) return true
    const normalizedSourceKind = getTaskNodeCoreType(sourceKind)
    const normalizedTargetKind = getTaskNodeCoreType(targetKind)
    const targets = rules[normalizedSourceKind]
    if (!targets) return true
    return targets.includes(normalizedTargetKind)
  }

export const isImageKind = (kind?: string | null) => getTaskNodeCoreType(kind) === 'image'

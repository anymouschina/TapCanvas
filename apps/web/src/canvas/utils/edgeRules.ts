import { getTaskNodeCoreType } from '../nodes/taskNodeSchema'

type EdgeRuleMap = Record<string, string[]>

const defaultEdgeRules: EdgeRuleMap = {
  text: ['image', 'video'],
  image: ['image', 'storyboard', 'video'],
  storyboard: ['image', 'video'],
  video: ['video'],
}

export const buildEdgeValidator =
  (rules: EdgeRuleMap = defaultEdgeRules) =>
  (sourceKind?: string | null, targetKind?: string | null) => {
    if (!sourceKind || !targetKind) return true
    const normalizedSourceKind = getTaskNodeCoreType(sourceKind)
    const normalizedTargetKind = getTaskNodeCoreType(targetKind)
    const targets = rules[normalizedSourceKind]
    if (!targets) return true
    return targets.includes(normalizedTargetKind)
  }

export const isImageKind = (kind?: string | null) => getTaskNodeCoreType(kind) === 'image'

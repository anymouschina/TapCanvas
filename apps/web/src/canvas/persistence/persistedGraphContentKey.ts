import type { Edge, Node } from '@xyflow/react'
import {
  withoutWorkflowExecutionProjectionEdges,
  withoutWorkflowExecutionProjectionNodes,
} from '../workflowExecutionProjectionData'

function canonical(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/**
 * 可持久化图内容的稳定签名。
 *
 * 保存链路在落盘前会剥离运行时投影数据（workflow 节点的运行态字段、
 * runtime reference 节点/边）。画布可能因投影刷新、SSE 重放等以相同内容
 * 反复更换 store 引用；若脏标记只看引用身份，会形成「引用变化 → 标脏 →
 * 整图保存 → 再投影 → 再标脏」的版本风暴。本签名先按保存链路的同一过滤
 * 规则归一，再按稳定 id 排序序列化，用于判定「引用变化但持久化内容未变」。
 */
export function persistedGraphContentKey(nodes: readonly Node[], edges: readonly Edge[]): string {
  const persistableNodes = withoutWorkflowExecutionProjectionNodes(nodes)
    .slice()
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))
  const persistableEdges = withoutWorkflowExecutionProjectionEdges(edges)
    .slice()
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))
  return `${canonical(persistableNodes)}|${canonical(persistableEdges)}`
}

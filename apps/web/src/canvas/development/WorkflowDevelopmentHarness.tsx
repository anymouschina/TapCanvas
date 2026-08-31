import React from 'react'
import Canvas from '../Canvas'
import { createDocumentToDynamicVideosWorkflowCanvasTemplate } from '../documentPromptWorkflowCanvasTemplate'
import { useRFStore } from '../store'
import { useWorkflowNodeInspectorStore } from '../workflowNodeInspectorStore'
import './WorkflowDevelopmentHarness.css'

export default function WorkflowDevelopmentHarness(): React.JSX.Element {
  const originalCanvasStateRef = React.useRef(useRFStore.getState())
  const originalInspectorStateRef = React.useRef(useWorkflowNodeInspectorStore.getState())
  const [ready, setReady] = React.useState(false)

  React.useLayoutEffect(() => {
    useRFStore.getState().reset()
    const workflow = createDocumentToDynamicVideosWorkflowCanvasTemplate()
    const documentNodeId = `${workflow.workflowInstanceId}:document`
    const structureNodeId = `${workflow.workflowInstanceId}:source-structure`
    useRFStore.getState().updateNodeData(documentNodeId, {
      workflowTextInput: '开发验收文本：章节会由 Agent 动态拆分为若干 15 秒生产单元。',
    })
    useRFStore.getState().onNodesChange([
      { id: structureNodeId, type: 'select', selected: true },
    ])
    useWorkflowNodeInspectorStore.getState().openNode(structureNodeId)
    setReady(true)

    return () => {
      useRFStore.setState(originalCanvasStateRef.current, true)
      useWorkflowNodeInspectorStore.setState(originalInspectorStateRef.current, true)
    }
  }, [])

  return (
    <main className="workflow-development-harness">
      {ready ? (
        <>
          <Canvas
            className="workflow-development-harness__canvas"
            hideDevPerformancePanel
          />
          <aside className="workflow-development-harness__notice" aria-label="开发验收环境">
            <strong className="workflow-development-harness__notice-title">工作流开发验收</strong>
            <span className="workflow-development-harness__notice-detail">内存画布 · 可测试文本与 JavaScript · Agent 节点只验证配置</span>
          </aside>
        </>
      ) : (
        <div className="workflow-development-harness__loading" role="status">正在创建内存工作流…</div>
      )}
    </main>
  )
}

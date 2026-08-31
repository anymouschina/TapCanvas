import React from 'react'
import { Button } from '@mantine/core'
import { IconBinaryTree, IconCheck, IconMovie, IconPlayerPlay, IconRefresh, IconTestPipe, IconTypography, IconX } from '@tabler/icons-react'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import { toast } from '../../ui/toast'
import { respondWorkflowHumanApproval } from '../../api/server'
import { compileAgentWorkflow, runAgentWorkflow } from '../agentWorkflowExecution'
import { restoreAgentWorkflowDefaultConnections } from '../agentWorkflowCanvasTemplate'
import { useRFStore } from '../store'
import {
  needsVideoWorkflowCanvasDefinitionUpgrade,
  restoreVideoWorkflowDefaultConnections,
  upgradeVideoWorkflowCanvasDefinition,
} from '../videoWorkflowCanvasTemplate'
import { compileVideoWorkflow, runVideoWorkflow } from '../videoWorkflowExecution'
import { executeWorkflowNodeLocalTest, supportsWorkflowNodeLocalTest } from '../workflowNodeLocalTest'
import { useWorkflowNodeInspectorStore } from '../workflowNodeInspectorStore'
import { readWorkflowItemRuns } from '../workflowItemRuns'
import { materializeWorkflowTextItems, materializeWorkflowVideoItems } from '../workflowRuntimeMaterialization'
import { dataRecord, nodeOperation, readString } from './workflowNodeInspectorShared'

function runStatusLabel(status: string, operation: string, waitingReasonLabel: string): string {
  if (!status || status === 'idle') return '尚未运行'
  if (status === 'queued') return '等待执行'
  if (status === 'running') return '执行中'
  if (status === 'waiting_external') return waitingReasonLabel || (operation === 'video_generate' ? '等待成片' : '等待外部结果')
  if (status === 'success' || status === 'succeeded') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'canceled' || status === 'cancelled') return '已取消'
  if (status === 'skipped') return '已跳过'
  if (status === 'not_selected') return '分支未选择'
  return `未知状态：${status}`
}

export function RunTab(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  const [testing, setTesting] = React.useState(false)
  const [responding, setResponding] = React.useState(false)
  const workflowKey = readString(props.data, 'workflowKey')
  const workflowInstanceId = readString(props.data, 'workflowInstanceId')
  const promptOnly = props.data.workflowExecutionScope === 'prompt_only'
  const triggerNodeId = useRFStore((state) => state.nodes.find((node) => {
    const data = dataRecord(node.data)
    return data.kind === 'workflowTrigger'
      && data.adminWorkflow === true
      && readString(data, 'workflowInstanceId') === workflowInstanceId
  })?.id ?? '')
  const operation = nodeOperation(props.data)
  const trigger = props.data.kind === 'workflowTrigger'
  const sourceExecutionId = readString(props.data, 'workflowExecutionId')
  const pinnedSource = dataRecord(props.data.workflowPinnedOutputSource)
  const pinnedNodeRunId = readString(pinnedSource, 'sourceNodeRunId')
  const currentStatus = readString(props.data, 'workflowLocalTestStatus')
    || readString(props.data, 'workflowTraceStatus')
    || readString(props.data, 'workflowStatus')
  const waitingReasonLabel = readString(props.data, 'workflowWaitingReasonLabel')
  const itemRuns = readWorkflowItemRuns(props.data.workflowItemRuns)
	const executionEvidence = dataRecord(props.data.workflowExecutionEvidence)
	const readEvidenceCount = (field: string): number => {
		const value = executionEvidence[field]
		return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
	}
	const configuredItemConcurrency = readEvidenceCount('configuredItemConcurrency')
	const activeItems = readEvidenceCount('activeItems')
	const peakActiveItems = readEvidenceCount('peakActiveItems')
	const startedItems = readEvidenceCount('startedItems')
  const completedItems = itemRuns.filter((item) => item.status === 'success').length
  const totalItems = typeof props.data.workflowTotalUnits === 'number'
    && Number.isInteger(props.data.workflowTotalUnits)
    && props.data.workflowTotalUnits >= itemRuns.length
    ? props.data.workflowTotalUnits
    : itemRuns.length
  const videoItems = itemRuns.filter((item) => item.videoUrl)
  const textItems = itemRuns.filter((item) => item.textOutput)

  const validate = React.useCallback((): void => {
    try {
      if (!trigger) throw new Error('请在触发器节点运行整条工作流；当前页只执行该节点的独立测试')
      if (workflowKey === AGENT_WORKFLOW_KEY) compileAgentWorkflow(props.nodeId)
      else if (workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY) compileVideoWorkflow(props.nodeId)
      else throw new Error('未注册工作流编译器：' + workflowKey)
      toast('工作流结构、可达 DAG 与必填配置校验通过', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '工作流校验失败', 'error')
    }
  }, [props.nodeId, trigger, workflowKey])

  const runLocalNodeTest = React.useCallback(async (): Promise<void> => {
    setTesting(true)
    useRFStore.getState().updateNodeData(props.nodeId, {
      workflowLocalTestStatus: 'running',
      workflowLocalTestError: undefined,
      workflowLocalTestOutput: undefined,
    })
    try {
      const result = await executeWorkflowNodeLocalTest({ nodeId: props.nodeId, data: props.data })
      useRFStore.getState().updateNodeData(props.nodeId, {
        workflowLocalTestStatus: 'succeeded',
        workflowLocalTestOutput: result.output,
        workflowExecutionEvidence: result.evidence,
        workflowLocalTestDurationMs: result.durationMs,
        workflowLocalTestedAt: new Date().toISOString(),
      })
      useWorkflowNodeInspectorStore.getState().setTab('output')
      toast(operation === 'javascript' ? 'JavaScript 隔离测试完成' : '节点预览完成', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '节点预览失败'
      useRFStore.getState().updateNodeData(props.nodeId, {
        workflowLocalTestStatus: 'failed',
        workflowLocalTestError: message,
        workflowLocalTestedAt: new Date().toISOString(),
      })
      useWorkflowNodeInspectorStore.getState().setTab('output')
      toast(message, 'error')
    } finally {
      setTesting(false)
    }
  }, [operation, props.data, props.nodeId])

  const respondToApproval = React.useCallback(async (response: 'approved' | 'rejected'): Promise<void> => {
    const executionId = readString(props.data, 'workflowExecutionId')
    if (!executionId) {
      toast('当前审批节点缺少持久执行身份', 'error')
      return
    }
    setResponding(true)
    try {
      await respondWorkflowHumanApproval({ executionId, nodeId: props.nodeId, response })
      useRFStore.getState().updateNodeData(props.nodeId, { workflowStatus: 'running' })
      toast(response === 'approved' ? '审批已批准，工作流正在原位恢复' : '审批已拒绝，工作流正在原位恢复', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '提交审批响应失败', 'error')
    } finally {
      setResponding(false)
    }
  }, [props.data, props.nodeId])

  return (
    <div className="workflow-node-inspector__tab-content">
      <div className="workflow-node-inspector__run-facts">
        <div className="workflow-node-inspector__run-fact">
          <span className="workflow-node-inspector__run-label">当前状态</span>
          <strong className="workflow-node-inspector__run-value">
            {runStatusLabel(currentStatus, operation, waitingReasonLabel)}
          </strong>
        </div>
        <div className="workflow-node-inspector__run-fact">
          <span className="workflow-node-inspector__run-label">执行器</span>
          <strong className="workflow-node-inspector__run-value">{readString(dataRecord(props.data.workflowAtomicSpec), 'executorRef') || 'trigger'}</strong>
        </div>
        <div className="workflow-node-inspector__run-fact">
          <span className="workflow-node-inspector__run-label">执行身份</span>
          <strong className="workflow-node-inspector__run-value">{readString(props.data, 'workflowExecutionId') || '尚未创建'}</strong>
        </div>
        {itemRuns.length > 0 ? (
          <div className="workflow-node-inspector__run-fact">
            <span className="workflow-node-inspector__run-label">数据项</span>
            <strong className="workflow-node-inspector__run-value">{completedItems}/{totalItems}</strong>
          </div>
        ) : null}
		{configuredItemConcurrency > 0 ? (
			<>
				<div className="workflow-node-inspector__run-fact">
					<span className="workflow-node-inspector__run-label">已启动</span>
					<strong className="workflow-node-inspector__run-value">{startedItems}/{totalItems}</strong>
				</div>
				<div className="workflow-node-inspector__run-fact">
					<span className="workflow-node-inspector__run-label">真实并发</span>
					<strong className="workflow-node-inspector__run-value">{activeItems}/{configuredItemConcurrency} · 峰值 {peakActiveItems}</strong>
				</div>
			</>
		) : null}
        {pinnedNodeRunId ? (
          <div className="workflow-node-inspector__run-fact">
            <span className="workflow-node-inspector__run-label">测试数据</span>
            <strong className="workflow-node-inspector__run-value">固定自 {pinnedNodeRunId}</strong>
          </div>
        ) : null}
      </div>
      <div className="workflow-node-inspector__run-actions">
        <p className="workflow-node-inspector__run-explanation">
          {trigger
            ? '从此入口运行全部已连接节点；每个节点的输入、输出、错误与逐项结果都会按本次执行永久归档。'
            : '执行到此节点会从唯一触发器开始，自动补跑全部必要上游，并在当前节点完成后停止；不会执行它后面的节点。'}
        </p>
        {operation === 'human_approval' && currentStatus === 'waiting_external' ? (
          <div className="workflow-node-inspector__approval-actions">
            <Button
              className="workflow-node-inspector__button workflow-node-inspector__button--primary"
              leftSection={<IconCheck className="workflow-node-inspector__button-icon" size={15} />}
              loading={responding}
              disabled={props.readOnly}
              onClick={() => void respondToApproval('approved')}
            >
              批准并继续
            </Button>
            <Button
              className="workflow-node-inspector__button"
              variant="default"
              leftSection={<IconX className="workflow-node-inspector__button-icon" size={15} />}
              loading={responding}
              disabled={props.readOnly}
              onClick={() => void respondToApproval('rejected')}
            >
              拒绝并继续
            </Button>
          </div>
        ) : null}
        {trigger ? (
          <Button className="workflow-node-inspector__button" variant="default" leftSection={<IconCheck className="workflow-node-inspector__button-icon" size={15} />} onClick={validate}>
            校验工作流
          </Button>
        ) : null}
        {trigger && (workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY || workflowKey === AGENT_WORKFLOW_KEY) ? (
          <Button
            className="workflow-node-inspector__button"
            variant="default"
            leftSection={<IconRefresh className="workflow-node-inspector__button-icon" size={15} />}
            disabled={props.readOnly}
            onClick={() => {
              try {
                const count = workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY
                  ? restoreVideoWorkflowDefaultConnections(workflowInstanceId)
                  : restoreAgentWorkflowDefaultConnections(workflowInstanceId)
                toast(count > 0 ? '已重建默认连接并更新端口合同' : '默认连接已经完整', 'success')
              } catch (error: unknown) {
                toast(error instanceof Error ? error.message : '重建默认连接失败', 'error')
              }
            }}
          >
            重建默认连接
          </Button>
        ) : null}
        {trigger
          && workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY
          && needsVideoWorkflowCanvasDefinitionUpgrade(props.data) ? (
            <Button
              className="workflow-node-inspector__button"
              variant="default"
              leftSection={<IconRefresh className="workflow-node-inspector__button-icon" size={15} />}
              disabled={props.readOnly}
              onClick={() => {
                try {
                  const result = upgradeVideoWorkflowCanvasDefinition(workflowInstanceId)
                  toast(
                    `已升级 ${result.upgradedNodeCount} 个节点合同，新增 ${result.createdEdgeCount} 条连接，移除 ${result.deletedEdgeCount} 条旧连接`,
                    'success',
                  )
                } catch (error: unknown) {
                  toast(error instanceof Error ? error.message : '升级工作流定义失败', 'error')
                }
              }}
            >
              升级到当前模板
            </Button>
          ) : null}
        {trigger ? (
          <Button
            className="workflow-node-inspector__button workflow-node-inspector__button--primary"
            leftSection={<IconPlayerPlay className="workflow-node-inspector__button-icon" size={15} />}
            disabled={props.readOnly}
            onClick={() => {
              try {
                if (workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY) runVideoWorkflow(props.nodeId)
                else if (workflowKey === AGENT_WORKFLOW_KEY) runAgentWorkflow(props.nodeId)
                else throw new Error('未注册工作流执行器：' + workflowKey)
              } catch (error: unknown) {
                toast(error instanceof Error ? error.message : '工作流运行失败', 'error')
              }
            }}
          >
            {workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY
              ? promptOnly ? '运行提示词工作流（不生成媒体）' : '真实生成媒体'
              : '运行工作流'}
          </Button>
        ) : null}
        {!trigger && workflowKey === AGENT_WORKFLOW_KEY ? (
          <Button
            className="workflow-node-inspector__button workflow-node-inspector__button--primary"
            leftSection={<IconPlayerPlay className="workflow-node-inspector__button-icon" size={15} />}
            disabled={props.readOnly || !triggerNodeId}
            onClick={() => {
              try {
                if (!triggerNodeId) throw new Error('当前工作流缺少唯一可达触发器')
                runAgentWorkflow(triggerNodeId, props.nodeId)
              } catch (error: unknown) {
                toast(error instanceof Error ? error.message : '执行到当前节点失败', 'error')
              }
            }}
          >
            执行到此节点
          </Button>
        ) : null}
        {!trigger && workflowKey === AGENT_WORKFLOW_KEY ? (
          <Button
            className="workflow-node-inspector__button"
            variant="default"
            leftSection={<IconRefresh className="workflow-node-inspector__button-icon" size={15} />}
            disabled={props.readOnly || !triggerNodeId || !sourceExecutionId}
            onClick={() => {
              try {
                if (!triggerNodeId) throw new Error('当前工作流缺少唯一可达触发器')
                if (!sourceExecutionId) throw new Error('当前节点还没有可用于局部重放的持久执行')
                runAgentWorkflow(triggerNodeId, undefined, {
                  sourceExecutionId,
                  startFromNodeId: props.nodeId,
                })
              } catch (error: unknown) {
                toast(error instanceof Error ? error.message : '从当前节点重放失败', 'error')
              }
            }}
          >
            从此节点重新运行
          </Button>
        ) : null}
        {supportsWorkflowNodeLocalTest(operation) ? (
          <Button
            className="workflow-node-inspector__button"
            variant="default"
            leftSection={<IconTestPipe className="workflow-node-inspector__button-icon" size={15} />}
            loading={testing}
            disabled={props.readOnly}
            onClick={() => void runLocalNodeTest()}
          >
            {operation === 'javascript' ? '仅隔离测试 JavaScript' : '仅预览当前静态节点'}
          </Button>
        ) : null}
        {itemRuns.length > 0 ? (
          <Button
            className="workflow-node-inspector__button"
            variant="default"
            leftSection={<IconBinaryTree className="workflow-node-inspector__button-icon" size={15} />}
            onClick={() => {
              const expanded = props.data.workflowRuntimeExpanded === true
              useRFStore.getState().updateNodeData(props.nodeId, { workflowRuntimeExpanded: !expanded })
              toast(expanded ? '已收起逐项运行投影' : '已在节点旁铺开本次逐项运行', 'success')
            }}
          >
            {props.data.workflowRuntimeExpanded === true ? '收起逐项运行' : '铺开逐项运行'}
          </Button>
        ) : null}
        {videoItems.length > 0 ? (
          <Button
            className="workflow-node-inspector__button"
            variant="default"
            leftSection={<IconMovie className="workflow-node-inspector__button-icon" size={15} />}
            disabled={props.readOnly}
            onClick={() => {
              try {
                const result = materializeWorkflowVideoItems(props.nodeId)
                toast(result.created > 0
                  ? `已固化 ${result.created} 个可编辑视频节点`
                  : `${result.existing} 个视频节点已经固化，无需重复创建`, 'success')
              } catch (error: unknown) {
                toast(error instanceof Error ? error.message : '固化视频节点失败', 'error')
              }
            }}
          >
            固化为视频节点
          </Button>
        ) : null}
        {textItems.length > 0 ? (
          <Button
            className="workflow-node-inspector__button"
            variant="default"
            leftSection={<IconTypography className="workflow-node-inspector__button-icon" size={15} />}
            disabled={props.readOnly}
            onClick={() => {
              try {
                const result = materializeWorkflowTextItems(props.nodeId)
                toast(result.created > 0
                  ? `已固化 ${result.created} 个可编辑文本节点`
                  : `${result.existing} 个文本节点已经固化，无需重复创建`, 'success')
              } catch (error: unknown) {
                toast(error instanceof Error ? error.message : '固化文本节点失败', 'error')
              }
            }}
          >
            固化为文本节点
          </Button>
        ) : null}
      </div>
      {itemRuns.length > 0 ? (
        <section className="workflow-node-inspector__section" aria-label="本次逐项结果">
          <h3 className="workflow-node-inspector__section-title">本次逐项结果</h3>
          <ol className="workflow-node-inspector__item-run-list">
            {itemRuns.map((item) => (
              <li className={'workflow-node-inspector__item-run workflow-node-inspector__item-run--' + item.status} key={item.runtimeNodeId}>
                <span className="workflow-node-inspector__item-run-index">#{item.index + 1}</span>
                <strong className="workflow-node-inspector__item-run-id">{item.itemId}</strong>
                <span className="workflow-node-inspector__item-run-status">{item.status === 'success' ? '完成' : item.status === 'waiting_external' ? '等待结果' : '失败'}</span>
                <span className="workflow-node-inspector__item-run-artifacts">{item.artifactCount} 产物{item.videoUrl ? ' · 视频' : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {operation === 'javascript' ? (
        <p className="workflow-node-inspector__warning">浏览器隔离测试不等于多人生产安全。整图本地运行需设置 WORKFLOW_LOCAL_JAVASCRIPT_ENABLED=true，且只允许管理员可信脚本。</p>
      ) : null}
    </div>
  )
}

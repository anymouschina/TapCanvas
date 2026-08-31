import React from 'react'
import { ActionIcon, Button, NumberInput, Select, Switch, Tooltip } from '@mantine/core'
import {
  parseWorkflowTriggerSpec,
  WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX,
  WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN,
  WORKFLOW_CONCURRENCY_MAX,
  WORKFLOW_CONCURRENCY_MIN,
  WORKFLOW_NODE_EXECUTION_MODES,
  type WorkflowNodeExecutionMode,
} from '@tapcanvas/workflow-kernel-protocol'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import { toast } from '../../ui/toast'
import { useRFStore } from '../store'
import {
  bindVideoWorkflowSourceGroup,
  listWorkflowSourceGroups,
  VIDEO_WORKFLOW_MAX_CLIPS_MAX,
  VIDEO_WORKFLOW_MAX_CLIPS_MIN,
} from '../videoWorkflowCanvasTemplate'
import { dataRecord, PersistedWorkflowField, nodeOperation, readString } from './workflowNodeInspectorShared'
import { WorkflowAgentDefinitionSelect } from './WorkflowAgentDefinitionSelect'
import { findModelOptionByIdentifier, getModelOptionRequestAlias, useModelOptionsState } from '../../config/useModelOptions'
import { parseImageModelCatalogConfig, parseVideoModelCatalogConfig } from '../../config/modelCatalogMeta'
import { WorkflowScheduleTriggerConfiguration } from './WorkflowScheduleTriggerConfiguration'
import { WorkflowTextInputConfiguration } from './WorkflowTextInputConfiguration'
import { WorkflowExternalTriggerConfiguration } from './WorkflowExternalTriggerConfiguration'
import { WorkflowAgentContextOverview } from './WorkflowAgentContextOverview'
import { WorkflowCodeEditorField } from './WorkflowCodeEditorField'

const AGENT_OUTPUT_ARTIFACT_OPTIONS = [
  { value: 'tapcanvas.text/v1', label: '文本' },
  { value: 'tapcanvas.json/v1', label: '结构化 JSON' },
  { value: 'tapcanvas.beat-sheet/v2', label: 'BeatSheet' },
  { value: 'tapcanvas.clip-contracts/v1', label: 'Clip 合同' },
  { value: 'tapcanvas.clip-prompts/v2', label: 'Clip 提示词' },
  { value: 'tapcanvas.video-prompt/v1', label: '视频提示词' },
  { value: 'tapcanvas.image-prompt-package/v1', label: '图片提示词包' },
  { value: 'tapcanvas.image/v1', label: '真实图片资产' },
  { value: 'tapcanvas.video/v1', label: '真实视频资产' },
] as const

const AGENT_OUTPUT_ENCODING_OPTIONS = [
  { value: 'plain_text', label: '纯文本 · 直接输出正文' },
  { value: 'json_object', label: 'Structured Parser · JSON 对象' },
  { value: 'json_artifact', label: 'Structured Parser · JSON 产物对象' },
  { value: 'json_array', label: 'Structured Parser · JSON 数组' },
] as const

const EXECUTION_MODE_OPTIONS: readonly Readonly<{ value: WorkflowNodeExecutionMode; label: string }>[] = [
  { value: 'once', label: '单次 · 整体输入' },
  { value: 'each', label: '逐项 · 列表自动映射' },
  { value: 'collect', label: '汇总 · 等待全部数据项' },
]

const ITEM_CONCURRENCY_OPTIONS = Array.from(
  { length: WORKFLOW_CONCURRENCY_MAX - WORKFLOW_CONCURRENCY_MIN + 1 },
  (_, index) => {
    const value = WORKFLOW_CONCURRENCY_MIN + index
    return { value: String(value), label: value === 1 ? '1 · 顺序执行' : `${value} · 最多并行 ${value} 项` }
  },
)

function ExecutionModeField(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  const spec = dataRecord(props.data.workflowAtomicSpec)
  const value = readString(spec, 'executionMode')
  const executionMode = WORKFLOW_NODE_EXECUTION_MODES.find((mode) => mode === value) ?? null
  const rawItemConcurrency = spec.itemConcurrency
  const itemConcurrency = rawItemConcurrency === undefined
    ? 1
    : typeof rawItemConcurrency === 'number'
      && Number.isInteger(rawItemConcurrency)
      && rawItemConcurrency >= WORKFLOW_CONCURRENCY_MIN
      && rawItemConcurrency <= WORKFLOW_CONCURRENCY_MAX
      ? rawItemConcurrency
      : null
  return (
    <div className="workflow-node-inspector__execution-settings">
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="数据项执行方式"
        aria-label="数据项执行方式"
        value={executionMode}
        placeholder="必须选择执行方式"
        disabled={props.readOnly}
        data={[...EXECUTION_MODE_OPTIONS]}
        onChange={(nextValue) => {
          const nextExecutionMode = WORKFLOW_NODE_EXECUTION_MODES.find((mode) => mode === nextValue)
          if (!nextExecutionMode) return
          useRFStore.getState().updateNodeData(props.nodeId, {
            workflowAtomicSpec: { ...spec, executionMode: nextExecutionMode },
          })
        }}
      />
      {executionMode === 'each' ? (
        <Select
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
          label="逐项并发上限"
          aria-label="逐项并发上限"
          value={itemConcurrency === null ? null : String(itemConcurrency)}
          placeholder="必须选择 1–8"
          disabled={props.readOnly}
          data={ITEM_CONCURRENCY_OPTIONS}
          onChange={(nextValue) => {
            const nextConcurrency = nextValue ? Number(nextValue) : Number.NaN
            if (!Number.isInteger(nextConcurrency)
              || nextConcurrency < WORKFLOW_CONCURRENCY_MIN
              || nextConcurrency > WORKFLOW_CONCURRENCY_MAX) return
            useRFStore.getState().updateNodeData(props.nodeId, {
              workflowAtomicSpec: { ...spec, itemConcurrency: nextConcurrency },
            })
          }}
        />
      ) : null}
    </div>
  )
}

function VideoGenerationConfiguration(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
  includeDuration?: boolean
}>): React.JSX.Element {
  const catalog = useModelOptionsState('video')
  const selectedValue = readString(props.data, 'workflowVideoModelSelection')
  const selectedOption = catalog.options.find((option) => option.value === selectedValue) ?? null
  const config = selectedOption ? parseVideoModelCatalogConfig(selectedOption.meta) : null
  const duration = props.data.workflowVideoDurationSeconds
  const durationValue = typeof duration === 'number' && Number.isInteger(duration) && duration > 0 ? String(duration) : null
  const sizeOptions = config?.sizeOptions ?? []
  const resolutionOptions = config?.resolutionOptions ?? []
  return (
    <div className="workflow-node-inspector__tab-content">
      <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="视频模型"
        aria-label="视频模型"
        value={selectedValue || null}
        placeholder={catalog.loading ? '正在读取实时模型目录' : '必须选择已启用模型'}
        disabled={props.readOnly || catalog.loading || Boolean(catalog.error)}
        searchable
        data={catalog.options.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(value) => {
          if (!value) return
          const modelKey = getModelOptionRequestAlias(catalog.options, value)
          if (!modelKey) {
            toast('所选视频模型缺少可执行请求键', 'error')
            return
          }
          useRFStore.getState().updateNodeData(props.nodeId, {
            workflowVideoModelSelection: value,
            workflowVideoModelKey: modelKey,
            workflowVideoDurationSeconds: undefined,
            workflowVideoResolution: undefined,
            workflowVideoAspectRatio: undefined,
          })
        }}
      />
      {catalog.error ? (
        <div className="workflow-node-inspector__catalog-error">
          <p className="workflow-node-inspector__help workflow-node-inspector__help--error">实时模型目录读取失败：{catalog.error.message}</p>
          <Button className="workflow-node-inspector__button" variant="subtle" size="compact-xs" onClick={catalog.retry}>重试目录</Button>
        </div>
      ) : null}
      {selectedOption && !config ? <p className="workflow-node-inspector__help workflow-node-inspector__help--error">该模型未声明视频参数合同，不能执行付费提交。</p> : null}
      {props.includeDuration !== false ? <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="时长"
        aria-label="视频时长"
        value={durationValue}
        placeholder="必须选择模型支持的时长"
        disabled={props.readOnly || !config}
        data={(config?.durationOptions ?? []).map((option) => ({ value: String(option.value), label: option.label }))}
        onChange={(value) => {
          const seconds = value ? Number(value) : Number.NaN
          if (!Number.isInteger(seconds) || seconds <= 0) return
          useRFStore.getState().updateNodeData(props.nodeId, { workflowVideoDurationSeconds: seconds })
        }}
      /> : null}
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="分辨率"
        aria-label="视频分辨率"
        value={readString(props.data, 'workflowVideoResolution') || null}
        placeholder="必须选择模型支持的分辨率"
        disabled={props.readOnly || !config}
        data={resolutionOptions.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(value) => {
          if (value) useRFStore.getState().updateNodeData(props.nodeId, { workflowVideoResolution: value })
        }}
      />
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="画面比例"
        aria-label="视频画面比例"
        value={readString(props.data, 'workflowVideoAspectRatio') || null}
        placeholder="必须选择模型支持的比例"
        disabled={props.readOnly || !config}
        data={sizeOptions.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(value) => {
          if (value) useRFStore.getState().updateNodeData(props.nodeId, { workflowVideoAspectRatio: value })
        }}
      />
      <p className="workflow-node-inspector__help">每个数据项只提交一次。供应商受理后节点显示等待中，后台仅查询原任务；拿到真实视频 URL 后才计为完成。</p>
    </div>
  )
}

function ImageGenerationConfiguration(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  const catalog = useModelOptionsState('image')
  const persistedSelection = readString(props.data, 'workflowImageModelSelection')
  const persistedModelKey = readString(props.data, 'workflowImageModelKey')
  const selectedValue = persistedSelection || persistedModelKey
  const selectedOption = findModelOptionByIdentifier(catalog.options, selectedValue)
  const config = selectedOption ? parseImageModelCatalogConfig(selectedOption.meta) : null
  const renderedOptions = catalog.options.map((option) => ({ value: option.value, label: option.label }))
  if (selectedValue && !selectedOption) {
    renderedOptions.unshift({ value: selectedValue, label: `${selectedValue} · 当前持久配置` })
  }
  return (
    <div className="workflow-node-inspector__tab-content">
      <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="图片模型"
        aria-label="图片模型"
        value={selectedValue || null}
        placeholder={catalog.loading ? '正在读取实时模型目录' : '必须选择已启用模型'}
        disabled={props.readOnly || catalog.loading || Boolean(catalog.error)}
        searchable
        data={renderedOptions}
        onChange={(value) => {
          if (!value) return
          const modelKey = getModelOptionRequestAlias(catalog.options, value)
          const option = findModelOptionByIdentifier(catalog.options, value)
          const nextConfig = option ? parseImageModelCatalogConfig(option.meta) : null
          if (!modelKey || !nextConfig) {
            toast('所选图片模型缺少可执行参数合同', 'error')
            return
          }
          useRFStore.getState().updateNodeData(props.nodeId, {
            workflowImageModelSelection: value,
            workflowImageModelKey: modelKey,
            workflowImageAspectRatio: nextConfig.defaultAspectRatio ?? '',
            workflowImageSize: nextConfig.defaultImageSize ?? '',
          })
        }}
      />
      {catalog.error ? (
        <div className="workflow-node-inspector__catalog-error">
          <p className="workflow-node-inspector__help workflow-node-inspector__help--error">实时模型目录读取失败：{catalog.error.message}</p>
          <Button className="workflow-node-inspector__button" variant="subtle" size="compact-xs" onClick={catalog.retry}>重试目录</Button>
        </div>
      ) : null}
      {selectedOption && !config ? <p className="workflow-node-inspector__help workflow-node-inspector__help--error">该模型未声明图片参数合同，不能执行付费提交。</p> : null}
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="画面比例"
        aria-label="图片画面比例"
        value={readString(props.data, 'workflowImageAspectRatio') || null}
        placeholder="必须选择模型支持的比例"
        disabled={props.readOnly || !config}
        data={(config?.aspectRatioOptions ?? []).map((option) => ({ value: option.value, label: option.label }))}
        onChange={(value) => {
          if (value) useRFStore.getState().updateNodeData(props.nodeId, { workflowImageAspectRatio: value })
        }}
      />
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="图片尺寸"
        aria-label="图片尺寸"
        value={readString(props.data, 'workflowImageSize') || null}
        placeholder="必须选择模型支持的尺寸"
        disabled={props.readOnly || !config}
        data={(config?.imageSizeOptions ?? []).map((option) => ({ value: option.value, label: option.label }))}
        onChange={(value) => {
          if (value) useRFStore.getState().updateNodeData(props.nodeId, { workflowImageSize: value })
        }}
      />
      <p className="workflow-node-inspector__help">本节点只消费上游 Agent 的结构化 prompt / negativePrompt，并按已保存的资产 ID 与职责提交图片任务；供应商受理后只等待同一 taskId。</p>
    </div>
  )
}

function AgentModelConfiguration(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  const catalog = useModelOptionsState()
  const persistedSelection = readString(props.data, 'workflowAgentModelSelection')
  const persistedModelKey = readString(props.data, 'workflowAgentModelKey')
  const selectedValue = persistedSelection || persistedModelKey
  const selectedOption = findModelOptionByIdentifier(catalog.options, selectedValue)
  const renderedOptions = catalog.options.map((option) => ({ value: option.value, label: option.label }))
  if (selectedValue && !selectedOption) {
    renderedOptions.unshift({ value: selectedValue, label: `${selectedValue} · 当前持久配置` })
  }
  return (
    <div className="workflow-node-inspector__agent-model">
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="文本模型"
        aria-label="Agent 文本模型"
        value={selectedValue || null}
        placeholder={catalog.loading ? '正在读取实时模型目录' : '必须选择已启用文本模型'}
        disabled={props.readOnly || catalog.loading || Boolean(catalog.error)}
        searchable
        data={renderedOptions}
        onChange={(value) => {
          if (!value) return
          const modelKey = getModelOptionRequestAlias(catalog.options, value)
          if (!modelKey) {
            toast('所选文本模型缺少可执行请求键', 'error')
            return
          }
          useRFStore.getState().updateNodeData(props.nodeId, {
            workflowAgentModelSelection: value,
            workflowAgentModelKey: modelKey,
          })
        }}
      />
      {catalog.error ? (
        <div className="workflow-node-inspector__catalog-error">
          <p className="workflow-node-inspector__help workflow-node-inspector__help--error">实时文本模型目录读取失败：{catalog.error.message}</p>
          <Button className="workflow-node-inspector__button" variant="subtle" size="compact-xs" onClick={catalog.retry}>重试目录</Button>
        </div>
      ) : null}
      {selectedValue && !selectedOption && !catalog.loading && !catalog.error ? (
        <p className="workflow-node-inspector__help workflow-node-inspector__help--error">当前持久模型不在实时启用目录中；请重新选择后再运行。</p>
      ) : null}
    </div>
  )
}

function KnowledgeSearchConfiguration(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  return (
    <div className="workflow-node-inspector__tab-content">
      <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
      <PersistedWorkflowField
        nodeId={props.nodeId}
        dataKey="workflowKnowledgeQuery"
        label="查询文本"
        placeholder="也可从 query 端口连接上游文本"
        value={readString(props.data, 'workflowKnowledgeQuery')}
        readOnly={props.readOnly}
        multiline
      />
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="角色范围提示"
        aria-label="知识检索角色范围提示"
        value={readString(props.data, 'workflowKnowledgeRoleScope') || null}
        placeholder="不限定"
        clearable
        disabled={props.readOnly}
        data={[
          { value: 'director', label: '导演' },
          { value: 'storyboard', label: '分镜' },
          { value: 'generation', label: '生成' },
          { value: 'editor', label: '剪辑' },
          { value: 'post', label: '后期' },
          { value: 'qa', label: '质检' },
        ]}
        onChange={(value) => useRFStore.getState().updateNodeData(props.nodeId, { workflowKnowledgeRoleScope: value ?? '' })}
      />
      <PersistedWorkflowField
        nodeId={props.nodeId}
        dataKey="workflowKnowledgeDomain"
        label="领域范围提示"
        placeholder="默认不缩小召回范围"
        value={readString(props.data, 'workflowKnowledgeDomain')}
        readOnly={props.readOnly}
      />
      <NumberInput
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
        label="候选数量"
        aria-label="知识检索候选数量"
        value={typeof props.data.workflowKnowledgeLimit === 'number' ? props.data.workflowKnowledgeLimit : 5}
        min={1}
        max={12}
        allowDecimal={false}
        disabled={props.readOnly}
        onChange={(value) => {
          if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12) {
            useRFStore.getState().updateNodeData(props.nodeId, { workflowKnowledgeLimit: value })
          }
        }}
      />
      <Switch
        className="workflow-node-inspector__switch"
        classNames={{ label: 'workflow-node-inspector__switch-label', track: 'workflow-node-inspector__switch-track' }}
        label="严格应用角色与领域筛选"
        checked={props.data.workflowKnowledgeStrictFilters === true}
        disabled={props.readOnly}
        onChange={(event) => useRFStore.getState().updateNodeData(props.nodeId, { workflowKnowledgeStrictFilters: event.currentTarget.checked })}
      />
      <p className="workflow-node-inspector__help">默认把角色与领域当作召回提示，不自动缩小范围。节点只产出候选预览；候选语义选择由下游 Agent 完成。</p>
    </div>
  )
}

function readRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  ))
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (
    typeof item === 'string' && item.trim() ? [item.trim()] : []
  ))
}

type RuntimeReferencePanelItem = Readonly<{
  identity: string
  referenceKey: string
  name: string
  description: string
  evidenceState: 'actual_read'
  physicalExecutionIds: readonly string[]
  evidence: readonly Record<string, unknown>[]
}>

function runtimeReferenceItems(value: unknown): readonly RuntimeReferencePanelItem[] {
  return readRecordArray(value).flatMap((item) => {
    const identity = readString(item, 'identity')
    const referenceKey = readString(item, 'referenceKey')
    if (!identity || !referenceKey) return []
    return [{
      identity,
      referenceKey,
      name: readString(item, 'name') || referenceKey,
      description: readString(item, 'description'),
      evidenceState: 'actual_read',
      physicalExecutionIds: readStringArray(item.physicalExecutionIds),
      evidence: readRecordArray(item.evidence),
    }]
  })
}

function referenceEvidenceLines(item: RuntimeReferencePanelItem): readonly string[] {
  return item.evidence.flatMap((evidence) => {
    const source = readString(evidence, 'source') || readString(evidence, 'cardId') || readString(evidence, 'resource')
    const hash = readString(evidence, 'contentHash')
    const urls = readStringArray(evidence.sourceUrls)
    const primary = [source, hash ? `hash ${hash.slice(0, 12)}` : ''].filter(Boolean).join(' · ')
    return [primary, ...urls].filter(Boolean)
  })
}

function WorkflowRuntimeReferenceConfiguration(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
}>): React.JSX.Element {
  const kind = readString(props.data, 'workflowRuntimeReferenceKind')
  const items = React.useMemo(
    () => runtimeReferenceItems(props.data.workflowRuntimeReferenceItems),
    [props.data.workflowRuntimeReferenceItems],
  )
  const kindLabel = kind === 'skill' ? 'Skills' : '知识库'
  return (
    <div className="workflow-node-inspector__tab-content">
      <div className="workflow-node-inspector__definition">
        <span className="workflow-node-inspector__definition-label">访问范围</span>
        <strong className="workflow-node-inspector__definition-value">
          完整{kindLabel}目录 · 按当前任务自主检索
        </strong>
      </div>
      <div className="workflow-node-inspector__definition">
        <span className="workflow-node-inspector__definition-label">所属 Agent</span>
        <strong className="workflow-node-inspector__definition-value">
          {readString(props.data, 'workflowRuntimeReferenceOwnerNodeId') || '归属证据缺失'}
        </strong>
      </div>
      {items.length === 0 ? (
        <p className="workflow-node-inspector__help">当前 Agent 可检索全部{kindLabel}，但本轮还没有真实正文读取回执。目录可见和候选召回不会冒充已读取。</p>
      ) : items.map((item) => {
        const evidenceLines = referenceEvidenceLines(item)
        return (
          <section className="workflow-node-inspector__reference-item" key={item.identity}>
            <header className="workflow-node-inspector__reference-item-header">
              <div className="workflow-node-inspector__reference-item-identity">
                <span className="workflow-node-inspector__reference-item-state">
                  本轮实际读取
                </span>
                <h3 className="workflow-node-inspector__reference-item-name">{item.name}</h3>
              </div>
            </header>
            <div className="workflow-node-inspector__definition">
              <span className="workflow-node-inspector__definition-label">name</span>
              <strong className="workflow-node-inspector__definition-value">{item.name}</strong>
            </div>
            <div className="workflow-node-inspector__definition">
              <span className="workflow-node-inspector__definition-label">description</span>
              <strong className="workflow-node-inspector__definition-value">
                {item.description || '本次读取回执未提供 description。'}
              </strong>
            </div>
            <div className="workflow-node-inspector__definition">
              <span className="workflow-node-inspector__definition-label">元数据来源</span>
              <strong className="workflow-node-inspector__definition-value">本轮 executionProvenance</strong>
            </div>
            <div className="workflow-node-inspector__definition">
              <span className="workflow-node-inspector__definition-label">引用身份</span>
              <strong className="workflow-node-inspector__definition-value">{item.identity}</strong>
            </div>
            <div className="workflow-node-inspector__definition">
              <span className="workflow-node-inspector__definition-label">物理执行</span>
              <strong className="workflow-node-inspector__definition-value">{item.physicalExecutionIds.join(' · ') || '本轮尚无实际读取'}</strong>
            </div>
            {evidenceLines.map((line, index) => (
              <div className="workflow-node-inspector__definition" key={`${line}-${index}`}>
                <span className="workflow-node-inspector__definition-label">{index === 0 ? '读取证据' : '来源'}</span>
                <strong className="workflow-node-inspector__definition-value">{line}</strong>
              </div>
            ))}
          </section>
        )
      })}
      <p className="workflow-node-inspector__help">所有 Agent 默认拥有完整目录的检索权限；这里只展示本轮真实读取证据，不提供挂载、停用或解除挂载配置。</p>
    </div>
  )
}

export function ConfigurationTab(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  const operation = nodeOperation(props.data)
  const workflowKey = readString(props.data, 'workflowKey')
  const workflowInstanceId = readString(props.data, 'workflowInstanceId')
  const sourceMode = readString(props.data, 'workflowSourceMode') || 'canvas_group'
  const sourceGroupId = readString(props.data, 'sourceGroupId')
  const sourceOptions = listWorkflowSourceGroups(useRFStore.getState().nodes)

  if (props.data.workflowRuntimeReference === true) {
    return <WorkflowRuntimeReferenceConfiguration nodeId={props.nodeId} data={props.data} />
  }

  if (props.data.kind === 'workflowTrigger') {
    const triggerDraft = dataRecord(props.data.workflowTriggerSpec)
    if (triggerDraft.kind === 'schedule') {
      return <WorkflowScheduleTriggerConfiguration nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
    }
    if (triggerDraft.kind === 'webhook' || triggerDraft.kind === 'event') {
      return <WorkflowExternalTriggerConfiguration nodeId={props.nodeId} spec={props.data.workflowTriggerSpec} readOnly={props.readOnly} />
    }
    const trigger = parseWorkflowTriggerSpec(props.data.workflowTriggerSpec)
    return (
      <div className="workflow-node-inspector__tab-content">
        <div className="workflow-node-inspector__definition">
          <span className="workflow-node-inspector__definition-label">触发类型</span>
          <strong className="workflow-node-inspector__definition-value">
            {trigger.success ? trigger.data.kind : '配置无效'}
          </strong>
        </div>
        <p className="workflow-node-inspector__help">
          {trigger.success && trigger.data.kind === 'manual'
            ? '点击“运行”页可校验、测试或发起真实工作流。'
            : trigger.success
              ? `已保存并启用 ${trigger.data.kind} 触发合同。`
              : trigger.error.message}
        </p>
      </div>
    )
  }

  if (workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY && operation === 'canvas_source') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <Select
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
          label="来源模式"
          aria-label="一键成片来源模式"
          value={sourceMode}
          disabled={props.readOnly}
          data={[
            { value: 'project_context', label: '当前项目上下文' },
            { value: 'canvas_group', label: '真实画布组' },
            { value: 'inline_text', label: '测试文本' },
          ]}
          onChange={(value) => {
            if (!value) return
            useRFStore.getState().updateNodeData(props.nodeId, { workflowSourceMode: value })
          }}
        />
        {sourceMode === 'canvas_group' ? (
          <Select
            className="workflow-node-inspector__field"
            classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
            label="来源组"
            aria-label="绑定一键成片来源组"
            placeholder="选择真实画布组"
            searchable
            nothingFoundMessage="当前画布没有可绑定的普通组"
            value={sourceGroupId || null}
            disabled={props.readOnly}
            data={sourceOptions}
            onChange={(value) => {
              if (!value) return
              try {
                bindVideoWorkflowSourceGroup(workflowInstanceId, value)
                toast('已绑定真实画布组', 'success')
              } catch (error: unknown) {
                toast(error instanceof Error ? error.message : '绑定来源组失败', 'error')
              }
            }}
          />
        ) : sourceMode === 'inline_text' ? (
          <PersistedWorkflowField
            nodeId={props.nodeId}
            dataKey="workflowSourceText"
            label="测试文本"
            placeholder="输入故事、脚本或视频需求；prompt-only 测试不会生成媒体"
            value={readString(props.data, 'workflowSourceText')}
            readOnly={props.readOnly}
            multiline
          />
        ) : (
          <p className="workflow-node-inspector__help">运行时读取调用者当前 ProjectContext：优先使用明确选中的节点；未选择时，当前画布必须只有一个就绪文本来源。图片和视频资产继续通过稳定 asset ID 动态解析。</p>
        )}
      </div>
    )
  }

  if (workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY && operation === 'delivery_contract') {
    const targetDuration = props.data.workflowTargetDurationSeconds
    const catalog = useModelOptionsState('video')
    const persistedSelection = readString(props.data, 'workflowVideoModelSelection')
    const persistedModelKey = readString(props.data, 'workflowVideoModelKey')
    const selectedValue = persistedSelection || persistedModelKey
    const selectedOption = findModelOptionByIdentifier(catalog.options, selectedValue)
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <Select
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
          label="时长能力模型"
          aria-label="一键成片时长能力模型"
          value={selectedValue || null}
          placeholder={catalog.loading ? '正在读取实时模型目录' : '必须选择已启用视频模型'}
          disabled={props.readOnly || catalog.loading || Boolean(catalog.error)}
          searchable
          data={catalog.options.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(value) => {
            if (!value) return
            const modelKey = getModelOptionRequestAlias(catalog.options, value)
            if (!modelKey) {
              toast('所选视频模型缺少可执行请求键', 'error')
              return
            }
            useRFStore.getState().updateNodeData(props.nodeId, {
              workflowVideoModelSelection: value,
              workflowVideoModelKey: modelKey,
            })
          }}
        />
        {catalog.error ? <p className="workflow-node-inspector__help workflow-node-inspector__help--error">实时模型目录读取失败：{catalog.error.message}</p> : null}
        {selectedValue && !selectedOption && !catalog.loading && !catalog.error ? (
          <p className="workflow-node-inspector__help workflow-node-inspector__help--error">当前时长能力模型不在实时启用目录中，请重新选择。</p>
        ) : null}
        <NumberInput
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
          label="成片总时长（秒）"
          aria-label="一键成片目标总时长"
          value={typeof targetDuration === 'number' && Number.isInteger(targetDuration) && targetDuration > 0 ? targetDuration : ''}
          min={1}
          max={86_400}
          allowDecimal={false}
          disabled={props.readOnly}
          onChange={(value) => {
            if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return
            useRFStore.getState().updateNodeData(props.nodeId, { workflowTargetDurationSeconds: value })
          }}
        />
        <p className="workflow-node-inspector__help">运行时读取费用节点所选视频模型的实时合法时长，并以最少 Clip 优先吃满最大档。总时长无法被模型档位精确组成时会明确报错，不会取整或补时长。</p>
      </div>
    )
  }

  if (operation === 'text_input') {
    return (
      <WorkflowTextInputConfiguration
        nodeId={props.nodeId}
        data={props.data}
        readOnly={props.readOnly}
        executionModeField={<ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />}
      />
    )
  }

  if (operation === 'javascript') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <WorkflowCodeEditorField
          nodeId={props.nodeId}
          dataKey="workflowJavascriptCode"
          label="JavaScript"
          placeholder={'使用 input 读取上游值，并显式 return JSON 值。\n\n例如：\nreturn { text: String(input).toUpperCase() }'}
          value={readString(props.data, 'workflowJavascriptCode')}
          readOnly={props.readOnly}
        />
        <p className="workflow-node-inspector__help">单节点测试在浏览器临时 Worker 中执行；整图运行使用管理员显式开启的本地 Node 子进程。后者只适用于可信脚本，不是安全沙箱。</p>
      </div>
    )
  }

  if (operation === 'collection_split') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <Select
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
          label="输入值格式"
          aria-label="集合输入值格式"
          value={props.data.workflowCollectionParseJson === true ? 'json_string' : 'array'}
          disabled={props.readOnly}
          data={[
            { value: 'array', label: 'JSON 数组值' },
            { value: 'json_string', label: '包含 JSON 的文本' },
          ]}
          onChange={(value) => {
            if (!value) return
            useRFStore.getState().updateNodeData(props.nodeId, {
              workflowCollectionParseJson: value === 'json_string',
            })
          }}
        />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowCollectionPath"
          label="数组路径"
          placeholder="留空表示输入本身；例如 result.segments"
          value={readString(props.data, 'workflowCollectionPath')}
          readOnly={props.readOnly}
        />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowCollectionItemIdField"
          label="数据项身份字段"
          placeholder="可选，例如 segmentId；必须是唯一非空字符串"
          value={readString(props.data, 'workflowCollectionItemIdField')}
          readOnly={props.readOnly}
        />
        <p className="workflow-node-inspector__help">本节点只做结构化拆分，不判断章节语义。章节如何拆段由上游 Agent 输出数组；下游“逐项”节点会自动运行一次/项。</p>
      </div>
    )
  }

  if (workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY && operation === 'max_clip') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <NumberInput
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
          label="最大 Clip 数"
          aria-label="最大 Clip 数"
          value={typeof props.data.workflowBeatSheetTakeCount === 'number'
            ? props.data.workflowBeatSheetTakeCount
            : ''}
          placeholder={`${VIDEO_WORKFLOW_MAX_CLIPS_MIN}–${VIDEO_WORKFLOW_MAX_CLIPS_MAX}，必须明确填写`}
          min={VIDEO_WORKFLOW_MAX_CLIPS_MIN}
          max={VIDEO_WORKFLOW_MAX_CLIPS_MAX}
          allowDecimal={false}
          disabled={props.readOnly}
          onChange={(value) => {
            if (typeof value !== 'number'
              || !Number.isInteger(value)
              || value < VIDEO_WORKFLOW_MAX_CLIPS_MIN
              || value > VIDEO_WORKFLOW_MAX_CLIPS_MAX) return
            useRFStore.getState().updateNodeData(props.nodeId, { workflowBeatSheetTakeCount: value })
          }}
        />
        <p className="workflow-node-inspector__help">
          BeatSheet 生成后只冻结前 N 个 Clip。资产、提示词、费用、视频提交、合成与交付都只消费这 N 个；全部完成后工作流成功，不要求继续覆盖章节剩余片段。
        </p>
      </div>
    )
  }

  if (operation === 'video_generate' || operation === 'estimate') {
    return <VideoGenerationConfiguration
      nodeId={props.nodeId}
      data={props.data}
      readOnly={props.readOnly}
      includeDuration={operation === 'video_generate'}
    />
  }

  if (operation === 'image_generate') {
    return <ImageGenerationConfiguration nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
  }

  if (operation === 'knowledge_search') {
    return <KnowledgeSearchConfiguration nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
  }

  if (operation === 'knowledge_read') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowKnowledgeCardId"
          label="知识卡身份"
          placeholder="建议从 Agent 的 card-id 输出端口连接；手工填写时也必须属于上游候选集"
          value={readString(props.data, 'workflowKnowledgeCardId')}
          readOnly={props.readOnly}
        />
        <p className="workflow-node-inspector__help">本节点必须连接 Knowledge Search 的 knowledge-candidates 产物。运行时会校验候选集身份和成员关系，禁止绕过检索直接读默认卡。</p>
      </div>
    )
  }

  if (operation === 'tool_invocation') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowToolInvocationName"
          label="精确工具身份"
          placeholder="例如 tapcanvas_project_context_get"
          value={readString(props.data, 'workflowToolInvocationName')}
          readOnly={props.readOnly}
        />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowToolInvocationArgs"
          label="工具参数 JSON"
          placeholder={'也可从 arguments 端口连接结构化对象。\n例如：\n{\n  "refresh": true\n}'}
          value={readString(props.data, 'workflowToolInvocationArgs') || '{}'}
          readOnly={props.readOnly}
          multiline
          code
        />
        <p className="workflow-node-inspector__help">运行时从当前项目/画布授权目录解析该工具的真实 JSON Schema；未知工具、缺字段、多余字段或类型错误都会在执行前显式失败。</p>
      </div>
    )
  }

  if (operation === 'human_approval') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowHumanPrompt"
          label="审批问题"
          placeholder="说明审批人正在批准什么，以及拒绝意味着什么"
          value={readString(props.data, 'workflowHumanPrompt')}
          readOnly={props.readOnly}
          multiline
        />
        <p className="workflow-node-inspector__help">节点进入持久等待态，不占用 Agent 轮次。批准或拒绝会写入同一节点运行证据，并从该 execution 原位恢复。</p>
      </div>
    )
  }

  if (operation === 'condition') {
    const operator = readString(props.data, 'workflowConditionOperator') || 'equals'
    const requiresExpected = operator === 'equals'
      || operator === 'not_equals'
      || operator === 'greater_than'
      || operator === 'less_than'
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowConditionPointer"
          label="JSON Pointer"
          placeholder="留空检查输入根值；例如 /status 或 /items/0/id"
          value={readString(props.data, 'workflowConditionPointer')}
          readOnly={props.readOnly}
        />
        <Select
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__select-dropdown', option: 'workflow-node-inspector__select-option' }}
          label="结构运算符"
          aria-label="结构运算符"
          data={[
            { value: 'equals', label: '等于' },
            { value: 'not_equals', label: '不等于' },
            { value: 'exists', label: '字段存在' },
            { value: 'is_true', label: '严格为 true' },
            { value: 'is_false', label: '严格为 false' },
            { value: 'greater_than', label: '数值大于' },
            { value: 'less_than', label: '数值小于' },
          ]}
          value={operator}
          disabled={props.readOnly}
          allowDeselect={false}
          onChange={(value) => {
            if (!value) return
            useRFStore.getState().updateNodeData(props.nodeId, { workflowConditionOperator: value })
          }}
        />
        {requiresExpected ? (
          <PersistedWorkflowField
            nodeId={props.nodeId}
            dataKey="workflowConditionExpectedJson"
            label="期望值 JSON"
            placeholder={'例如 true、42、"ready" 或 {"status":"ok"}'}
            value={readString(props.data, 'workflowConditionExpectedJson')}
            readOnly={props.readOnly}
            code
          />
        ) : null}
        <p className="workflow-node-inspector__help">只做确定性的结构比较。运行后仅 matched 或 unmatched 端口之一生效，另一条路径会记录为“未选择”，不会执行也不会把工作流判失败。</p>
      </div>
    )
  }

  if (operation === 'terminal') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <Select
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__select-dropdown', option: 'workflow-node-inspector__select-option' }}
          label="终态"
          aria-label="终态"
          data={[{ value: 'succeeded', label: '成功' }, { value: 'failed', label: '失败' }]}
          value={readString(props.data, 'workflowTerminalOutcome') || 'succeeded'}
          disabled={props.readOnly}
          allowDeselect={false}
          onChange={(value) => {
            if (!value) return
            useRFStore.getState().updateNodeData(props.nodeId, { workflowTerminalOutcome: value })
          }}
        />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowTerminalMessage"
          label="终态说明"
          placeholder="说明这条路径为何成功或失败；该事实会写入运行证据"
          value={readString(props.data, 'workflowTerminalMessage')}
          readOnly={props.readOnly}
          multiline
        />
        <p className="workflow-node-inspector__help">失败终态会原地失败并保留回执；成功终态只结束当前叶子路径。需要暂停并等待人类输入时使用“人工审批”。</p>
      </div>
    )
  }

  if (operation === 'subworkflow') {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowSubflowFlowId"
          label="目标 Flow ID"
          placeholder="必须属于当前管理员"
          value={readString(props.data, 'workflowSubflowFlowId')}
          readOnly={props.readOnly}
        />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowSubflowVersionId"
          label="不可变 Flow Version ID"
          placeholder="必须属于目标 Flow；执行时不会漂移到最新版"
          value={readString(props.data, 'workflowSubflowVersionId')}
          readOnly={props.readOnly}
        />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowSubflowTriggerNodeId"
          label="版本内触发节点 ID"
          placeholder="必须存在于上述固定版本"
          value={readString(props.data, 'workflowSubflowTriggerNodeId')}
          readOnly={props.readOnly}
        />
        <p className="workflow-node-inspector__help">父节点会持久记录 childExecutionId 并轮询同一个 execution。固定版本不存在、权限不符、触发节点不匹配或形成版本递归环时显式失败。</p>
      </div>
    )
  }

  if (operation === 'agent_task' || Boolean(props.data.workflowAtomicSpec && readString(props.data, 'workflowAgentOutputArtifactType'))) {
    return (
      <div className="workflow-node-inspector__tab-content">
        <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <WorkflowAgentDefinitionSelect
          nodeId={props.nodeId}
          value={readString(props.data, 'workflowAgentDefinitionId')}
          readOnly={props.readOnly}
        />
        <WorkflowAgentContextOverview
          className="workflow-node-configuration__agent-context"
          nodeId={props.nodeId}
          data={props.data}
        />
        <AgentModelConfiguration nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
        <NumberInput
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
          label="单次最大输出 Token"
          aria-label="Agent 单次最大输出 Token"
          value={typeof props.data.workflowAgentMaxOutputTokens === 'number'
            ? props.data.workflowAgentMaxOutputTokens
            : ''}
          placeholder={`${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN}–${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX}，必须明确填写`}
          min={WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN}
          max={WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX}
          step={256}
          allowDecimal={false}
          disabled={props.readOnly}
          onChange={(value) => {
            if (typeof value !== 'number' || !Number.isInteger(value)) return
            useRFStore.getState().updateNodeData(props.nodeId, { workflowAgentMaxOutputTokens: value })
          }}
        />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowInstruction"
          label="Agent 任务目标"
          placeholder="填写该 Agent 必须完成的目标及真实结果落点"
          value={readString(props.data, 'workflowInstruction')}
          readOnly={props.readOnly}
          multiline
        />
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowAgentDeliveryRequirement"
          label="本节点交付合同"
          placeholder="明确本节点必须实际产生什么，以及怎样才算完成"
          value={readString(props.data, 'workflowAgentDeliveryRequirement')}
          readOnly={props.readOnly}
          multiline
        />
        <Select
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
          label="输出产物合同"
          aria-label="输出产物合同"
          value={readString(props.data, 'workflowAgentOutputArtifactType') || 'tapcanvas.json/v1'}
          disabled={props.readOnly}
          data={[...AGENT_OUTPUT_ARTIFACT_OPTIONS]}
          onChange={(value) => {
            if (!value) return
            useRFStore.getState().updateNodeData(props.nodeId, { workflowAgentOutputArtifactType: value })
          }}
        />
        <Select
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
          label="输出端口格式"
          aria-label="输出端口格式"
          value={readString(props.data, 'workflowAgentOutputEncoding') || 'plain_text'}
          disabled={props.readOnly}
          data={[...AGENT_OUTPUT_ENCODING_OPTIONS]}
          onChange={(value) => {
            if (value !== 'plain_text' && value !== 'json_object' && value !== 'json_artifact' && value !== 'json_array') return
            useRFStore.getState().updateNodeData(props.nodeId, { workflowAgentOutputEncoding: value })
          }}
        />
        <p className="workflow-node-inspector__help">
          最大输出 Token 会作为 provider 硬上限作用于该节点每个物理 LLM turn，并在持久续跑中保持不变。Structured Parser 是生成期输出合同；只有严格结果通过后，typed output port 才会交给下游。系统持久化可审计的输入、输出、工具调用和交付证据，不保存模型内部的隐式推理文本。
        </p>
      </div>
    )
  }

  const field = operation === 'agent_task'
    ? { key: 'workflowInstruction', label: 'Agent 任务目标', placeholder: '填写必须完成的目标及真实结果落点', multiline: true }
    : operation === 'skill_requirement'
      ? { key: 'workflowSkillId', label: 'Skill 身份', placeholder: '例如 tapcanvas-video-workflow', multiline: false }
      : operation === 'tool_capability'
        ? { key: 'workflowToolId', label: '工具身份', placeholder: '填写精确工具名', multiline: false }
        : operation === 'delivery_verify'
          ? { key: 'workflowDeliveryRequirement', label: '期望交付', placeholder: '填写可验证的期望产物与结果落点', multiline: true }
          : operation === 'workflow_input'
            ? { key: 'workflowInputDescription', label: '输入范围', placeholder: '例如当前项目与画布上下文', multiline: true }
            : null
  return (
    <div className="workflow-node-inspector__tab-content">
      <ExecutionModeField nodeId={props.nodeId} data={props.data} readOnly={props.readOnly} />
      {field ? (
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey={field.key}
          label={field.label}
          placeholder={field.placeholder}
          value={readString(props.data, field.key)}
          readOnly={props.readOnly}
          multiline={field.multiline}
        />
      ) : (
        <div className="workflow-node-inspector__section">
          <p className="workflow-node-inspector__help">{readString(props.data, 'workflowOperationDescription') || '该节点没有可编辑参数。'}</p>
          {readString(props.data, 'workflowOutputArtifactType') ? (
            <div className="workflow-node-inspector__definition">
              <span className="workflow-node-inspector__definition-label">输出产物</span>
              <strong className="workflow-node-inspector__definition-value">
                {readString(props.data, 'workflowOutputArtifactType')}
              </strong>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

import React, { useMemo, useRef, useState } from 'react'
import { Alert, Button, Select, Text } from '@mantine/core'
import { IconBook2 } from '@tabler/icons-react'
import type { Node } from '@xyflow/react'
import { useUIStore } from '../../ui/uiStore'
import { useRFStore } from '../store'
import { IntentActionGroup } from '../nodes/taskNode/IntentActionGroup'
import { assertWorkbenchScope, requireWorkbenchScope, type WorkbenchScope } from './workbenchScope'

const EMPTY_NODES: Node[] = []

/** Reuses the node's real production entry, including its chapter spec dialog and chat command. */
export function PipelineProductionControls({ active = true }: { active?: boolean }): JSX.Element {
  const project = useUIStore(state => state.currentProject)
  const chapter = useUIStore(state => state.currentChapter)
  const flow = useUIStore(state => state.currentFlow)
  const readOnly = useUIStore(state => state.viewOnly)
  const subscribedNodes = useRFStore(state => active ? state.nodes : EMPTY_NODES)
  const lastActiveNodes = useRef(subscribedNodes)
  if (active) lastActiveNodes.current = subscribedNodes
  const nodes = active ? subscribedNodes : lastActiveNodes.current
  const provenance = useRFStore(state => state.graphProvenanceKey)
  const [selection, setSelection] = useState<{ id: string | null; provenance: string | null }>({ id: null, provenance: null })
  const [error, setError] = useState('')
  const textSources = useMemo(() => nodes.filter(node => node.type === 'taskNode' && node.data.kind === 'text'), [nodes])
  const source = chapter
    ? textSources.find(node => node.id === `chapter-seed-${chapter.chapterId}` && node.data.preset === 'chapter-info')
    : selection.provenance === provenance ? textSources.find(node => node.id === selection.id) : undefined
  let scope: WorkbenchScope | null = null
  let scopeError = ''
  try {
    scope = requireWorkbenchScope()
  } catch (failure: unknown) {
    scopeError = failure instanceof Error ? failure.message : String(failure)
  }
  const currentScope = scope
  const scopeTitle = chapter?.chapterTitle || (chapter ? '当前章节' : flow.name || project?.name || '当前画布')
  const guardSubmission = (event: React.MouseEvent<HTMLElement>) => {
    try {
      if (!currentScope) throw new Error(scopeError)
      assertWorkbenchScope(currentScope)
      const liveSource = useRFStore.getState().nodes.find(node => node.id === source?.id)
      if (!liveSource || liveSource.data.kind !== 'text') throw new Error('正文来源已变化，请重新选择')
      if (liveSource.data.readOnly === true) throw new Error('正文节点为只读，无法提交成片任务')
      setError('')
    } catch (failure: unknown) {
      event.preventDefault()
      event.stopPropagation()
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return <section className="tc-pipeline-production" aria-label="成片制作入口">
    <div className="tc-pipeline-production__scope">
      {project?.name && project.name !== scopeTitle && <Text className="tc-pipeline-production__project" size="xs" c="dimmed">{project.name}</Text>}
      <Text className="tc-pipeline-production__chapter" fw={600} size="sm" title={scopeTitle}>{scopeTitle}</Text>
    </div>
    {!readOnly && <div className="tc-pipeline-production__actions">
      <Button className="tc-pipeline-production__choose" variant="default" size="sm"
        leftSection={<IconBook2 className="tc-pipeline-production__choose-icon" size={16} />}
        onClick={() => useUIStore.getState().openAssetManager('catalog')}>
        {chapter ? '切换章节' : '选择章节'}
      </Button>
      {!chapter && <Select className="tc-pipeline-production__source" label="正文来源" aria-label="选择成片文本来源"
        placeholder={textSources.length ? '选择要成片的正文' : '先选择章节或创建正文'}
        data={textSources.map(node => ({ value: node.id, label: typeof node.data.label === 'string' ? node.data.label : node.id }))}
        value={source?.id ?? null} searchable clearable size="xs"
        onChange={id => { setSelection({ id, provenance }); setError('') }} />}
      {source && currentScope && <div className="tc-pipeline-production__film-entry" key={JSON.stringify([currentScope, source.id])} onClickCapture={guardSubmission}>
        <IntentActionGroup nodeId={source.id} kind="text" nodeData={source.data}
          preset={typeof source.data.preset === 'string' ? source.data.preset : undefined} filmOnly />
      </div>}
      {(!source || !currentScope) && <Button className="tc-pipeline-production__launch" size="sm" disabled>一键成片</Button>}
      {chapter && !source && <Text className="tc-pipeline-production__notice" size="xs" c="dimmed">当前章节正文节点尚未就绪</Text>}
    </div>}
    {!readOnly && (error || scopeError) && <Alert className="tc-pipeline-production__error" color="red" role="alert">{error || scopeError}</Alert>}
  </section>
}

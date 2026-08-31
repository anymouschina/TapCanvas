import React from 'react'
import { Badge, Button, FocusTrap, Group, Text, Textarea } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import type { PromptLibraryCard as PromptLibraryCardDto, PromptMediaKind } from '../../../../api/promptLibrary'
import { PromptLibraryCard } from '../../../../portal/PromptLibraryCard'

type CanvasPromptLibraryDetailModalProps = Readonly<{
  opened: boolean
  mediaType: PromptMediaKind
  entry: PromptLibraryCardDto | null
  draftPrompt: string
  applyLabel?: string
  onDraftPromptChange: (value: string) => void
  onBack: () => void
  onApply: () => void
}>

type DetailTab = 'preview' | 'custom'

function mediaTypeLabel(mediaType: PromptMediaKind): string {
  return mediaType === 'video' ? '视频' : '图片'
}

export function CanvasPromptLibraryDetailModal({
  opened,
  mediaType,
  entry,
  draftPrompt,
  applyLabel = '填入当前节点',
  onDraftPromptChange,
  onBack,
  onApply,
}: CanvasPromptLibraryDetailModalProps): JSX.Element {
  const [activeTab, setActiveTab] = React.useState<DetailTab>('custom')

  React.useEffect(() => {
    if (opened) setActiveTab('custom')
  }, [entry?.id, opened])

  if (!opened || !entry) return <></>

  return (
    <FocusTrap active={opened}>
      <div className="canvas-prompt-library-detail-modal__layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onBack() }}>
        <section className="canvas-prompt-library-detail-modal__content" role="dialog" aria-modal="true" aria-labelledby="canvas-prompt-library-detail-title" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <header className="canvas-prompt-library-detail-modal__header">
          <Text className="canvas-prompt-library-detail-modal__title" component="h2" id="canvas-prompt-library-detail-title">预览并编辑{mediaTypeLabel(mediaType)}提示词</Text>
          <Button className="canvas-prompt-library-detail-modal__close" variant="subtle" color="gray" size="compact-sm" aria-label="返回提示词列表" onClick={onBack}>
            <IconX className="canvas-prompt-library-detail-modal__close-icon" size={16} />
          </Button>
        </header>

        <div className="canvas-prompt-library-detail-modal__tabs" role="tablist" aria-label="提示词内容">
          <button className={`canvas-prompt-library-detail-modal__tab${activeTab === 'preview' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'preview'} onClick={() => setActiveTab('preview')}>提示词详情</button>
          <button className={`canvas-prompt-library-detail-modal__tab${activeTab === 'custom' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'custom'} onClick={() => setActiveTab('custom')}>自定义提示词</button>
        </div>

        <div className="canvas-prompt-library-detail-modal__layout nodrag nopan nowheel">
          <section className="canvas-prompt-library-detail-modal__preview" aria-label="所选提示词预览">
            <PromptLibraryCard entry={entry} previewMode />
          </section>

          <section className="canvas-prompt-library-detail-modal__editor">
            <div className="canvas-prompt-library-detail-modal__heading">
              <div className="canvas-prompt-library-detail-modal__heading-copy">
                <Text className="canvas-prompt-library-detail-modal__entry-title" fw={680}>{entry.title}</Text>
                <Text className="canvas-prompt-library-detail-modal__meta" size="xs" c="dimmed">{entry.authorLabel}</Text>
              </div>
              <Badge className="canvas-prompt-library-detail-modal__selected-badge" size="sm" variant="light" color="gray">已选择</Badge>
            </div>

            <Group className="canvas-prompt-library-detail-modal__badges" gap={6}>
              {entry.models.slice(0, 3).map((model) => (
                <Badge className="canvas-prompt-library-detail-modal__model-badge" key={model.slug} size="sm" variant="outline" color="gray">{model.name}</Badge>
              ))}
            </Group>

            {activeTab === 'preview' ? (
              <div className="canvas-prompt-library-detail-modal__prompt-preview" role="tabpanel">
                {entry.description ? <Text className="canvas-prompt-library-detail-modal__description" size="xs" c="dimmed">{entry.description}</Text> : null}
                <Text className="canvas-prompt-library-detail-modal__prompt-preview-label" size="sm" fw={650}>原始提示词</Text>
                <div className="canvas-prompt-library-detail-modal__prompt-preview-content">{entry.promptText}</div>
              </div>
            ) : (
              <div className="canvas-prompt-library-detail-modal__field" role="tabpanel">
                <Group className="canvas-prompt-library-detail-modal__field-heading" justify="space-between" gap="xs">
                  <Text className="canvas-prompt-library-detail-modal__field-label" size="sm" fw={650}>自定义提示词</Text>
                  <Text className="canvas-prompt-library-detail-modal__field-count" size="xs" c="dimmed">{draftPrompt.length} 字</Text>
                </Group>
                <Textarea
                  className="canvas-prompt-library-detail-modal__textarea"
                  value={draftPrompt}
                  onChange={(event) => onDraftPromptChange(event.currentTarget.value)}
                  aria-label="自定义提示词"
                  placeholder="在填入节点前，可以继续修改提示词"
                  autosize
                  minRows={10}
                  maxRows={16}
                  autoFocus
                />
              </div>
            )}

            <div className="canvas-prompt-library-detail-modal__spacer" />
            <Group className="canvas-prompt-library-detail-modal__actions" justify="flex-end" gap="xs">
              <Button className="canvas-prompt-library-detail-modal__back" variant="subtle" color="gray" onClick={onBack}>继续浏览</Button>
              <Button className="canvas-prompt-library-detail-modal__apply" disabled={!draftPrompt.trim()} onClick={onApply}>{applyLabel}</Button>
            </Group>
          </section>
        </div>
        </section>
      </div>
    </FocusTrap>
  )
}

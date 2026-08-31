import React from 'react'
import { ActionIcon, Button, Drawer, Textarea, Tooltip } from '@mantine/core'
import { IconArrowsMaximize } from '@tabler/icons-react'
import { useRFStore } from '../store'

type WorkflowCodeEditorFieldProps = Readonly<{
  nodeId: string
  dataKey: string
  label: string
  placeholder: string
  value: string
  readOnly: boolean
}>

function insertIndent(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): Readonly<{ value: string; cursor: number }> {
  const nextValue = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
  return { value: nextValue, cursor: selectionStart + 2 }
}

export function WorkflowCodeEditorField(props: WorkflowCodeEditorFieldProps): React.JSX.Element {
  const [draft, setDraft] = React.useState(props.value)
  const [opened, setOpened] = React.useState(false)
  const compactEditorId = React.useId()

  React.useEffect(() => setDraft(props.value), [props.value])

  const persist = React.useCallback((): void => {
    if (props.readOnly || draft === props.value) return
    useRFStore.getState().updateNodeData(props.nodeId, { [props.dataKey]: draft })
  }, [draft, props.dataKey, props.nodeId, props.readOnly, props.value])

  const closeExpandedEditor = React.useCallback((): void => {
    persist()
    setOpened(false)
  }, [persist])

  const handleEditorKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const editor = event.currentTarget
    const next = insertIndent(draft, editor.selectionStart, editor.selectionEnd)
    setDraft(next.value)
    window.requestAnimationFrame(() => editor.setSelectionRange(next.cursor, next.cursor))
  }, [draft])

  const fieldLabel = (
    <span className="workflow-node-inspector__field-label-row">
      <span className="workflow-node-inspector__field-label-text">{props.label}</span>
      <Tooltip className="workflow-node-inspector__field-expand-tooltip" label="展开代码编辑器" withArrow>
        <ActionIcon
          className="workflow-node-inspector__field-expand"
          variant="subtle"
          size="sm"
          aria-label="展开 JavaScript 编辑器"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpened(true)}
        >
          <IconArrowsMaximize className="workflow-node-inspector__field-expand-icon" size={15} />
        </ActionIcon>
      </Tooltip>
    </span>
  )

  return (
    <>
      <Textarea
        id={compactEditorId}
        className="workflow-node-inspector__field workflow-node-inspector__field--code"
        classNames={{
          label: 'workflow-node-inspector__field-label workflow-node-inspector__field-label--code',
          input: 'workflow-node-inspector__field-input workflow-node-inspector__field-input--code',
        }}
        label={fieldLabel}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={draft}
        disabled={props.readOnly}
        minRows={10}
        maxRows={18}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleEditorKeyDown}
        onBlur={persist}
      />

      <Drawer
        className="workflow-code-editor-drawer"
        classNames={{
          content: 'workflow-code-editor-drawer__content',
          header: 'workflow-code-editor-drawer__header',
          title: 'workflow-code-editor-drawer__title',
          close: 'workflow-code-editor-drawer__close',
          body: 'workflow-code-editor-drawer__body',
        }}
        opened={opened}
        onClose={closeExpandedEditor}
        position="right"
        size="min(960px, calc(100vw - 48px))"
        title={(
          <span className="workflow-code-editor-drawer__identity">
            <strong className="workflow-code-editor-drawer__heading">{props.label} 编辑器</strong>
            <span className="workflow-code-editor-drawer__meta">当前节点 · {props.nodeId}</span>
          </span>
        )}
        withOverlay={false}
        closeOnClickOutside={false}
        zIndex={10_200}
      >
        <div className="workflow-code-editor-drawer__workspace">
          <Textarea
            className="workflow-code-editor-drawer__editor"
            classNames={{
              wrapper: 'workflow-code-editor-drawer__editor-wrapper',
              input: 'workflow-code-editor-drawer__editor-input',
            }}
            aria-label="JavaScript 大编辑器"
            placeholder={props.placeholder}
            value={draft}
            readOnly={props.readOnly}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={handleEditorKeyDown}
          />
          <footer className="workflow-code-editor-drawer__footer">
            <span className="workflow-code-editor-drawer__hint">支持 Tab 缩进；完成后仍需点击“保存节点配置”提交画布。</span>
            <Button
              className="workflow-code-editor-drawer__done"
              type="button"
              onClick={closeExpandedEditor}
            >
              完成编辑
            </Button>
          </footer>
        </div>
      </Drawer>
    </>
  )
}

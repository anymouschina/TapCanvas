import React from 'react'
import { PanelCard } from '../../../../ui/PanelCard'

type TextContentProps = {
  selected: boolean
  textEditorFocused: boolean
  textBackgroundTint: string
  textColor: string
  textFontSize: number
  textFontWeight: React.CSSProperties['fontWeight']
  editorRef: React.RefObject<HTMLDivElement>
  onFocus: React.FocusEventHandler<HTMLDivElement>
  onInput: React.FormEventHandler<HTMLDivElement>
  onCompositionStart: React.CompositionEventHandler<HTMLDivElement>
  onCompositionEnd: React.CompositionEventHandler<HTMLDivElement>
  onBlur: React.FocusEventHandler<HTMLDivElement>
  readOnly?: boolean
}

type TextContentPreviewProps = {
  html: string
  textBackgroundTint: string
  textColor: string
  textFontSize: number
  textFontWeight: React.CSSProperties['fontWeight']
}

const textContentPanelStyle = (textBackgroundTint: string): React.CSSProperties => ({
  width: '100%',
  backgroundColor: textBackgroundTint,
  display: 'flex',
  flex: 1,
  minHeight: 0,
})

const textContentBodyStyle = (
  textColor: string,
  textFontSize: number,
  textFontWeight: React.CSSProperties['fontWeight'],
): React.CSSProperties => ({
  flex: 1,
  minHeight: 0,
  height: '100%',
  outline: 'none',
  border: 'none',
  background: 'transparent',
  color: textColor,
  fontSize: textFontSize,
  fontWeight: textFontWeight,
  lineHeight: 1.5,
  padding: 0,
  overflowY: 'auto',
  paddingRight: 4,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
})

function TextContent({
  selected,
  textEditorFocused,
  textBackgroundTint,
  textColor,
  textFontSize,
  textFontWeight,
  editorRef,
  onFocus,
  onInput,
  onCompositionStart,
  onCompositionEnd,
  onBlur,
  readOnly = false,
}: TextContentProps) {
  const editable = selected && !readOnly

  const editorClassName = [
    'tc-task-node__text-editor-input',
    'nodrag nopan',
    readOnly ? 'tc-task-node__text-editor-input--readonly' : '',
  ].filter(Boolean).join(' ')

  return (
    <PanelCard
      className="tc-task-node__text-editor-panel nowheel"
      padding="compact"
      style={textContentPanelStyle(textBackgroundTint)}
    >
      <div
        ref={editorRef}
        className={editorClassName}
        data-canvas-text-selection
        contentEditable={editable}
        suppressContentEditableWarning
        onFocus={onFocus}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onBlur={onBlur}
        tabIndex={0}
        style={textContentBodyStyle(textColor, textFontSize, textFontWeight)}
      />
    </PanelCard>
  )
}

function TextContentPreview({
  html,
  textBackgroundTint,
  textColor,
  textFontSize,
  textFontWeight,
}: TextContentPreviewProps) {
  return (
    <PanelCard
      className="tc-task-node__text-editor-panel tc-task-node__text-editor-panel--preview nowheel"
      padding="compact"
      style={textContentPanelStyle(textBackgroundTint)}
    >
      <div
        className="tc-task-node__text-editor-input tc-task-node__text-editor-input--readonly"
        style={textContentBodyStyle(textColor, textFontSize, textFontWeight)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </PanelCard>
  )
}

const _TextContent = React.memo(TextContent)
export { _TextContent as TextContent }
const _TextContentPreview = React.memo(TextContentPreview)
export { _TextContentPreview as TextContentPreview }

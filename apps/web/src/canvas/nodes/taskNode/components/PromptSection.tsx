import React from 'react'
import { ActionIcon, Textarea, Text, Group, Button, TextInput, Badge, Select, Portal } from '@mantine/core'
import { IconBrain, IconBulb } from '@tabler/icons-react'

type MentionMenuPosition = {
  left: number
  top: number
  width: number
}

export type MentionSuggestionItem = {
  username: string
  display_name: string
  profile_picture_url?: string | null
  source: 'character' | 'asset'
  assetBinding?: {
    url: string
    assetId?: string | null
    assetRefId?: string | null
    assetName?: string | null
  }
}

type CaretMetrics = {
  left: number
  top: number
  lineHeight: number
}

function getTextareaCaretMetrics(textarea: HTMLTextAreaElement, caret: number): CaretMetrics {
  const styles = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const marker = document.createElement('span')
  const textareaRect = textarea.getBoundingClientRect()

  mirror.setAttribute('data-role', 'prompt-caret-mirror')
  mirror.style.position = 'fixed'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.left = `${textareaRect.left}px`
  mirror.style.top = `${textareaRect.top}px`
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.boxSizing = styles.boxSizing
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.font = styles.font
  mirror.style.fontFamily = styles.fontFamily
  mirror.style.fontSize = styles.fontSize
  mirror.style.fontWeight = styles.fontWeight
  mirror.style.fontStyle = styles.fontStyle
  mirror.style.letterSpacing = styles.letterSpacing
  mirror.style.textTransform = styles.textTransform
  mirror.style.textIndent = styles.textIndent
  mirror.style.padding = styles.padding
  mirror.style.border = styles.border
  mirror.style.lineHeight = styles.lineHeight
  mirror.style.tabSize = styles.tabSize
  mirror.style.textAlign = styles.textAlign

  const valueBeforeCaret = textarea.value.slice(0, caret)
  mirror.textContent = valueBeforeCaret
  if (valueBeforeCaret.endsWith('\n')) {
    mirror.textContent += ' '
  }

  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const mirrorRect = mirror.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  const lineHeightValue = Number.parseFloat(styles.lineHeight)
  const fontSizeValue = Number.parseFloat(styles.fontSize)
  const lineHeight = Number.isFinite(lineHeightValue)
    ? lineHeightValue
    : (Number.isFinite(fontSizeValue) ? fontSizeValue * 1.4 : 20)

  const left = markerRect.left - textarea.scrollLeft
  const top = markerRect.top - textarea.scrollTop

  document.body.removeChild(mirror)

  return {
    left,
    top,
    lineHeight,
  }
}

type PromptSectionProps = {
  isCharacterNode: boolean
  isComposerNode: boolean
  isStoryboardNode: boolean
  layout?: 'default' | 'media-focus'
  toolbarLead?: React.ReactNode
  hideBrainButton?: boolean
  hidePresetSection?: boolean
  hideAnchorBindingSection?: boolean
  readOnly?: boolean
  readOnlyHint?: string
  prompt: string
  setPrompt: (value: string) => void
  onUpdateNodeData: (patch: any) => void
  placeholder?: string
  minRows?: number
  maxRows?: number
  suggestionsAllowed: boolean
  suggestionsEnabled: boolean
  setSuggestionsEnabled: (value: boolean) => void
  promptSuggestions: string[]
  activeSuggestion: number
  setActiveSuggestion: React.Dispatch<React.SetStateAction<number>>
  setPromptSuggestions: (value: string[]) => void
  markPromptUsed: (value: string) => void
  mentionOpen: boolean
  mentionItems: MentionSuggestionItem[]
  mentionLoading: boolean
  mentionFilter: string
  setMentionFilter: (value: string) => void
  setMentionOpen: (value: boolean) => void
  mentionMetaRef: React.MutableRefObject<{
    at: number
    caret: number
    target?: 'prompt' | 'storyboard_scene' | 'storyboard_notes'
    sceneId?: string
  } | null>
  showAssetBinding: boolean
  assetBindingId: string
  setAssetBindingId: (value: string) => void
  onBindPrimaryAssetReference: () => void
  bindAssetDisabled: boolean
  bindAssetStatusText?: string
  showAnchorBinding: boolean
  anchorBindingKind: string
  setAnchorBindingKind: (value: string | null) => void
  anchorBindingLabel: string
  setAnchorBindingLabel: (value: string) => void
  onBindPrimaryAnchor: () => void
  bindAnchorLoading: boolean
  bindAnchorDisabled: boolean
  bindAnchorStatusText?: string
  isDarkUi: boolean
  nodeShellText: string
  onOpenPromptSamples?: () => void
  presetOptions?: Array<{ value: string; label: string }>
  presetValue?: string | null
  presetDisabled?: boolean
  onPresetChange?: (value: string | null) => void
  onOpenCreatePresetModal?: () => void
  onGenerateStoryboardScript?: () => void
  generateStoryboardScriptLoading?: boolean
  generateStoryboardScriptDisabled?: boolean
  onMentionApplied?: (item: MentionSuggestionItem) => void
}

export function PromptSection({
  isCharacterNode,
  isComposerNode,
  isStoryboardNode,
  layout = 'default',
  toolbarLead,
  hideBrainButton = false,
  hidePresetSection = false,
  hideAnchorBindingSection = false,
  readOnly = false,
  readOnlyHint,
  prompt,
  setPrompt,
  onUpdateNodeData,
  suggestionsAllowed,
  suggestionsEnabled,
  setSuggestionsEnabled,
  promptSuggestions,
  activeSuggestion,
  setActiveSuggestion,
  setPromptSuggestions,
  markPromptUsed,
  mentionOpen,
  mentionItems,
  mentionLoading,
  mentionFilter,
  setMentionFilter,
  setMentionOpen,
  mentionMetaRef,
  showAssetBinding,
  assetBindingId,
  setAssetBindingId,
  onBindPrimaryAssetReference,
  bindAssetDisabled,
  bindAssetStatusText,
  showAnchorBinding,
  anchorBindingKind,
  setAnchorBindingKind,
  anchorBindingLabel,
  setAnchorBindingLabel,
  onBindPrimaryAnchor,
  bindAnchorLoading,
  bindAnchorDisabled,
  bindAnchorStatusText,
  isDarkUi,
  nodeShellText,
  onOpenPromptSamples,
  presetOptions,
  presetValue,
  presetDisabled,
  onPresetChange,
  onOpenCreatePresetModal,
  onGenerateStoryboardScript,
  generateStoryboardScriptLoading,
  generateStoryboardScriptDisabled,
  onMentionApplied,
  placeholder,
  minRows,
  maxRows,
}: PromptSectionProps) {
  const hasStoryboardScriptGenerator = typeof onGenerateStoryboardScript === 'function'
  const brainActive = hasStoryboardScriptGenerator ? true : suggestionsEnabled
  const brainTitle = hasStoryboardScriptGenerator
    ? 'AI 生成分镜脚本'
    : suggestionsEnabled
      ? '智能建议已启用 (Ctrl/Cmd+Space 切换)'
      : '智能建议已禁用 (Ctrl/Cmd+Space 启用)'
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const inputWrapRef = React.useRef<HTMLDivElement | null>(null)
  const [activeMention, setActiveMention] = React.useState(0)
  const [mentionMenuPosition, setMentionMenuPosition] = React.useState<MentionMenuPosition | null>(null)

  const updateMentionMenuPosition = React.useCallback(() => {
    const textarea = textareaRef.current
    const inputWrap = inputWrapRef.current
    const meta = mentionMetaRef.current
    if (!textarea || !inputWrap || !meta) {
      setMentionMenuPosition(null)
      return
    }

    const textareaRect = textarea.getBoundingClientRect()
    const caretMetrics = getTextareaCaretMetrics(textarea, meta.caret)
    const preferredWidth = Math.min(320, Math.max(220, textareaRect.width - 16))
    const minLeft = 8
    const maxLeft = Math.max(minLeft, window.innerWidth - preferredWidth - 8)
    const rawLeft = caretMetrics.left
    const left = Math.min(Math.max(rawLeft, minLeft), maxLeft)
    const top = Math.min(
      Math.max(caretMetrics.top + caretMetrics.lineHeight + 6, textareaRect.top + 8),
      Math.max(8, window.innerHeight - 16),
    )

    setMentionMenuPosition({
      left,
      top,
      width: preferredWidth,
    })
  }, [mentionMetaRef])

  const syncMentionState = React.useCallback((input: {
    textarea: HTMLTextAreaElement
    value: string
  }) => {
    const caret = typeof input.textarea.selectionStart === 'number'
      ? input.textarea.selectionStart
      : input.value.length
    const before = input.value.slice(0, caret)
    const lastAt = before.lastIndexOf('@')
    const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))

    if (lastAt >= 0 && lastAt >= lastSpace) {
      const filter = before.slice(lastAt + 1)
      setMentionFilter(filter)
      setMentionOpen(true)
      mentionMetaRef.current = { at: lastAt, caret }
      window.requestAnimationFrame(() => {
        updateMentionMenuPosition()
      })
      return
    }

    setMentionOpen(false)
    setMentionFilter('')
    mentionMetaRef.current = null
    setMentionMenuPosition(null)
  }, [mentionMetaRef, setMentionFilter, setMentionOpen, updateMentionMenuPosition])

  React.useEffect(() => {
    if (!mentionOpen) {
      setActiveMention(0)
      setMentionMenuPosition(null)
      return
    }
    setActiveMention(0)
  }, [mentionOpen, mentionItems.length])

  React.useEffect(() => {
    if (!mentionOpen) return
    const handleViewportChange = () => updateMentionMenuPosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [mentionOpen, updateMentionMenuPosition])

  const applyMention = React.useCallback((item: MentionSuggestionItem) => {
    const usernameRaw = String(item?.username || '').replace(/^@/, '').trim()
    if (!usernameRaw) return
    const mention = `@${usernameRaw}`
    const meta = mentionMetaRef.current
    if (!meta) return
    const before = prompt.slice(0, meta.at)
    const after = prompt.slice(meta.caret)
    const needsSpace = after.length === 0 || !/^\s/.test(after)
    const suffix = needsSpace ? ' ' : ''
    const next = `${before}${mention}${suffix}${after}`
    const nextCaret = before.length + mention.length + suffix.length
    setPrompt(next)
    onUpdateNodeData({ prompt: next })
    onMentionApplied?.(item)
    setMentionOpen(false)
    setMentionFilter('')
    mentionMetaRef.current = null
    window.requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      try {
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
      } catch {
        // ignore
      }
    })
  }, [mentionMetaRef, onMentionApplied, onUpdateNodeData, prompt, setMentionFilter, setMentionOpen, setPrompt])

  const hasPresetModule = typeof onPresetChange === 'function' || typeof onOpenCreatePresetModal === 'function'
  const hasPresetOptions = Array.isArray(presetOptions) && presetOptions.length > 0
  const allowPromptEditing = !readOnly
  const hasToolbarContent = Boolean(
    toolbarLead ||
    (allowPromptEditing && onOpenPromptSamples) ||
    (!hideBrainButton && allowPromptEditing),
  )
  const rootClassName = [
    'task-node-prompt__root',
    layout === 'media-focus' ? 'task-node-prompt__root--media-focus' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={rootClassName}>
      {!hidePresetSection && hasPresetModule && (
        <Group className="task-node-prompt__preset-row" gap={6} mb={6} wrap="nowrap">
          <div className="task-node-prompt__preset-select-wrap" style={{ flex: 1, minWidth: 0 }}>
            <Select
              className="task-node-prompt__preset-select"
              size="xs"
              data={presetOptions || []}
              value={presetValue || null}
              onChange={onPresetChange}
              placeholder={hasPresetOptions ? '选择预设能力' : '暂无预设能力'}
              searchable
              clearable
              disabled={!!presetDisabled}
              nothingFoundMessage="没有匹配的预设"
            />
            {!hasPresetOptions && (
              <Text className="task-node-prompt__preset-empty-hint" size="xs" c="dimmed" mt={4}>
                还没有可用预设，可点击右侧“新增预设”创建。
              </Text>
            )}
          </div>
          {onOpenCreatePresetModal && (
            <Button
              className="task-node-prompt__preset-create-btn"
              size="xs"
              variant="light"
              onClick={onOpenCreatePresetModal}
            >
              新增预设
            </Button>
          )}
        </Group>
      )}
      <div className="task-node-prompt__input-wrap" ref={inputWrapRef} style={{ position: 'relative' }}>
        {hasToolbarContent && (
          <div
            className="task-node-prompt__toolbar"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
              display: 'flex',
              gap: 6,
            }}
          >
            {toolbarLead}
            {allowPromptEditing && onOpenPromptSamples && (
              <ActionIcon
                className="task-node-prompt__toolbar-button"
                variant="subtle"
                size="xs"
                onClick={onOpenPromptSamples}
                title="打开提示词支持共享配置"
                style={{
                  border: 'none',
                  background: isDarkUi ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
                }}
              >
                <IconBulb className="task-node-prompt__toolbar-icon" size={12} style={{ color: nodeShellText }} />
              </ActionIcon>
            )}
            {!hideBrainButton && allowPromptEditing && (
              <ActionIcon
                className="task-node-prompt__toolbar-button"
                variant="subtle"
                size="xs"
                onClick={() => {
                  if (hasStoryboardScriptGenerator) {
                    onGenerateStoryboardScript?.()
                    return
                  }
                  setSuggestionsEnabled(!suggestionsEnabled)
                }}
                title={brainTitle}
                loading={hasStoryboardScriptGenerator ? !!generateStoryboardScriptLoading : false}
                disabled={hasStoryboardScriptGenerator ? !!generateStoryboardScriptDisabled : false}
                style={{
                  background: brainActive ? 'rgba(59, 130, 246, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                  border: 'none',
                }}
              >
                <IconBrain
                  className="task-node-prompt__toolbar-icon"
                  size={12}
                  style={{ color: brainActive ? 'rgb(59, 130, 246)' : 'rgb(107, 114, 128)' }}
                />
              </ActionIcon>
            )}
          </div>
        )}
        <Textarea
          className="task-node-prompt__textarea"
          ref={textareaRef}
          autosize
          minRows={typeof minRows === 'number' ? minRows : 2}
          maxRows={typeof maxRows === 'number' ? maxRows : 6}
          readOnly={readOnly}
          placeholder={
            readOnly
              ? (readOnlyHint || '当前为编译后的执行提示词预览')
              : (placeholder || '在这里输入提示词... (输入6个字符后按 Ctrl/Cmd+Space 激活智能建议)')
          }
          value={prompt}
          onChange={(e) => {
          if (readOnly) return
          const el = e.currentTarget
          const v = el.value
          setPrompt(v)
          onUpdateNodeData({ prompt: v })
          syncMentionState({ textarea: el, value: v })
        }}
          onClick={(e) => {
            if (readOnly) return
            syncMentionState({ textarea: e.currentTarget, value: e.currentTarget.value })
          }}
          onKeyUp={(e) => {
            if (readOnly) return
            const key = e.key
            if (key.startsWith('Arrow') || key === 'Home' || key === 'End') {
              syncMentionState({ textarea: e.currentTarget, value: e.currentTarget.value })
            }
          }}
          onSelect={(e) => {
            if (readOnly) return
            syncMentionState({ textarea: e.currentTarget, value: e.currentTarget.value })
          }}
          onBlur={() => {
            if (readOnly) return
            setPromptSuggestions([])
            setMentionOpen(false)
            setMentionFilter('')
            setMentionMenuPosition(null)
          }}
          onKeyDown={(e) => {
          if (readOnly) return
          const isMac = navigator.platform.toLowerCase().includes('mac')
          const mod = isMac ? e.metaKey : e.ctrlKey

          if (e.key === 'Escape') {
            if (mentionOpen) {
              e.stopPropagation()
              setMentionOpen(false)
              setMentionFilter('')
              mentionMetaRef.current = null
              return
            }
            if (!mentionOpen && promptSuggestions.length > 0) {
              e.preventDefault()
              setPromptSuggestions([])
              setSuggestionsEnabled(false)
              return
            }
          }

          if (mentionOpen) {
            if (e.key === 'ArrowDown') {
              if (mentionItems.length > 0) {
                e.preventDefault()
                setActiveMention((idx) => (idx + 1) % mentionItems.length)
              }
              return
            }
            if (e.key === 'ArrowUp') {
              if (mentionItems.length > 0) {
                e.preventDefault()
                setActiveMention((idx) => (idx - 1 + mentionItems.length) % mentionItems.length)
              }
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              const active = mentionItems[activeMention]
              if (active) {
                e.preventDefault()
                applyMention(active)
              }
              return
            }
          }

          if ((e.key === ' ' || (isMac && e.key === 'Space' && !e.shiftKey)) && mod) {
            e.preventDefault()
            if (!suggestionsAllowed) return
            const value = prompt.trim()
            if (value.length >= 6) {
              setSuggestionsEnabled(true)
            }
            return
          }

          if (!promptSuggestions.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveSuggestion((idx) => (idx + 1) % promptSuggestions.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveSuggestion((idx) => (idx - 1 + promptSuggestions.length) % promptSuggestions.length)
          } else if (e.key === 'Tab') {
            e.preventDefault()
            const suggestion = promptSuggestions[activeSuggestion]
            if (suggestion) {
              setPrompt(suggestion)
              setPromptSuggestions([])
              setSuggestionsEnabled(false)
              markPromptUsed(suggestion)
            }
          } else if (e.key === 'Escape') {
            setPromptSuggestions([])
            setSuggestionsEnabled(false)
          }
          }}
        />
        {readOnlyHint ? (
          <Text className="task-node-prompt__readonly-hint" size="xs" c="dimmed" mt={6}>
            {readOnlyHint}
          </Text>
        ) : null}
        {allowPromptEditing && !mentionOpen && promptSuggestions.length > 0 && (
          <div
            className="task-node-prompt__suggestions"
            style={{
              position: 'absolute',
              right: 10,
              top: '100%',
              zIndex: 40,
              background: isDarkUi ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.95)',
              borderRadius: 8,
              boxShadow: '0 16px 32px rgba(0,0,0,0.25)',
              width: '100%',
              maxWidth: 340,
              marginTop: 6,
              border: `1px solid ${isDarkUi ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
              overflow: 'hidden',
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            {promptSuggestions.map((s, idx) => (
              <div
                className="task-node-prompt__suggestion"
                key={`${idx}-${s.slice(0, 16)}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setPrompt(s)
                  setPromptSuggestions([])
                  markPromptUsed(s)
                }}
                onMouseEnter={() => setActiveSuggestion(idx)}
                style={{
                  padding: '4px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                  background: idx === activeSuggestion ? 'rgba(59,130,246,0.15)' : 'transparent',
                  color: nodeShellText,
                }}
              >
                {s}
              </div>
            ))}
          </div>
        )}
        {allowPromptEditing && mentionOpen && (
          <Portal>
            <div
              className="task-node-prompt__mentions"
              style={{
                position: 'fixed',
                left: mentionMenuPosition ? mentionMenuPosition.left : 8,
                top: mentionMenuPosition ? mentionMenuPosition.top : 8,
                borderRadius: 10,
                padding: 8,
                background: isDarkUi ? 'rgba(0,0,0,0.84)' : '#fff',
                boxShadow: '0 16px 32px rgba(0,0,0,0.25)',
                zIndex: 1200,
                maxHeight: 220,
                width: mentionMenuPosition ? mentionMenuPosition.width : 280,
                overflowY: 'auto',
                overflowX: 'hidden',
              }}
            >
            <Text className="task-node-prompt__mentions-title" size="xs" c="dimmed" mb={4}>
              选择引用
            </Text>
            {mentionItems.map((item, idx: number) => {
              const avatar =
                (typeof item?.profile_picture_url === 'string' && item.profile_picture_url.trim()) ||
                null
              const username = String(item?.username || '').replace(/^@/, '').trim()
              const display = String(item?.display_name || item?.username || '角色')
              const meta = item.source === 'asset' ? '资产引用' : '角色引用'
              return (
                <div
                  className="task-node-prompt__mention"
                  key={username || item?.id || item?.name || idx}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: idx === activeMention ? 'rgba(59,130,246,0.15)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applyMention(item)
                  }}
                  onMouseEnter={() => setActiveMention(idx)}
                >
                  {avatar && (
                    <img
                      className="task-node-prompt__mention-avatar"
                      src={avatar}
                      alt={username ? `@${username}` : 'avatar'}
                      style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                    />
                  )}
                  <div className="task-node-prompt__mention-text" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <Text className="task-node-prompt__mention-name" size="sm" lineClamp={1}>
                      {display}
                    </Text>
                    {(username || meta) && (
                      <Text className="task-node-prompt__mention-username" size="xs" c="dimmed" lineClamp={1}>
                        {[username ? `@${username}` : null, meta].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </div>
                </div>
              )
            })}
            {mentionLoading && (
              <Text className="task-node-prompt__mention-loading" size="xs" c="dimmed">
                加载中...
              </Text>
            )}
            {!mentionLoading && mentionItems.length === 0 && (
              <Text className="task-node-prompt__mention-empty" size="xs" c="dimmed">
                无匹配引用
              </Text>
            )}
            </div>
          </Portal>
        )}
      </div>
      {showAssetBinding && !hideAnchorBindingSection && (
        <div
          className="task-node-prompt__asset-bind-panel"
          style={{
            marginTop: 8,
            border: `1px solid ${isDarkUi ? 'rgba(148,163,184,.28)' : 'rgba(100,116,139,.28)'}`,
            borderRadius: 8,
            padding: 8,
            background: isDarkUi ? '#0f172a' : '#f8fafc',
          }}
        >
          <Group className="task-node-prompt__asset-bind-header" justify="space-between" align="center" mb={6}>
            <Text className="task-node-prompt__asset-bind-title" size="xs" fw={600}>
              引用绑定
            </Text>
            <Badge className="task-node-prompt__asset-bind-badge" size="xs" variant="light" color="blue">
              @ID
            </Badge>
          </Group>
          <Group className="task-node-prompt__asset-bind-row" gap="xs" align="flex-end" wrap="wrap">
            <TextInput
              className="task-node-prompt__asset-bind-input"
              label="引用ID"
              size="xs"
              value={assetBindingId}
              onChange={(e) => setAssetBindingId(e.currentTarget.value)}
              placeholder="例如：fangyuan_main"
              style={{ flex: 1, minWidth: 180 }}
            />
            <Button
              className="task-node-prompt__asset-bind-btn"
              size="xs"
              variant="light"
              color="blue"
              disabled={bindAssetDisabled}
              onClick={onBindPrimaryAssetReference}
            >
              绑定当前主资产
            </Button>
          </Group>
          <Text className="task-node-prompt__asset-bind-hint" size="xs" c="dimmed" mt={6}>
            绑定后，当前主图或主视频会写入该引用ID，后续在提示词中可直接使用 @引用ID。
          </Text>
          {!!bindAssetStatusText && (
            <Text className="task-node-prompt__asset-bind-status" size="xs" c="dimmed" mt={4}>
              {bindAssetStatusText}
            </Text>
          )}
        </div>
      )}
      {showAnchorBinding && !hideAnchorBindingSection && (
        <div
          className="task-node-prompt__anchor-bind-panel"
          style={{
            marginTop: 8,
            border: `1px solid ${isDarkUi ? 'rgba(148,163,184,.28)' : 'rgba(100,116,139,.28)'}`,
            borderRadius: 8,
            padding: 8,
            background: isDarkUi ? '#0f172a' : '#f8fafc',
          }}
        >
        <Group className="task-node-prompt__anchor-bind-header" justify="space-between" align="center" mb={6}>
          <Text className="task-node-prompt__anchor-bind-title" size="xs" fw={600}>
            通用锚点绑定
          </Text>
          <Badge className="task-node-prompt__anchor-bind-badge" size="xs" variant="light" color="grape">
            使用主图
          </Badge>
        </Group>
        <Group className="task-node-prompt__anchor-bind-row" gap="xs" align="flex-end" wrap="wrap">
          <Select
            className="task-node-prompt__anchor-bind-kind"
            label="锚点类型"
            size="xs"
            data={[
              { value: 'character', label: '角色' },
              { value: 'scene', label: '场景' },
              { value: 'prop', label: '道具' },
              { value: 'shot', label: '分镜' },
              { value: 'story', label: '剧情' },
              { value: 'asset', label: '资产' },
              { value: 'context', label: '上下文' },
              { value: 'authority_base_frame', label: '权威基底帧' },
            ]}
            value={anchorBindingKind}
            onChange={setAnchorBindingKind}
            allowDeselect={false}
            style={{ width: 140 }}
          />
          <TextInput
            className="task-node-prompt__anchor-bind-input"
            label="锚点名称"
            size="xs"
            value={anchorBindingLabel}
            onChange={(e) => setAnchorBindingLabel(e.currentTarget.value)}
            placeholder="例如：方源 / 青茅山宗祠 / 春秋蝉"
            style={{ flex: 1, minWidth: 180 }}
          />
          <Button
            className="task-node-prompt__anchor-bind-btn"
            size="xs"
            variant="light"
            color="grape"
            loading={bindAnchorLoading}
            disabled={bindAnchorDisabled}
            onClick={onBindPrimaryAnchor}
          >
            绑定当前主图
          </Button>
        </Group>
        <Text className="task-node-prompt__anchor-bind-hint" size="xs" c="dimmed" mt={6}>
          绑定后，节点当前主图会写入统一的 anchorBindings；角色、场景、道具、分镜和其他资产都走同一套锚点定义。
        </Text>
        {!!bindAnchorStatusText && (
          <Text className="task-node-prompt__anchor-bind-status" size="xs" c="dimmed" mt={4}>
            {bindAnchorStatusText}
          </Text>
        )}
        </div>
      )}
    </div>
  )
}

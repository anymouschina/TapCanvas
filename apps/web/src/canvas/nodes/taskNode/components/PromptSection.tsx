import React from 'react'
import { ActionIcon, Textarea, Text } from '@mantine/core'
import { IconBrain, IconBulb } from '@tabler/icons-react'
import { SystemPromptPanel } from '../../../components/SystemPromptPanel'

type PromptSectionProps = {
  isCharacterNode: boolean
  isComposerNode: boolean
  isStoryboardNode: boolean
  hasSystemPrompt: boolean
  prompt: string
  setPrompt: (value: string) => void
  onUpdateNodeData: (patch: any) => void
  suggestionsAllowed: boolean
  suggestionsEnabled: boolean
  setSuggestionsEnabled: (value: boolean) => void
  promptSuggestions: string[]
  activeSuggestion: number
  setActiveSuggestion: (value: number) => void
  setPromptSuggestions: (value: string[]) => void
  markPromptUsed: (value: string) => void
  mentionOpen: boolean
  mentionItems: any[]
  mentionLoading: boolean
  mentionFilter: string
  setMentionFilter: (value: string) => void
  setMentionOpen: (value: boolean) => void
  mentionMetaRef: React.MutableRefObject<{ at: number; caret: number } | null>
  showSystemPrompt: boolean
  systemPrompt: string
  handleSystemPromptToggle: (value: boolean) => void
  handleSystemPromptChange: (value: string) => void
  isDarkUi: boolean
  nodeShellText: string
  onOpenPromptSamples?: () => void
}

export function PromptSection({
  isCharacterNode,
  isComposerNode,
  isStoryboardNode,
  hasSystemPrompt,
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
  showSystemPrompt,
  systemPrompt,
  handleSystemPromptToggle,
  handleSystemPromptChange,
  isDarkUi,
  nodeShellText,
  onOpenPromptSamples,
}: PromptSectionProps) {
  return (
    <div className="task-node-prompt__root" style={{ position: 'relative' }}>
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
        {onOpenPromptSamples && (
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
        <ActionIcon
          className="task-node-prompt__toolbar-button"
          variant="subtle"
          size="xs"
          onClick={() => setSuggestionsEnabled(!suggestionsEnabled)}
          title={suggestionsEnabled ? '智能建议已启用 (Ctrl/Cmd+Space 切换)' : '智能建议已禁用 (Ctrl/Cmd+Space 启用)'}
          style={{
            background: suggestionsEnabled ? 'rgba(59, 130, 246, 0.1)' : 'rgba(107, 114, 128, 0.1)',
            border: 'none',
          }}
        >
          <IconBrain
            className="task-node-prompt__toolbar-icon"
            size={12}
            style={{ color: suggestionsEnabled ? 'rgb(59, 130, 246)' : 'rgb(107, 114, 128)' }}
          />
        </ActionIcon>
      </div>
      <Textarea
        className="task-node-prompt__textarea"
        autosize
        minRows={2}
        maxRows={6}
        placeholder="在这里输入提示词... (输入6个字符后按 Ctrl/Cmd+Space 激活智能建议)"
        value={prompt}
        onChange={(e) => {
          const el = e.currentTarget
          const v = el.value
          setPrompt(v)
          onUpdateNodeData({ prompt: v })

          const caret = typeof el.selectionStart === 'number' ? el.selectionStart : v.length
          const before = v.slice(0, caret)
          const lastAt = before.lastIndexOf('@')
          const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))
          if (lastAt >= 0 && lastAt >= lastSpace) {
            const filter = before.slice(lastAt + 1)
            setMentionFilter(filter)
            setMentionOpen(true)
            mentionMetaRef.current = { at: lastAt, caret }
          } else {
            setMentionOpen(false)
            setMentionFilter('')
            mentionMetaRef.current = null
          }
        }}
        onBlur={() => {
          setPromptSuggestions([])
          setMentionOpen(false)
          setMentionFilter('')
        }}
        onKeyDown={(e) => {
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
      {promptSuggestions.length > 0 && (
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
      {mentionOpen && mentionItems.length > 0 && (
        <div
          className="task-node-prompt__mentions"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 6,
            borderRadius: 10,
            padding: 8,
            background: isDarkUi ? 'rgba(0,0,0,0.72)' : '#fff',
            boxShadow: '0 16px 32px rgba(0,0,0,0.25)',
            zIndex: 32,
          }}
        >
          <Text className="task-node-prompt__mentions-title" size="xs" c="dimmed" mb={4}>
            选择角色引用
          </Text>
          {mentionItems.map((item: any) => (
            <div
              className="task-node-prompt__mention"
              key={item?.username || item?.id || item?.name}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer' }}
              onMouseDown={(e) => {
                e.preventDefault()
                const mention = `@${String(item?.username || '').replace(/^@/, '')}`
                const meta = mentionMetaRef.current
                if (!meta) return
                const before = prompt.slice(0, meta.at)
                const after = prompt.slice(meta.caret)
                const next = `${before}${mention}${after}`
                setPrompt(next)
                onUpdateNodeData({ prompt: next })
                setMentionOpen(false)
                setMentionFilter('')
                mentionMetaRef.current = null
              }}
            >
              <Text className="task-node-prompt__mention-name" size="sm">
                {item?.display_name || item?.username || '角色'}
              </Text>
            </div>
          ))}
          {mentionLoading && (
            <Text className="task-node-prompt__mention-loading" size="xs" c="dimmed">
              加载中...
            </Text>
          )}
          {!mentionLoading && mentionItems.length === 0 && (
            <Text className="task-node-prompt__mention-empty" size="xs" c="dimmed">
              无匹配角色
            </Text>
          )}
        </div>
      )}
      {isCharacterNode ? (
        <Text className="task-node-prompt__hint" size="xs" c="dimmed" mb={6}>
          挑选或创建角色，供后续节点通过 @角色名 自动引用。
        </Text>
      ) : (
        <Text className="task-node-prompt__hint" size="xs" c="dimmed" mb={6}>
          {isComposerNode ? '分镜/脚本（支持多镜头，当前为实验功能）' : ''}
        </Text>
      )}
      {hasSystemPrompt && (
        <SystemPromptPanel
          className="task-node-prompt__system-panel"
          target={isComposerNode || isStoryboardNode ? 'video' : 'image'}
          enabled={showSystemPrompt}
          value={systemPrompt}
          onEnabledChange={handleSystemPromptToggle}
          onChange={handleSystemPromptChange}
        />
      )}
    </div>
  )
}

import React from 'react'
import { ActionIcon, Badge, Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { IconPlus, IconSparkles, IconTrash } from '@tabler/icons-react'

import {
  STORYBOARD_DURATION_STEP,
  STORYBOARD_FRAMING_OPTIONS,
  STORYBOARD_MAX_DURATION,
  STORYBOARD_MAX_TOTAL_DURATION,
  STORYBOARD_MIN_DURATION,
  STORYBOARD_MOVEMENT_OPTIONS,
  type StoryboardScene,
} from '../storyboardUtils'

type MentionMeta = {
  at: number
  caret: number
  target?: 'prompt' | 'storyboard_scene' | 'storyboard_notes'
  sceneId?: string
}

type Props = {
  scenes: StoryboardScene[]
  title: string
  notes: string
  totalDuration: number
  lightContentBackground: string
  mentionOpen: boolean
  mentionItems: any[]
  mentionLoading: boolean
  mentionFilter: string
  setMentionFilter: (value: string) => void
  setMentionOpen: (value: boolean) => void
  mentionMetaRef: React.MutableRefObject<MentionMeta | null>
  isDarkUi: boolean
  nodeShellText: string
  onGenerateScript?: () => void
  generateScriptLoading?: boolean
  generateScriptDisabled?: boolean
  onTitleChange: (value: string) => void
  onAddScene: () => void
  onRemoveScene: (id: string) => void
  onDurationDelta: (id: string, delta: number) => void
  onUpdateScene: (id: string, patch: Partial<StoryboardScene>) => void
  onNotesChange: (value: string) => void
}

export function StoryboardEditor({
  scenes,
  title,
  notes,
  totalDuration,
  lightContentBackground,
  mentionOpen,
  mentionItems,
  mentionLoading,
  mentionFilter,
  setMentionFilter,
  setMentionOpen,
  mentionMetaRef,
  isDarkUi,
  nodeShellText,
  onGenerateScript,
  generateScriptLoading,
  generateScriptDisabled,
  onTitleChange,
  onAddScene,
  onRemoveScene,
  onDurationDelta,
  onUpdateScene,
  onNotesChange,
}: Props) {
  const sceneTextareaRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({})
  const notesTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [activeMention, setActiveMention] = React.useState(0)

  React.useEffect(() => {
    if (!mentionOpen) {
      setActiveMention(0)
      return
    }
    setActiveMention(0)
  }, [mentionOpen, mentionItems.length])

  const detectMention = React.useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret)
    const lastAt = before.lastIndexOf('@')
    const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))
    if (lastAt >= 0 && lastAt >= lastSpace) {
      return { at: lastAt, filter: before.slice(lastAt + 1) }
    }
    return null
  }, [])

  const closeMentions = React.useCallback(() => {
    setMentionOpen(false)
    setMentionFilter('')
    mentionMetaRef.current = null
  }, [mentionMetaRef, setMentionFilter, setMentionOpen])

  const applyMention = React.useCallback((item: any) => {
    const usernameRaw = String(item?.username || '').replace(/^@/, '').trim()
    if (!usernameRaw) return
    const mention = `@${usernameRaw}`
    const meta = mentionMetaRef.current
    if (!meta) return

    if (meta.target === 'storyboard_scene' && meta.sceneId) {
      const scene = scenes.find((s) => s.id === meta.sceneId)
      if (!scene) return
      const current = String(scene.description || '')
      const before = current.slice(0, meta.at)
      const after = current.slice(meta.caret)
      const needsSpace = after.length === 0 || !/^\s/.test(after)
      const suffix = needsSpace ? ' ' : ''
      const next = `${before}${mention}${suffix}${after}`
      const nextCaret = before.length + mention.length + suffix.length
      onUpdateScene(meta.sceneId, { description: next })
      closeMentions()
      window.requestAnimationFrame(() => {
        const el = sceneTextareaRefs.current[meta.sceneId!]
        if (!el) return
        try {
          el.focus()
          el.setSelectionRange(nextCaret, nextCaret)
        } catch {
          // ignore
        }
      })
      return
    }

    if (meta.target === 'storyboard_notes') {
      const current = String(notes || '')
      const before = current.slice(0, meta.at)
      const after = current.slice(meta.caret)
      const needsSpace = after.length === 0 || !/^\s/.test(after)
      const suffix = needsSpace ? ' ' : ''
      const next = `${before}${mention}${suffix}${after}`
      const nextCaret = before.length + mention.length + suffix.length
      onNotesChange(next)
      closeMentions()
      window.requestAnimationFrame(() => {
        const el = notesTextareaRef.current
        if (!el) return
        try {
          el.focus()
          el.setSelectionRange(nextCaret, nextCaret)
        } catch {
          // ignore
        }
      })
    }
  }, [closeMentions, mentionMetaRef, notes, onNotesChange, onUpdateScene, scenes])

  const handleMentionKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && mentionOpen) {
      e.stopPropagation()
      closeMentions()
      return
    }

    if (!mentionOpen) return

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
    }
  }, [activeMention, applyMention, closeMentions, mentionItems, mentionOpen])

  const mentionOverlay = mentionOpen ? (
    <div
      className="storyboard-editor-mentions"
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
      <Text className="storyboard-editor-mentions-title" size="xs" c="dimmed" mb={4}>
        选择角色引用
      </Text>
      {mentionItems.map((item: any, idx: number) => {
        const avatar =
          (typeof item?.profile_picture_url === 'string' && item.profile_picture_url.trim()) ||
          (typeof item?.profilePictureUrl === 'string' && item.profilePictureUrl.trim()) ||
          null
        const username = String(item?.username || '').replace(/^@/, '').trim()
        const display = String(item?.display_name || item?.displayName || item?.username || '角色')
        return (
          <div
            className="storyboard-editor-mention"
            key={username || item?.id || idx}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              background: idx === activeMention ? 'rgba(59,130,246,0.15)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseDown={(ev) => {
              ev.preventDefault()
              applyMention(item)
            }}
            onMouseEnter={() => setActiveMention(idx)}
          >
            {avatar && (
              <img
                className="storyboard-editor-mention-avatar"
                src={avatar}
                alt={username ? `@${username}` : 'avatar'}
                style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
            )}
            <div className="storyboard-editor-mention-text" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <Text className="storyboard-editor-mention-name" size="sm" style={{ color: nodeShellText }} lineClamp={1}>
                {display}
              </Text>
              {username && (
                <Text className="storyboard-editor-mention-username" size="xs" c="dimmed" lineClamp={1}>
                  @{username}
                </Text>
              )}
            </div>
          </div>
        )
      })}
      {mentionLoading && (
        <Text className="storyboard-editor-mention-loading" size="xs" c="dimmed">
          加载中...
        </Text>
      )}
      {!mentionLoading && mentionItems.length === 0 && (
        <Text className="storyboard-editor-mention-empty" size="xs" c="dimmed">
          {mentionFilter.trim() ? '无匹配角色' : '暂无可用角色'}
        </Text>
      )}
    </div>
  ) : null

  return (
    <Stack className="storyboard-editor" gap="xs">
      <TextInput
        className="storyboard-editor-title-input"
        label="分镜标题"
        placeholder="例如：武侠对决 · 紫禁之巅"
        value={title}
        onChange={(e) => onTitleChange(e.currentTarget.value)}
        size="xs"
      />
      <Group className="storyboard-editor-script-actions" justify="space-between" align="center" wrap="wrap" gap="xs">
        <Text className="storyboard-editor-script-hint" size="xs" c="dimmed">
          可连接文本/图片节点作为参考，自动生成分镜脚本与镜头参数。
        </Text>
        <Button
          className="storyboard-editor-script-generate"
          size="xs"
          variant="light"
          leftSection={<IconSparkles className="storyboard-editor-script-generate-icon" size={14} />}
          onClick={onGenerateScript}
          disabled={!onGenerateScript || !!generateScriptDisabled}
          loading={!!generateScriptLoading}
        >
          生成脚本
        </Button>
      </Group>
      <Stack className="storyboard-editor-scenes" gap="xs">
        {scenes.map((scene, idx) => (
          <Paper
            className="storyboard-editor-scene"
            key={scene.id}
            radius="md"
            p="xs"
            style={{ background: lightContentBackground, position: 'relative' }}
          >
            <Group className="storyboard-editor-scene-header" justify="space-between" align="flex-start" mb={6}>
              <div className="storyboard-editor-scene-title">
                <Text className="storyboard-editor-scene-name" size="sm" fw={600}>{`Scene ${idx + 1}`}</Text>
                <Text className="storyboard-editor-scene-desc" size="xs" c="dimmed">
                  镜头描述与台词
                </Text>
              </div>
              <Group className="storyboard-editor-scene-actions" gap={4}>
                <Badge className="storyboard-editor-scene-duration" color="blue" variant="light">
                  {scene.duration.toFixed(1)}s
                </Badge>
                <Button
                  className="storyboard-editor-scene-duration-add"
                  size="compact-xs"
                  variant="light"
                  onClick={() => onDurationDelta(scene.id, 15)}
                  disabled={scene.duration >= STORYBOARD_MAX_DURATION}
                >
                  +15s
                </Button>
                <ActionIcon
                  className="storyboard-editor-scene-remove"
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={() => onRemoveScene(scene.id)}
                  disabled={scenes.length === 1}
                  title="删除该 Scene"
                >
                  <IconTrash className="storyboard-editor-scene-remove-icon" size={14} />
                </ActionIcon>
              </Group>
            </Group>
            <Textarea
              className="storyboard-editor-scene-text"
              ref={(el) => {
                sceneTextareaRefs.current[scene.id] = el
              }}
              autosize
              minRows={3}
              maxRows={6}
              placeholder="描写镜头构图、动作、情绪、台词，以及需要引用的 @角色……"
              value={scene.description}
              onChange={(e) => {
                const el = e.currentTarget
                const v = el.value
                onUpdateScene(scene.id, { description: v })
                const caret = typeof el.selectionStart === 'number' ? el.selectionStart : v.length
                const hit = detectMention(v, caret)
                if (hit) {
                  setMentionFilter(hit.filter)
                  setMentionOpen(true)
                  mentionMetaRef.current = { at: hit.at, caret, target: 'storyboard_scene', sceneId: scene.id }
                } else {
                  const meta = mentionMetaRef.current
                  if (meta?.target === 'storyboard_scene' && meta.sceneId === scene.id) {
                    closeMentions()
                  }
                }
              }}
              onBlur={() => {
                const meta = mentionMetaRef.current
                if (meta?.target === 'storyboard_scene' && meta.sceneId === scene.id) {
                  closeMentions()
                }
              }}
              onKeyDown={handleMentionKeyDown}
            />
            {(() => {
              const meta = mentionMetaRef.current
              return meta?.target === 'storyboard_scene' && meta.sceneId === scene.id && mentionOverlay
            })()}
            <Group className="storyboard-editor-scene-controls" gap="xs" mt={6} align="flex-end" wrap="wrap">
              <Select
                className="storyboard-editor-scene-select"
                label="镜头景别"
                placeholder="可选"
                data={STORYBOARD_FRAMING_OPTIONS}
                value={scene.framing || null}
                onChange={(value) =>
                  onUpdateScene(scene.id, {
                    framing: (value as StoryboardScene['framing']) || undefined,
                  })
                }
                size="xs"
                withinPortal
                clearable
              />
              <Select
                className="storyboard-editor-scene-select"
                label="镜头运动"
                placeholder="可选"
                data={STORYBOARD_MOVEMENT_OPTIONS}
                value={scene.movement || null}
                onChange={(value) =>
                  onUpdateScene(scene.id, {
                    movement: (value as StoryboardScene['movement']) || undefined,
                  })
                }
                size="xs"
                withinPortal
                clearable
              />
              <NumberInput
                className="storyboard-editor-scene-duration-input"
                label="时长 (秒)"
                size="xs"
                min={STORYBOARD_MIN_DURATION}
                max={STORYBOARD_MAX_DURATION}
                step={STORYBOARD_DURATION_STEP}
                value={scene.duration}
                onChange={(value) => {
                  const next = typeof value === 'number' ? value : Number(value) || scene.duration
                  onUpdateScene(scene.id, { duration: next })
                }}
                style={{ width: 120 }}
              />
            </Group>
          </Paper>
        ))}
      </Stack>
      <Button
        className="storyboard-editor-add"
        variant="light"
        size="xs"
        leftSection={<IconPlus className="storyboard-editor-add-icon" size={14} />}
        onClick={onAddScene}
      >
        添加 Scene
      </Button>
      <div className="storyboard-editor-notes-wrap" style={{ position: 'relative' }}>
        <Textarea
          className="storyboard-editor-notes"
          ref={notesTextareaRef}
          label="全局风格 / 备注"
          autosize
          minRows={2}
          maxRows={4}
          placeholder="补充整体风格、镜头节奏、素材要求，或写下 Sora 需要遵循的额外说明。"
          value={notes}
          onChange={(e) => {
            const el = e.currentTarget
            const v = el.value
            onNotesChange(v)
            const caret = typeof el.selectionStart === 'number' ? el.selectionStart : v.length
            const hit = detectMention(v, caret)
            if (hit) {
              setMentionFilter(hit.filter)
              setMentionOpen(true)
              mentionMetaRef.current = { at: hit.at, caret, target: 'storyboard_notes' }
            } else {
              const meta = mentionMetaRef.current
              if (meta?.target === 'storyboard_notes') {
                closeMentions()
              }
            }
          }}
          onBlur={() => {
            const meta = mentionMetaRef.current
            if (meta?.target === 'storyboard_notes') {
              closeMentions()
            }
          }}
          onKeyDown={handleMentionKeyDown}
        />
        {(() => {
          const meta = mentionMetaRef.current
          return meta?.target === 'storyboard_notes' && mentionOverlay
        })()}
      </div>
      <Group className="storyboard-editor-summary" justify="space-between">
        <Text className="storyboard-editor-summary-text" size="xs" c="dimmed">
          当前共 {scenes.length} 个镜头。You're using {scenes.length} video gens with current settings.
        </Text>
        <Text
          className="storyboard-editor-summary-duration"
          size="xs"
          c={totalDuration > STORYBOARD_MAX_TOTAL_DURATION ? 'red.4' : 'dimmed'}
        >
          总时长 {totalDuration.toFixed(1)}s / {STORYBOARD_MAX_TOTAL_DURATION}s
        </Text>
      </Group>
    </Stack>
  )
}

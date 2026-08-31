import React from 'react'
import { createPortal } from 'react-dom'
import { Popover, Text, Box } from '@mantine/core'
import { IconChevronDown, IconPalette } from '@tabler/icons-react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { useUIStore } from '../uiStore'
import {
  useProjectImageSettings,
  useProjectImageSettingsStore,
  deriveStyleBibleFromLockedStyle,
  type LockedStyle,
} from '../../canvas/projectImageSettingsStore'
import { StyleLibraryPanel } from './StyleLibraryPanel'

// 全局风格锁的外显入口：常驻画布顶部工具栏（tc-canvas-visibility-slot）。
// 显示当前锁定风格缩略图+名字+⌄；点开风格库面板单选锁定。节点自带风格图时由生成层覆盖（见 globalStyleReferenceInjection）。
export type GlobalStyleChipProps = {
  embedded?: boolean
  onSelected?: () => void
  onClose?: () => void
}

export function GlobalStyleChip({
  embedded = false,
  onSelected,
  onClose,
}: GlobalStyleChipProps = {}) {
  const projectId = useUIStore((s) => String(s.currentProject?.id || '').trim())
  const setActiveStyleBible = useUIStore((s) => s.setActiveStyleBible)
  const styleReferenceRequest = useUIStore((s) => s.styleReferenceRequest)
  const resolveStyleReferenceRequest = useUIStore((s) => s.resolveStyleReferenceRequest)
  const cancelStyleReferenceRequest = useUIStore((s) => s.cancelStyleReferenceRequest)
  const settings = useProjectImageSettings(projectId)
  const lockedStyle = settings.lockedStyle
  const setLockedStyle = useProjectImageSettingsStore((s) => s.setLockedStyle)
  const ensureHydrated = useProjectImageSettingsStore((s) => s.ensureHydratedStyleImages)

  const [opened, setOpened] = React.useState(false)
  const [slot, setSlot] = React.useState<HTMLElement | null>(null)

  // portal 目标在 App 渲染后才存在：挂载后取一次。
  React.useEffect(() => {
    if (!embedded) setSlot(document.getElementById('tc-canvas-visibility-slot'))
  }, [embedded])

  // 进项目时从服务端拉取锁定风格（每项目每会话一次）。
  React.useEffect(() => {
    if (projectId) ensureHydrated(projectId)
  }, [projectId, ensureHydrated])

  // 单一真相源：activeStyleBible 由 lockedStyle 派生，供出图注入消费。
  React.useEffect(() => {
    setActiveStyleBible(deriveStyleBibleFromLockedStyle(lockedStyle))
  }, [lockedStyle, setActiveStyleBible])

  // 缺画风请求（角色卡/故事板）唤起本面板；token 变化即重开。
  const lastRequestTokenRef = React.useRef(0)
  React.useEffect(() => {
    if (!styleReferenceRequest) return
    if (styleReferenceRequest.token === lastRequestTokenRef.current) return
    lastRequestTokenRef.current = styleReferenceRequest.token
    setOpened(true)
  }, [styleReferenceRequest])

  const afterPick = React.useCallback(
    (refs: string[]) => {
      setOpened(false)
      // 若存在缺画风请求，回填参考图让原操作（角色卡/故事板）自动继续。
      if (useUIStore.getState().styleReferenceRequest) {
        resolveStyleReferenceRequest(refs)
      }
      onSelected?.()
    },
    [onSelected, resolveStyleReferenceRequest],
  )

  const handlePickPreset = React.useCallback(
    (lock: LockedStyle) => {
      if (projectId) setLockedStyle(projectId, lock)
      afterPick(lock.referenceImageUrl ? [lock.referenceImageUrl] : [])
    },
    [projectId, setLockedStyle, afterPick],
  )

  const handlePickCustom = React.useCallback(
    (stylePrompt: string) => {
      if (projectId) {
        setLockedStyle(projectId, {
          styleId: 'custom',
          styleName: '自定义风格',
          referenceImageUrl: null,
          stylePrompt,
        })
      }
      // 自定义文字风格无图：无法满足「必须有参考图」的缺画风请求，仅关闭面板。
      setOpened(false)
      onSelected?.()
    },
    [onSelected, projectId, setLockedStyle],
  )

  const handleClear = React.useCallback(() => {
    if (projectId) setLockedStyle(projectId, null)
    if (useUIStore.getState().styleReferenceRequest) cancelStyleReferenceRequest()
    onSelected?.()
  }, [cancelStyleReferenceRequest, onSelected, projectId, setLockedStyle])

  if (!projectId || (!embedded && !slot)) return null

  const thumbUrl = lockedStyle?.referenceImageUrl || ''
  const label = lockedStyle?.styleName || '选择风格'

  const panel = (
    <StyleLibraryPanel
      selectedStyleId={lockedStyle?.styleId ?? null}
      onPickPreset={handlePickPreset}
      onPickCustom={handlePickCustom}
      onClear={handleClear}
      onClose={onClose}
    />
  )

  if (embedded) return panel

  const chip = (
    <Popover
      opened={opened}
      onChange={(next) => {
        setOpened(next)
        if (!next && useUIStore.getState().styleReferenceRequest) cancelStyleReferenceRequest()
      }}
      position="bottom-end"
      shadow="md"
      radius="sm"
      withinPortal
      trapFocus={false}
    >
      <Popover.Target>
        <Box
          className="global-style-chip"
          onClick={() => setOpened((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px 4px 4px',
            borderRadius: 6,
            cursor: 'pointer',
            background: 'var(--tc-color-surface-raised, var(--mantine-color-body))',
            border: '1px solid var(--tc-color-border-subtle, var(--mantine-color-gray-3))',
            color: 'var(--tc-color-text-primary, inherit)',
          }}
        >
          {thumbUrl ? (
            <Box style={{ width: 24, height: 24, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
              <ManagedImage
                className="global-style-chip-thumb"
                src={thumbUrl}
                alt={label}
                priority="visible"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </Box>
          ) : (
            <Box
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--tc-color-surface-inline, var(--mantine-color-gray-1))',
              }}
            >
              <IconPalette size={14} />
            </Box>
          )}
          <Text size="xs" fw={500} lineClamp={1} style={{ maxWidth: 120 }}>{label}</Text>
          <IconChevronDown size={14} />
        </Box>
      </Popover.Target>
      <Popover.Dropdown p="md">
        {panel}
      </Popover.Dropdown>
    </Popover>
  )

  return createPortal(chip, slot as HTMLElement)
}

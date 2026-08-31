import React from 'react'
import { createPortal } from 'react-dom'
import { Popover, Text, Box, TextInput, ScrollArea, UnstyledButton, Divider } from '@mantine/core'
import { IconChevronDown, IconMovie, IconSearch, IconX } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import {
  getProjectDirectorPersona,
  listDirectorPersonas,
  setProjectDirectorPersona,
  type DirectorPersonaSummary,
  type ProjectDirectorPersona,
} from '../api/server'

// 项目级「导演人格」的常驻画布入口：与 GlobalStyleChip 并排挂在 tc-canvas-visibility-slot。
// 画风槽管"长什么样"，本 chip 管"怎么拍"——选定后写 canvas-index.json directorPersona，
// agents-bridge 每轮对话注入锁定块（人格池 = knowledge/作者导演美学 知识卡，单一真相源）。
// 与一键出片弹窗里的选择器读写同一服务端字段，跨入口用 window 事件保持显示同步。

export const DIRECTOR_PERSONA_CHANGED_EVENT = 'tc:director-persona-changed'

export function emitDirectorPersonaChanged(persona: ProjectDirectorPersona | null) {
  window.dispatchEvent(new CustomEvent(DIRECTOR_PERSONA_CHANGED_EVENT, { detail: persona }))
}

export type DirectorPersonaChipProps = {
  embedded?: boolean
  onSelected?: () => void
}

export function DirectorPersonaChip({
  embedded = false,
  onSelected,
}: DirectorPersonaChipProps = {}) {
  const projectId = useUIStore((s) => String(s.currentProject?.id || '').trim())
  const [opened, setOpened] = React.useState(false)
  const [slot, setSlot] = React.useState<HTMLElement | null>(null)
  const [pool, setPool] = React.useState<DirectorPersonaSummary[]>([])
  const [current, setCurrent] = React.useState<ProjectDirectorPersona | null>(null)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    if (!embedded) setSlot(document.getElementById('tc-canvas-visibility-slot'))
  }, [embedded])

  // 进项目时拉当前选定人格；其它入口（一键出片弹窗）改动经事件同步。
  React.useEffect(() => {
    if (!projectId) {
      setCurrent(null)
      return
    }
    let cancelled = false
    void getProjectDirectorPersona(projectId)
      .then((p) => {
        if (!cancelled) setCurrent(p)
      })
      .catch(() => {
        if (!cancelled) setCurrent(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  React.useEffect(() => {
    const onChanged = (e: Event) => {
      setCurrent(((e as CustomEvent).detail ?? null) as ProjectDirectorPersona | null)
    }
    window.addEventListener(DIRECTOR_PERSONA_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(DIRECTOR_PERSONA_CHANGED_EVENT, onChanged)
  }, [])

  // 人格池懒加载：首次点开时拉一次（服务端本身有 60s 缓存）。
  React.useEffect(() => {
    if ((!opened && !embedded) || pool.length > 0) return
    void listDirectorPersonas()
      .then(setPool)
      .catch(() => setPool([]))
  }, [embedded, opened, pool.length])

  const pick = React.useCallback(
    (persona: ProjectDirectorPersona | null) => {
      setCurrent(persona)
      setOpened(false)
      setQuery('')
      onSelected?.()
      if (!projectId) return
      void setProjectDirectorPersona(projectId, persona)
        .then(() => emitDirectorPersonaChanged(persona))
        .catch((err) => console.warn('保存导演风格失败', err))
    },
    [onSelected, projectId],
  )

  if (!projectId || (!embedded && !slot)) return null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? pool.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.keywords.some((k) => k.toLowerCase().includes(q)),
      )
    : pool
  const label = current?.personaName || '选择导演'

  const panel = (
    <div className="director-persona-panel">
      <TextInput
        className="director-persona-panel-search"
        size="xs"
        placeholder="搜索导演/关键词（如 悲喜剧、武侠、赛璐璐）"
        leftSection={<IconSearch className="director-persona-panel-search-icon" size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        mb={8}
      />
      <ScrollArea.Autosize className="director-persona-panel-scroll" mah={360} type="auto">
        {current ? (
          <>
            <UnstyledButton
              className="director-persona-panel-clear"
              onClick={() => pick(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 8px' }}
            >
              <IconX className="director-persona-panel-clear-icon" size={14} />
              <Text className="director-persona-panel-clear-label" size="xs" c="dimmed">清除锁定（由小T自选人格）</Text>
            </UnstyledButton>
            <Divider className="director-persona-panel-divider" my={4} />
          </>
        ) : null}
        {filtered.length === 0 ? (
          <Text className="director-persona-panel-empty" size="xs" c="dimmed" p="sm">
            {pool.length === 0 ? '人格池加载中…' : '没有匹配的导演'}
          </Text>
        ) : (
          filtered.map((p) => {
            const selected = current?.personaId === p.id
            return (
              <UnstyledButton
                className="director-persona-panel-option"
                key={p.id}
                onClick={() => pick({ personaId: p.id, personaName: p.name })}
                data-selected={selected || undefined}
              >
                <Text className="director-persona-panel-option-name" size="sm" fw={selected ? 600 : 500}>{p.name}</Text>
                {p.description ? (
                  <Text className="director-persona-panel-option-description" size="xs" c="dimmed" lineClamp={1}>{p.description}</Text>
                ) : null}
              </UnstyledButton>
            )
          })
        )}
      </ScrollArea.Autosize>
    </div>
  )

  if (embedded) return panel

  const chip = (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      radius="lg"
      withinPortal
      trapFocus={false}
    >
      <Popover.Target>
        <Box
          className="director-persona-chip"
          onClick={() => setOpened((v) => !v)}
          title="导演风格（项目级锁定，决定整片怎么拍）"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px 4px 4px',
            borderRadius: 999,
            cursor: 'pointer',
            background: 'var(--mantine-color-body)',
            border: '1px solid var(--mantine-color-gray-3)',
          }}
        >
          <Box
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: current ? 'var(--mantine-color-grape-1)' : 'var(--mantine-color-gray-1)',
            }}
          >
            <IconMovie size={14} />
          </Box>
          <Text size="xs" fw={500} lineClamp={1} style={{ maxWidth: 120 }}>{label}</Text>
          <IconChevronDown size={14} />
        </Box>
      </Popover.Target>
      <Popover.Dropdown p="sm" style={{ width: 340 }}>
        {panel}
      </Popover.Dropdown>
    </Popover>
  )

  return createPortal(chip, slot as HTMLElement)
}

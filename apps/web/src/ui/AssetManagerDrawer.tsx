import React from 'react'
import { ActionIcon, Menu, Text, TextInput, Tooltip } from '@mantine/core'
import type { Icon } from '@tabler/icons-react'
import {
  IconBoxMultiple,
  IconCheck,
  IconChevronDown,
  IconDotsVertical,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconMovie,
  IconMusic,
  IconPencil,
  IconPhoto,
  IconPointFilled,
  IconScissors,
  IconSearch,
  IconTrash,
  IconTypography,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import MaterialLibraryPanel from './MaterialLibraryPanel'
import AssetPanel from './AssetPanel'

type CanvasFocusWindow = Window & { __tcFocusNode?: (id: string) => void }

// 面板筛选用的「节点类别」——比原始 kind 更聚合，面向用户语义。
// 注意：generated 节点常是 kind:'result'，必须按 videoUrl/imageUrl/audioUrl 兜底归类，
// 否则视频/图片成片会落到「其他」而不是「视频」「图像」。
type NodeCategory = 'text' | 'image' | 'storyboard' | 'video' | 'audio' | 'directorConsole' | 'group' | 'other'

const CATEGORY_META: Record<NodeCategory, { label: string; Icon: Icon }> = {
  text: { label: '文本', Icon: IconTypography },
  image: { label: '图像', Icon: IconPhoto },
  storyboard: { label: '分镜', Icon: IconLayoutGrid },
  video: { label: '视频', Icon: IconVideo },
  audio: { label: '音频', Icon: IconMusic },
  directorConsole: { label: '导演台', Icon: IconMovie },
  group: { label: '组', Icon: IconBoxMultiple },
  other: { label: '其他', Icon: IconScissors },
}

const CATEGORY_ORDER: NodeCategory[] = ['text', 'image', 'storyboard', 'video', 'audio', 'directorConsole', 'group', 'other']

function hasStr(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function nodeCategory(node: { type?: string; data?: unknown }): NodeCategory {
  const data = (node.data && typeof node.data === 'object') ? (node.data as Record<string, unknown>) : null
  const type = typeof node.type === 'string' ? node.type : ''
  if (type === 'groupNode') return 'group'
  const kind = ((typeof data?.kind === 'string' && data.kind.trim()) ? data.kind.trim() : type).toLowerCase()
  if (kind === 'group') return 'group'
  if (kind === 'text') return 'text'
  if (kind === 'video' || kind === 'videocompose' || kind === 'composevideo' || hasStr(data?.videoUrl)) return 'video'
  if (kind === 'audio' || hasStr(data?.audioUrl)) return 'audio'
  if (kind === 'storyboard' || kind === 'novelstoryboard') return 'storyboard'
  if (kind === 'directorconsole') return 'directorConsole'
  if (kind === 'image' || kind === 'imageedit' || hasStr(data?.imageUrl)) return 'image'
  return 'other'
}

function nodeLabel(node: { type?: string; data?: unknown }): string {
  const data = (node.data && typeof node.data === 'object') ? (node.data as Record<string, unknown>) : null
  return (
    (typeof data?.label === 'string' && data.label.trim()) ||
    (typeof data?.name === 'string' && data.name.trim()) ||
    (typeof node.type === 'string' && node.type) ||
    '未命名节点'
  )
}

function CanvasNodeList(): JSX.Element {
  const nodes = useRFStore((s) => s.nodes)
  const updateNodeData = useRFStore((s) => s.updateNodeData)
  const deleteNode = useRFStore((s) => s.deleteNode)
  const [query, setQuery] = React.useState('')
  const [catFilter, setCatFilter] = React.useState<NodeCategory | 'all'>('all')
  // 行内重命名：editingId 命中时该行渲染输入框；提交走 updateNodeData(写 React Flow 状态→
  // 前端 autosave 持久化，正是直改 DB 会被 clobber 的反面正解)。
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editValue, setEditValue] = React.useState('')

  const startRename = React.useCallback((id: string, current: string) => {
    setEditingId(id)
    setEditValue(current)
  }, [])
  const commitRename = React.useCallback(() => {
    setEditingId((id) => {
      if (id) {
        const next = editValue.trim()
        if (next) updateNodeData(id, { label: next })
      }
      return null
    })
  }, [editValue, updateNodeData])
  const cancelRename = React.useCallback(() => setEditingId(null), [])
  const handleDelete = React.useCallback((id: string, label: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`删除节点「${label}」？此操作不可撤销。`)) return
    deleteNode(id)
  }, [deleteNode])

  // 仅列顶层节点（组内子节点不单独列出，避免噪声）。
  const topNodes = React.useMemo(
    () => nodes.filter((n) => !(n as { parentId?: string }).parentId && !(n as { parentNode?: string }).parentNode),
    [nodes],
  )

  // 类别筛选：按规范顺序列出画布中实际存在的类别（文本/图像/视频/…）及各自数量，
  // 不显示 0 节点的类别。
  const categoriesPresent = React.useMemo(() => {
    const counts = new Map<NodeCategory, number>()
    topNodes.forEach((n) => {
      const c = nodeCategory(n)
      counts.set(c, (counts.get(c) ?? 0) + 1)
    })
    return CATEGORY_ORDER.filter((k) => counts.has(k)).map((k) => ({ key: k, count: counts.get(k) ?? 0 }))
  }, [topNodes])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return topNodes.filter((n) => {
      if (catFilter !== 'all' && nodeCategory(n) !== catFilter) return false
      if (!q) return true
      return nodeLabel(n).toLowerCase().includes(q) || n.id.toLowerCase().includes(q)
    })
  }, [topNodes, query, catFilter])

  const focusNode = React.useCallback((id: string) => {
    const fn = (window as CanvasFocusWindow).__tcFocusNode
    fn?.(id)
  }, [])

  const filterLabel = catFilter === 'all' ? '全部' : (CATEGORY_META[catFilter]?.label ?? '全部')

  return (
    <div className="asset-manager-drawer__canvas">
      <div className="asset-manager-drawer__toolbar">
        <Text size="xs" fw={600} c="dimmed">画布元素</Text>
        <Menu position="bottom-end" withinPortal shadow="md" radius="md" zIndex={400}>
          <Menu.Target>
            <button type="button" className="asset-manager-drawer__filter">
              {filterLabel}
              <IconChevronDown size={12} />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconCheck size={14} style={{ opacity: catFilter === 'all' ? 1 : 0 }} />}
              rightSection={<Text span size="xs" c="dimmed">{topNodes.length}</Text>}
              onClick={() => setCatFilter('all')}
            >
              全部
            </Menu.Item>
            {categoriesPresent.map(({ key, count }) => (
              <Menu.Item
                key={key}
                leftSection={<IconCheck size={14} style={{ opacity: catFilter === key ? 1 : 0 }} />}
                rightSection={<Text span size="xs" c="dimmed">{count}</Text>}
                onClick={() => setCatFilter(key)}
              >
                {CATEGORY_META[key].label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </div>

      <TextInput
        className="asset-manager-drawer__search"
        size="xs"
        leftSection={<IconSearch size={13} />}
        placeholder="搜索节点"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        rightSection={query ? (
          <ActionIcon size="xs" variant="subtle" onClick={() => setQuery('')} aria-label="清除">
            <IconX size={12} />
          </ActionIcon>
        ) : null}
      />

      <div className="asset-manager-drawer__list">
        {filtered.length === 0 ? (
          <div className="asset-manager-drawer__empty">
            <Text size="xs" c="dimmed">{topNodes.length === 0 ? '画布暂无节点' : '无匹配节点'}</Text>
          </div>
        ) : (
          filtered.map((n) => {
            const Meta = CATEGORY_META[nodeCategory(n)]
            const Icon = Meta?.Icon || IconPointFilled
            const label = nodeLabel(n)
            if (editingId === n.id) {
              return (
                <div key={n.id} className="asset-manager-drawer__node-row is-editing">
                  <span className="asset-manager-drawer__node-icon"><Icon size={15} stroke={1.8} /></span>
                  <TextInput
                    size="xs"
                    variant="filled"
                    autoFocus
                    value={editValue}
                    style={{ flex: 1 }}
                    onChange={(e) => setEditValue(e.currentTarget.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                    }}
                  />
                </div>
              )
            }
            return (
              <div
                key={n.id}
                className={['asset-manager-drawer__node-row', n.selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
              >
                <button
                  type="button"
                  className="asset-manager-drawer__node"
                  onClick={() => focusNode(n.id)}
                  onDoubleClick={() => startRename(n.id, label)}
                  title={label}
                >
                  <span className="asset-manager-drawer__node-icon"><Icon size={15} stroke={1.8} /></span>
                  <span className="asset-manager-drawer__node-label">{label}</span>
                </button>
                <Menu position="bottom-end" withinPortal shadow="md" radius="md" zIndex={400}>
                  <Menu.Target>
                    <ActionIcon
                      className="asset-manager-drawer__node-menu"
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label="节点操作"
                    >
                      <IconDotsVertical size={14} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => startRename(n.id, label)}>
                      重命名
                    </Menu.Item>
                    <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => handleDelete(n.id, label)}>
                      删除
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </div>
            )
          })
        )}
      </div>

      <div className="asset-manager-drawer__count">
        <Text size="xs" c="dimmed">共 {topNodes.length} 节点</Text>
      </div>
    </div>
  )
}

export default function AssetManagerDrawer(): JSX.Element | null {
  const open = useUIStore((s) => s.assetManagerOpen)
  const tab = useUIStore((s) => s.assetManagerTab)
  const setTab = useUIStore((s) => s.setAssetManagerTab)
  const close = useUIStore((s) => s.closeAssetManager)
  const project = useUIStore((s) => s.currentProject)
  const flow = useUIStore((s) => s.currentFlow)
  const currentChapter = useUIStore((s) => s.currentChapter)

  // 左推画布：开抽屉时给根节点设宽度变量，.app-shell-main-box / header 据此 padding-left 让位（对齐 AI 对话的 reserved-width 机制）。
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement.style
    root.setProperty('--tc-asset-drawer-width', open ? '300px' : '0px')
    return () => { root.setProperty('--tc-asset-drawer-width', '0px') }
  }, [open])

  if (!open) return null

  return (
    <div className="asset-manager-drawer" data-ux-panel>
      <div className="asset-manager-drawer__header">
        <Text size="sm" fw={600} lineClamp={1} style={{ flex: 1 }}>
          {project?.name || '未命名项目'}
          <Text span size="xs" c="dimmed" style={{ marginLeft: 6 }}>· {currentChapter?.chapterTitle || flow?.name || '画布'}</Text>
        </Text>
      </div>

      <div className="asset-manager-drawer__tabs">
        <button
          type="button"
          className={['asset-manager-drawer__tab', tab === 'canvas' ? 'is-active' : ''].filter(Boolean).join(' ')}
          onClick={() => setTab('canvas')}
        >
          画布
        </button>
        <button
          type="button"
          className={['asset-manager-drawer__tab', tab === 'catalog' ? 'is-active' : ''].filter(Boolean).join(' ')}
          onClick={() => setTab('catalog')}
        >
          目录
        </button>
        <button
          type="button"
          className={['asset-manager-drawer__tab', tab === 'assets' ? 'is-active' : ''].filter(Boolean).join(' ')}
          onClick={() => setTab('assets')}
        >
          资产
        </button>
      </div>

      <div className="asset-manager-drawer__body">
        {tab === 'canvas' ? <CanvasNodeList />
          : tab === 'catalog' ? <AssetPanel variant="catalog" />
          : <MaterialLibraryPanel variant="drawer" />}
      </div>

      <div className="asset-manager-drawer__footer">
        <Tooltip label="收起" position="top" withArrow>
          <ActionIcon variant="subtle" size="sm" aria-label="收起资产管理" onClick={close}>
            <IconLayoutSidebarLeftCollapse size={18} />
          </ActionIcon>
        </Tooltip>
      </div>
    </div>
  )
}

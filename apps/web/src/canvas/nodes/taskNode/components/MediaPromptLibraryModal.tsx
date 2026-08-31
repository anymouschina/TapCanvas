import React from 'react'
import { Modal, TextInput } from '@mantine/core'
import {
  IconCamera,
  IconChevronRight,
  IconHeart,
  IconHeartFilled,
  IconSearch,
  IconSparkles,
  IconX,
} from '@tabler/icons-react'

export type MediaPromptLibraryKind = 'effect' | 'camera'

type MediaPromptLibraryItem = {
  id: string
  label: string
  description: string
  prompt: string
}

const EFFECT_ITEMS: ReadonlyArray<MediaPromptLibraryItem> = [
  { id: 'light-scan', label: '光线扫描', description: '体积光随主体移动，强化轮廓层次', prompt: '体积光扫描画面，光影随主体移动并勾勒清晰轮廓' },
  { id: 'particle-dissolve', label: '粒子消散', description: '主体化为细密粒子并随风散开', prompt: '主体逐渐化为细密发光粒子，粒子随风自然消散' },
  { id: 'speed-lines', label: '速度线', description: '用方向性线条增强高速运动感', prompt: '加入方向一致的速度线与运动模糊，突出高速运动感' },
  { id: 'slow-trail', label: '慢动作拖影', description: '保留连续运动轨迹，动作仍可辨认', prompt: '慢动作拖影效果，保留连续而清晰的运动轨迹' },
  { id: 'flash-transition', label: '闪白转场', description: '用短促曝光完成自然镜头衔接', prompt: '使用短促闪白曝光完成自然转场，前后画面衔接流畅' },
  { id: 'liquid-transition', label: '流体转场', description: '画面以液态形变过渡到下一场景', prompt: '画面产生连贯的流体形变，并无缝过渡到下一场景' },
]

const CAMERA_ITEMS: ReadonlyArray<MediaPromptLibraryItem> = [
  { id: 'push-in', label: '缓慢推镜', description: '逐步靠近主体，集中注意力', prompt: '镜头缓慢向主体推进，运动稳定，焦点持续锁定主体' },
  { id: 'pull-out', label: '缓慢拉镜', description: '从主体退开，逐渐交代环境关系', prompt: '镜头从主体缓慢拉远，逐步揭示完整环境与空间关系' },
  { id: 'tracking', label: '跟随运镜', description: '与主体同速移动，保持构图稳定', prompt: '镜头与主体同速跟随移动，主体位置和构图保持稳定' },
  { id: 'orbit', label: '环绕运镜', description: '围绕主体形成连续空间展示', prompt: '镜头围绕主体平滑环绕，速度均匀，主体始终位于视觉中心' },
  { id: 'pan', label: '横向摇镜', description: '水平扫过场景，建立空间信息', prompt: '镜头水平缓慢摇摄，连续展示场景空间与主体关系' },
  { id: 'crane', label: '升降运镜', description: '垂直改变视点，扩展场景尺度', prompt: '镜头平稳升高并俯瞰场景，逐渐扩展空间尺度' },
  { id: 'handheld', label: '轻微手持', description: '克制的手持呼吸感，不影响辨识', prompt: '加入克制而自然的轻微手持呼吸感，主体保持清晰稳定' },
  { id: 'dolly-zoom', label: '希区柯克变焦', description: '主体尺寸稳定，背景透视快速变化', prompt: '使用希区柯克变焦，主体尺寸基本稳定，背景透视产生明显变化' },
]

type MediaPromptLibraryModalProps = {
  opened: boolean
  kind: MediaPromptLibraryKind
  onClose: () => void
  onSelect: (item: MediaPromptLibraryItem) => void
}

type MediaPromptLibraryTab = 'recommended' | 'favorites' | 'recent'

function readStoredIds(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.map((value) => String(value || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

export function MediaPromptLibraryModal({
  opened,
  kind,
  onClose,
  onSelect,
}: MediaPromptLibraryModalProps): JSX.Element {
  const [query, setQuery] = React.useState('')
  const [tab, setTab] = React.useState<MediaPromptLibraryTab>('recommended')
  const [favoriteIds, setFavoriteIds] = React.useState<Set<string>>(new Set())
  const [recentIds, setRecentIds] = React.useState<string[]>([])
  const items = kind === 'effect' ? EFFECT_ITEMS : CAMERA_ITEMS
  const title = kind === 'effect' ? '特效广场' : '运镜广场'
  const favoritesStorageKey = `tapcanvas:${kind}:library-favorites`
  const recentStorageKey = `tapcanvas:${kind}:library-recent`

  React.useEffect(() => {
    if (!opened) {
      setQuery('')
      setTab('recommended')
      return
    }
    setFavoriteIds(new Set(readStoredIds(favoritesStorageKey)))
    setRecentIds(readStoredIds(recentStorageKey))
  }, [favoritesStorageKey, opened, recentStorageKey])

  const filteredItems = React.useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const tabItems = tab === 'favorites'
      ? items.filter((item) => favoriteIds.has(item.id))
      : tab === 'recent'
        ? recentIds.map((id) => items.find((item) => item.id === id)).filter((item): item is MediaPromptLibraryItem => Boolean(item))
        : items
    if (!keyword) return tabItems
    return tabItems.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(keyword))
  }, [favoriteIds, items, query, recentIds, tab])

  const toggleFavorite = (id: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      window.localStorage.setItem(favoritesStorageKey, JSON.stringify(Array.from(next)))
      return next
    })
  }

  const selectItem = (item: MediaPromptLibraryItem) => {
    setRecentIds((current) => {
      const next = [item.id, ...current.filter((id) => id !== item.id)].slice(0, 12)
      window.localStorage.setItem(recentStorageKey, JSON.stringify(next))
      return next
    })
    onSelect(item)
  }

  return (
    <Modal
      className="tc-media-prompt-library"
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      centered
      size="min(1080px, calc(100vw - 48px))"
      padding={0}
      radius={16}
      overlayProps={{ backgroundOpacity: 0.68, blur: 4 }}
      zIndex={4200}
    >
      <div className="tc-media-prompt-library__shell">
        <header className="tc-media-prompt-library__header">
          <div className="tc-media-prompt-library__title-wrap">
            {kind === 'effect'
              ? <IconSparkles className="tc-media-prompt-library__title-icon" size={20} stroke={1.8} />
              : <IconCamera className="tc-media-prompt-library__title-icon" size={20} stroke={1.8} />}
            <h2 className="tc-media-prompt-library__title">{title}</h2>
          </div>
          <button className="tc-media-prompt-library__close" type="button" aria-label={`关闭${title}`} onClick={onClose}>
            <IconX className="tc-media-prompt-library__close-icon" size={20} stroke={1.8} />
          </button>
        </header>
        <div className="tc-media-prompt-library__toolbar">
          <TextInput
            className="tc-media-prompt-library__search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={`搜索${kind === 'effect' ? '特效' : '运镜'}名称`}
            leftSection={<IconSearch className="tc-media-prompt-library__search-icon" size={17} stroke={1.8} />}
          />
          <div className="tc-media-prompt-library__tabs" role="tablist" aria-label={title}>
            {([
              ['recommended', '推荐'],
              ['favorites', '我的收藏'],
              ['recent', '最近使用'],
            ] as const).map(([value, label]) => (
              <button
                className={`tc-media-prompt-library__tab${tab === value ? ' tc-media-prompt-library__tab--active' : ''}`}
                type="button"
                role="tab"
                key={value}
                aria-selected={tab === value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="tc-media-prompt-library__grid">
          {filteredItems.map((item) => (
            <article className="tc-media-prompt-library__card" key={item.id}>
              <button className="tc-media-prompt-library__card-select" type="button" onClick={() => selectItem(item)}>
                <span className="tc-media-prompt-library__card-copy">
                  <span className="tc-media-prompt-library__card-title">{item.label}</span>
                  <span className="tc-media-prompt-library__card-description">{item.description}</span>
                </span>
                <IconChevronRight className="tc-media-prompt-library__card-chevron" size={18} stroke={1.8} />
              </button>
              <button
                className="tc-media-prompt-library__favorite"
                type="button"
                aria-label={`${favoriteIds.has(item.id) ? '取消收藏' : '收藏'}${item.label}`}
                onClick={() => toggleFavorite(item.id)}
              >
                {favoriteIds.has(item.id)
                  ? <IconHeartFilled className="tc-media-prompt-library__favorite-icon" size={17} />
                  : <IconHeart className="tc-media-prompt-library__favorite-icon" size={17} stroke={1.8} />}
              </button>
            </article>
          ))}
          {filteredItems.length === 0 ? (
            <div className="tc-media-prompt-library__empty">当前列表暂无内容</div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

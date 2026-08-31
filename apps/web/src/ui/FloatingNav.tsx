import React from 'react'
import { ActionIcon, Badge, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconActivity, IconCpu, IconHistory, IconPalette, IconPlus, IconTopologyStar3, IconUsersGroup } from '@tabler/icons-react'

import { useUIStore } from './uiStore'
import { PanelCard } from './PanelCard'
import { KeyboardShortcutsButton } from './KeyboardShortcutsButton'
import { $ } from '../canvas/i18n'
import { BOTTOM_BAR_LAYOUT_CENTER } from './utils/panelPosition'
import { useAuth } from '../auth/store'
import { useTaskInbox } from './useTaskInbox'

const CapabilityBayDialog = React.lazy(async () => {
  const module = await import('./capabilities/CapabilityBayDialog')
  return { default: module.CapabilityBayDialog }
})

type FloatingNavItemProps = {
  label: string
  icon: React.ReactNode
  // 仅点击唤起（已去掉 hover 展开）；回调带触发项水平中心，供上方弹出面板居中。
  onClick?: (x: number) => void
  badge?: string
  tooltipLabel?: string
  active?: boolean
  activeStyle?: React.CSSProperties
}

const FloatingNavItem = React.memo(function FloatingNavItem({
  label,
  icon,
  onClick,
  badge,
  tooltipLabel,
  active = false,
  activeStyle,
}: FloatingNavItemProps): JSX.Element {
  return (
    <div
      className="floating-nav-item-wrap"
      style={{ position: 'relative' }}
      data-ux-floating
    >
      <Tooltip
        className="floating-nav-item-tooltip"
        label={tooltipLabel}
        position="top"
        withArrow
        disabled={!tooltipLabel}
      >
        <ActionIcon
          className="floating-nav-item"
          variant="subtle"
          size={28}
          radius="md"
          aria-label={label}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onClick?.(r.left + r.width / 2)
          }}
          style={active ? activeStyle : undefined}
        >
          {icon}
        </ActionIcon>
      </Tooltip>
      {badge ? (
        <Badge
          className="floating-nav-item-badge"
          color="gray"
          size="xs"
          variant="light"
          style={{ position: 'absolute', top: -6, right: -6, borderRadius: 999 }}
        >
          {badge}
        </Badge>
      ) : null}
    </div>
  )
})

export default function FloatingNav({ className }: { className?: string }): JSX.Element {
  const [capabilityBayOpened, setCapabilityBayOpened] = React.useState(false)
  const capabilityBayOpenRequest = useUIStore((state) => state.capabilityBayOpenRequest)
  const clearCapabilityBayOpenRequest = useUIStore((state) => state.clearCapabilityBayOpenRequest)
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const setPanelAnchorX = useUIStore((state) => state.setPanelAnchorX)
  const userId = useAuth((state) => state.user?.sub == null ? null : String(state.user.sub))
  const currentProjectId = useUIStore((state) => state.currentProject?.id ?? '')
  const taskInbox = useTaskInbox(userId, Boolean(userId))
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme !== 'light'
  const activeItemBackground = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16, 16, 19, 0.06)'
  const activeItemColor = '#f4f4f5'
  const activeItemBorder = isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(16,16,19,0.14)'
  const activeItemShadow = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.28)' : '0 10px 18px rgba(17,18,21,0.14)'
  const activeItemStyle = React.useMemo<React.CSSProperties>(() => ({
    background: activeItemBackground,
    color: activeItemColor,
    border: activeItemBorder,
    boxShadow: activeItemShadow,
  }), [activeItemBackground, activeItemBorder, activeItemShadow])

  React.useEffect(() => {
    if (!capabilityBayOpenRequest) return
    setCapabilityBayOpened(true)
  }, [capabilityBayOpenRequest])

  const closeCapabilityBay = React.useCallback(() => {
    setCapabilityBayOpened(false)
    clearCapabilityBayOpenRequest()
  }, [clearCapabilityBayOpenRequest])

  // 记录触发项的水平中心，供上方弹出的面板居中对齐（点击时设置）。
  const anchorFrom = React.useCallback((e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPanelAnchorX(r.left + r.width / 2)
  }, [setPanelAnchorX])

  const navClassName = ['floating-nav', 'floating-nav--bottom', className].filter(Boolean).join(' ')

  return (
    <div className={navClassName} style={{ position: 'fixed', bottom: 18, left: BOTTOM_BAR_LAYOUT_CENTER, transform: 'translateX(-50%)', zIndex: 300, transition: 'left 220ms ease' }} data-ux-floating data-tour="floating-nav">
      <PanelCard className="floating-nav-card" padding="compact" data-ux-floating>
        <div className="floating-nav-stack">
          <ActionIcon
            className="floating-nav-add"
            size={42}
            radius={999}
            aria-label={$('添加节点')}
            variant="subtle"
            data-active={activePanel === 'add' ? 'true' : 'false'}
            onClick={(e) => {
              anchorFrom(e)
              setActivePanel(activePanel === 'add' ? null : 'add')
            }}
            data-ux-floating
            data-tour="add-button">
            <IconPlus className="floating-nav-add-icon" size={22} stroke={2.2} />
          </ActionIcon>
          <div className="floating-nav-divider" />
          <FloatingNavItem
            label="风格库"
            icon={<IconPalette className="floating-nav-item-icon" size={18} />}
            tooltipLabel="风格库"
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'style-library' ? null : 'style-library')
            }}
            active={activePanel === 'style-library'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="角色库"
            icon={<IconUsersGroup className="floating-nav-item-icon" size={18} />}
            tooltipLabel="角色库"
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'character-library' ? null : 'character-library')
            }}
            active={activePanel === 'character-library'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="Agent 配置"
            icon={<IconCpu className="floating-nav-item-icon" size={18} />}
            tooltipLabel="Agent 配置"
            onClick={() => {
              clearCapabilityBayOpenRequest()
              setCapabilityBayOpened(true)
            }}
            active={capabilityBayOpened}
            activeStyle={activeItemStyle}
          />
          <div className="floating-nav-divider" />
          <FloatingNavItem
            label={$('工作流')}
            icon={<IconTopologyStar3 className="floating-nav-item-icon" size={18} />}
            tooltipLabel="工作流 · 历史记录"
            onClick={(x) => {
              setPanelAnchorX(x)
              const inGroup = activePanel === 'template' || activePanel === 'history'
              setActivePanel(inGroup ? null : 'template')
            }}
            active={activePanel === 'template' || activePanel === 'history'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="生成历史"
            icon={<IconHistory className="floating-nav-item-icon" size={18} />}
            tooltipLabel="生成历史"
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'generation-history' ? null : 'generation-history')
            }}
            active={activePanel === 'generation-history'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="创作动态"
            icon={<IconActivity className="floating-nav-item-icon" size={18} />}
            tooltipLabel="创作动态 · 记忆"
            badge={taskInbox.unreadCount > 0
              ? (taskInbox.unreadCount > 99 ? '99+' : String(taskInbox.unreadCount))
              : undefined}
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'task-inbox' ? null : 'task-inbox')
            }}
            active={activePanel === 'task-inbox'}
            activeStyle={activeItemStyle}
          />
          <div className="floating-nav-divider floating-nav-divider--bottom" />
          {/* 键盘快捷键「?」：从 CanvasBottomControls 独立浮动按钮合并至此。 */}
          <KeyboardShortcutsButton />
        </div>
      </PanelCard>
      {capabilityBayOpened ? (
        <React.Suspense fallback={null}>
          <CapabilityBayDialog
            opened
            projectId={currentProjectId}
            focusRequest={capabilityBayOpenRequest}
            onClose={closeCapabilityBay}
          />
        </React.Suspense>
      ) : null}
    </div>
  )
}

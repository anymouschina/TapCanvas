import React from 'react'
import { ActionIcon, Badge, Stack, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconPlus, IconTopologyStar3, IconListDetails, IconHistory, IconFolders, IconMovie, IconChartBar, IconTerminal2, IconLayoutGrid } from '@tabler/icons-react'
import { useAuth } from '../auth/store'
import { useIsAdmin } from '../auth/isAdmin'
import { useUIStore } from './uiStore'
import { PanelCard } from './PanelCard'
import { $ } from '../canvas/i18n'
import { spaNavigate } from '../utils/spaNavigate'

type FloatingNavItemProps = {
  label: string
  icon: React.ReactNode
  onHover?: (y: number) => void
  onClick?: () => void
  badge?: string
  tooltipLabel?: string
  active?: boolean
  activeStyle?: React.CSSProperties
}

const FloatingNavItem = React.memo(function FloatingNavItem({
  label,
  icon,
  onHover,
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
      onMouseEnter={(e) => {
        if (!onHover) return
        const rect = e.currentTarget.getBoundingClientRect()
        onHover(rect.top + rect.height / 2)
      }}
    >
      <Tooltip
        className="floating-nav-item-tooltip"
        label={tooltipLabel}
        position="right"
        withArrow
        disabled={!tooltipLabel}
      >
        <ActionIcon
          className="floating-nav-item"
          variant="subtle"
          size={28}
          radius="md"
          aria-label={label}
          onClick={onClick}
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
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const setPanelAnchorY = useUIStore((state) => state.setPanelAnchorY)
  const user = useAuth((state) => state.user)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme !== 'light'
  const projectGlyph = React.useMemo(() => {
    const candidate = String(user?.login || 'L').trim().charAt(0).toUpperCase()
    return candidate || 'L'
  }, [user?.login])
  const activeItemBackground = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17, 24, 39, 0.06)'
  const activeItemColor = '#f4f4f5'
  const activeItemBorder = isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(17,24,39,0.14)'
  const activeItemShadow = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.28)' : '0 10px 18px rgba(15,23,42,0.14)'
  const activeItemStyle = React.useMemo<React.CSSProperties>(() => ({
    background: activeItemBackground,
    color: activeItemColor,
    border: activeItemBorder,
    boxShadow: activeItemShadow,
  }), [activeItemBackground, activeItemBorder, activeItemShadow])

  const isAdmin = useIsAdmin()
  // Removed presence ping heartbeat: Cloudflare Workers does not need keep-alive and this endpoint isn't used elsewhere.

  const navClassName = ['floating-nav', className].filter(Boolean).join(' ')

  return (
    <div className={navClassName} style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 300 }} data-ux-floating data-tour="floating-nav">
      <PanelCard className="floating-nav-card" padding="compact" data-ux-floating>
        <Stack className="floating-nav-stack" align="center" gap={6}>
          <Tooltip className="floating-nav-add-tooltip" label={$('添加节点')} position="right" withArrow>
            <ActionIcon
              className="floating-nav-add"
              size={42}
              radius={999}
              aria-label={$('添加节点')}
              title={$('添加节点')}
              variant="subtle"
              data-active={activePanel === 'add' ? 'true' : 'false'}
              onMouseEnter={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setPanelAnchorY(r.top + r.height/2);
                if (activePanel !== 'template') setActivePanel('add')
              }}
              onClick={() => setActivePanel(activePanel === 'add' ? null : 'add')}
              data-ux-floating
              data-tour="add-button">
              <IconPlus className="floating-nav-add-icon" size={22} stroke={2.2} />
            </ActionIcon>
          </Tooltip>
          <div className="floating-nav-divider" />
          <FloatingNavItem
            label={$('项目')}
            icon={<IconFolders className="floating-nav-item-icon" size={18} />}
            tooltipLabel="项目管理"
            onHover={() => { setActivePanel(null) }}
            onClick={() => { setActivePanel(null); spaNavigate('/projects') }}
            active={false}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label={$('工作流')}
            icon={<IconTopologyStar3 className="floating-nav-item-icon" size={18} />}
            onHover={(y) => {
              setPanelAnchorY(y)
              setActivePanel('template')
            }}
            onClick={() => {
              setActivePanel(activePanel === 'template' ? null : 'template')
            }}
            active={activePanel === 'template'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label={$('我的资产')}
            icon={<IconListDetails className="floating-nav-item-icon" size={18} />}
            onHover={(y) => { setPanelAnchorY(y); setActivePanel('assets') }}
            active={activePanel === 'assets'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label={$('漫剧工作台')}
            icon={<IconLayoutGrid className="floating-nav-item-icon" size={18} />}
            tooltipLabel="画布内分镜工作台"
            onClick={() => {
              setActivePanel(activePanel === 'nanoComic' ? null : 'nanoComic')
            }}
            active={activePanel === 'nanoComic'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label={$('TapShow')}
            icon={<IconMovie className="floating-nav-item-icon" size={18} />}
            onHover={(y) => { setPanelAnchorY(y); setActivePanel('tapshow') }}
            active={activePanel === 'tapshow'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label={$('运行记录')}
            icon={<IconTerminal2 className="floating-nav-item-icon" size={18} />}
            onHover={(y) => { setPanelAnchorY(y); setActivePanel('runs') }}
            active={activePanel === 'runs'}
            activeStyle={activeItemStyle}
          />
          {isAdmin && (
            <Tooltip className="floating-nav-admin-tooltip" label={$('看板（仅管理员）')} position="right" withArrow>
              <ActionIcon
                className="floating-nav-item"
                variant="subtle"
                size={28}
                radius="md"
                aria-label="看板"
                style={activePanel === 'models' ? activeItemStyle : undefined}
                onClick={() => {
                  try {
                    const url = new URL(window.location.href)
                    url.search = ''
                    url.hash = ''
                    url.pathname = '/stats'
                    window.open(url.toString(), '_blank', 'noopener,noreferrer')
                  } catch {
                    window.open('/stats', '_blank', 'noopener,noreferrer')
                  }
                }}
              >
                <IconChartBar className="floating-nav-item-icon" size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          <FloatingNavItem
            label={$('历史记录')}
            icon={<IconHistory className="floating-nav-item-icon" size={18} />}
            onHover={(y) => { setPanelAnchorY(y); setActivePanel('history') }}
            active={activePanel === 'history'}
            activeStyle={activeItemStyle}
          />
          <div className="floating-nav-divider floating-nav-divider--bottom" />
          <button
            type="button"
            className="floating-nav-glyph"
            aria-label={user?.login || 'account'}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              useUIStore.getState().setPanelAnchorY(r.top + r.height / 2)
              useUIStore.getState().setActivePanel('account')
            }}
            onClick={() => setActivePanel(activePanel === 'account' ? null : 'account')}
            data-active={activePanel === 'account' ? 'true' : 'false'}
            data-ux-floating
          >
            <span className="floating-nav-glyph-text">{projectGlyph}</span>
          </button>
        </Stack>
      </PanelCard>
    </div>
  )
}

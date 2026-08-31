import React from 'react'
import { ActionIcon, Loader, Menu, Popover, Tooltip, ThemeIcon } from '@mantine/core'
import { NodeToolbar, Position } from '@xyflow/react'
import { IconChevronDown, IconChevronRight, IconDownload, IconMaximize } from '@tabler/icons-react'
import type { TaskNodeTheme } from '../useTaskNodeTheme'
import { LibTvImageToolbarIcon } from './LibTvImageToolbarIcon'

export type ToolbarMenuItem = {
  key: string
  label: string
  onClick: () => void
  icon?: React.ReactNode
  loading?: boolean
  disabled?: boolean
  subMenuContent?: React.ReactNode
}

export type ToolbarAction = {
  key: string
  label: string
  icon: JSX.Element
  onClick: () => void
  active?: boolean
  loading?: boolean
  disabled?: boolean
  showLabel?: boolean
  badge?: React.ReactNode
  menuItems?: ToolbarMenuItem[]
  tooltip?: string
}

type TopToolbarProps = {
  isVisible: boolean
  hasContent: boolean
  hasGenerationContext?: boolean
  toolbarBackground: string
  toolbarShadow: string
  toolbarActionIconStyles: TaskNodeTheme['toolbarActionIconStyles']
  inlineDividerColor: string
  visibleDefs: ToolbarAction[]
  extraActions?: ToolbarAction[]
  toolbarOffset?: number
  hideUtilButtons?: boolean
  onPreview: () => void
  onDownload: () => void
  /** 下载进行中：下载按钮转 loading，防重复点击 */
  downloading?: boolean
  /** 参考页的媒体工具栏把预览/下载放在能力动作之后。 */
  utilitiesAtEnd?: boolean
  /** 使用 LibTV 视频工具栏的 32px 动作、12px 圆角与紧凑字号。 */
  libtvVideoMode?: boolean
  /** 使用 LibTV 图片工具栏的 49px 能力条、12px 圆角与完整动作标签。 */
  libtvImageMode?: boolean
}

export function resolveToolbarViewportShiftX(input: {
  left: number
  width: number
  viewportWidth: number
  margin?: number
}): number {
  const margin = input.margin ?? 12
  const availableWidth = Math.max(0, input.viewportWidth - margin * 2)
  if (input.width >= availableWidth) return margin - input.left
  if (input.left < margin) return margin - input.left
  const right = input.left + input.width
  const maximumRight = input.viewportWidth - margin
  if (right > maximumRight) return maximumRight - right
  return 0
}

export function resolveToolbarViewportShiftY(input: {
  top: number
  height: number
  viewportHeight: number
  minimumTop?: number
  margin?: number
}): number {
  const margin = input.margin ?? 12
  const minimumTop = Math.max(margin, input.minimumTop ?? margin)
  if (input.top < minimumTop) return minimumTop - input.top

  const maximumBottom = input.viewportHeight - margin
  const bottom = input.top + input.height
  if (bottom > maximumBottom) return maximumBottom - bottom
  return 0
}

// ActionIcon already uses forwardRef internally — safe to use as Menu.Target child
function MenuWithSubItems({ d, toolbarActionIconStyles, btnRadius, trigger, libtvImageMode = false }: {
  d: ToolbarAction
  toolbarActionIconStyles: TaskNodeTheme['toolbarActionIconStyles']
  btnRadius: number
  trigger: 'click' | 'hover'
  libtvImageMode?: boolean
}) {
  const [openedSubKey, setOpenedSubKey] = React.useState<string | null>(null)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const openSub = (key: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpenedSubKey(key)
  }

  const scheduleSub = () => {
    closeTimer.current = setTimeout(() => setOpenedSubKey(null), 150)
  }

  const isActionDisabled = Boolean(d.disabled || d.loading)

  const libtvMenuWidth = d.key === 'portrait-texture'
    ? 180
    : d.key === 'nine-grid'
      ? 280
      : d.key === 'hd'
        ? 123
        : d.key === 'grid-split'
          ? 149
          : undefined

  return (
    <Menu
      withinPortal
      trigger={trigger}
      openDelay={trigger === 'hover' ? 80 : 0}
      closeDelay={trigger === 'hover' ? 160 : 0}
      position={libtvImageMode ? 'bottom-start' : 'bottom'}
      shadow="md"
      radius="md"
      offset={libtvImageMode ? 4 : 6}
      width={libtvMenuWidth}
      onClose={() => setOpenedSubKey(null)}
    >
      <Menu.Target>
        <ActionIcon
          className="top-toolbar-action top-toolbar-action--menu"
          variant="transparent"
          radius={0}
          size="sm"
          aria-label={d.label}
          title={libtvImageMode ? undefined : d.tooltip ?? d.label}
          data-tooltip={libtvImageMode ? d.tooltip ?? d.label : undefined}
          styles={toolbarActionIconStyles}
          disabled={isActionDisabled}
          loading={d.loading}
          onClick={libtvImageMode
            ? () => {
                if (isActionDisabled) return
                d.onClick()
              }
            : undefined}
          style={d.active ? { background: 'rgba(122,129,140,0.14)', borderRadius: btnRadius } : undefined}
        >
          {d.icon}
          {d.showLabel ? <span className="top-toolbar-action-label">{d.label}</span> : null}
          {d.badge}
          <IconChevronDown size={12} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown
        className={libtvImageMode ? `tc-libtv-image-menu tc-libtv-image-menu--${d.key}` : undefined}
        data-toolbar-menu={d.key}
      >
        {d.menuItems!.map((item) =>
          item.subMenuContent ? (
            <Popover
              key={item.key}
              opened={openedSubKey === item.key}
              withinPortal
              position="right-start"
              offset={8}
              shadow="md"
              radius="md"
            >
              <Popover.Target>
                <Menu.Item
                  className={libtvImageMode ? 'tc-libtv-image-menu__item' : undefined}
                  closeMenuOnClick={false}
                  rightSection={<IconChevronRight size={12} style={{ opacity: 0.5 }} />}
                  onMouseEnter={() => openSub(item.key)}
                  onMouseLeave={scheduleSub}
                >
                  {item.label}
                </Menu.Item>
              </Popover.Target>
              <Popover.Dropdown
                onMouseEnter={() => openSub(item.key)}
                onMouseLeave={scheduleSub}
                style={{ padding: 0 }}
              >
                {item.subMenuContent}
              </Popover.Dropdown>
            </Popover>
          ) : (
            <Menu.Item
              key={item.key}
              className={libtvImageMode ? 'tc-libtv-image-menu__item' : undefined}
              data-menu-item-key={item.key}
              disabled={item.disabled || item.loading}
              leftSection={
                item.loading
                  ? <Loader size={12} />
                  : item.icon
                    ? <span style={{ display: 'flex', alignItems: 'center' }}>{item.icon}</span>
                    : undefined
              }
              onClick={item.disabled || item.loading ? undefined : item.onClick}
            >
              {item.label}
            </Menu.Item>
          )
        )}
      </Menu.Dropdown>
    </Menu>
  )
}

function TopToolbar({
  isVisible,
  hasContent,
  hasGenerationContext = false,
  toolbarBackground,
  toolbarShadow,
  toolbarActionIconStyles,
  inlineDividerColor,
  visibleDefs,
  extraActions = [],
  toolbarOffset,
  hideUtilButtons = false,
  onPreview,
  onDownload,
  downloading = false,
  utilitiesAtEnd = false,
  libtvVideoMode = false,
  libtvImageMode = false,
}: TopToolbarProps) {
  const allActions = [...extraActions, ...visibleDefs].filter((action) => !(libtvImageMode && action.key === 'more'))
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const viewportShiftXRef = React.useRef(0)
  const viewportShiftYRef = React.useRef(0)
  const [viewportShiftX, setViewportShiftX] = React.useState(0)
  const [viewportShiftY, setViewportShiftY] = React.useState(0)
  const actionLayoutKey = allActions.map((action) => `${action.key}:${action.label}:${action.loading ? 1 : 0}`).join('|')

  React.useLayoutEffect(() => {
    if (!libtvImageMode || !isVisible || (!hasContent && !hasGenerationContext)) {
      viewportShiftXRef.current = 0
      viewportShiftYRef.current = 0
      setViewportShiftX(0)
      setViewportShiftY(0)
      return
    }
    const content = contentRef.current
    if (!content) return

    let frameId = 0
    const updateShift = () => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        const rect = content.getBoundingClientRect()
        const unshiftedLeft = rect.left - viewportShiftXRef.current
        const unshiftedTop = rect.top - viewportShiftYRef.current
        const nextShiftX = resolveToolbarViewportShiftX({
          left: unshiftedLeft,
          width: rect.width,
          viewportWidth: window.innerWidth,
        })
        const workspaceHeader = document.querySelector<HTMLElement>('.app-header-overlay')
        const nextShiftY = resolveToolbarViewportShiftY({
          top: unshiftedTop,
          height: rect.height,
          viewportHeight: window.innerHeight,
          minimumTop: (workspaceHeader?.getBoundingClientRect().bottom ?? 0) + 8,
        })
        if (Math.abs(nextShiftX - viewportShiftXRef.current) >= 0.5) {
          viewportShiftXRef.current = nextShiftX
          setViewportShiftX(nextShiftX)
        }
        if (Math.abs(nextShiftY - viewportShiftYRef.current) >= 0.5) {
          viewportShiftYRef.current = nextShiftY
          setViewportShiftY(nextShiftY)
        }
      })
    }

    updateShift()
    window.addEventListener('resize', updateShift)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateShift) : null
    observer?.observe(content)
    const workspaceHeader = document.querySelector<HTMLElement>('.app-header-overlay')
    if (workspaceHeader) observer?.observe(workspaceHeader)
    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateShift)
      observer?.disconnect()
    }
  }, [actionLayoutKey, hasContent, hasGenerationContext, isVisible, libtvImageMode])

  if (!isVisible || (!hasContent && !hasGenerationContext)) return null

  const btnBase = toolbarActionIconStyles?.root ?? {}
  const btnRadius = typeof btnBase.borderRadius === 'number' ? btnBase.borderRadius : 12

  return (
    <NodeToolbar
      className={`top-toolbar${libtvVideoMode ? ' top-toolbar--libtv-video' : ''}${libtvImageMode ? ' top-toolbar--libtv-image' : ''}`}
      position={Position.Top}
      align="center"
      offset={toolbarOffset}
    >
      <div
        className="top-toolbar-anchor"
        style={{
          position: 'relative',
          display: 'inline-block',
          transform: viewportShiftX === 0 && viewportShiftY === 0
            ? undefined
            : `translate(${viewportShiftX}px, ${viewportShiftY}px)`,
        }}
      >
        <div
          ref={contentRef}
          className="top-toolbar-content"
          style={{
            position: 'relative',
            zIndex: 3001,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'nowrap',
            justifyContent: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: libtvVideoMode ? 12 : libtvImageMode ? 18 : 999,
            background: toolbarBackground,
            boxShadow: toolbarShadow,
          }}
        >
          {!hideUtilButtons && !utilitiesAtEnd && (
            <Tooltip className="top-toolbar-tooltip" label="放大预览" position="bottom" withArrow>
              <ActionIcon
                className="top-toolbar-action"
                variant="transparent"
                radius={0}
                size="sm"
                aria-label="放大预览"
                styles={toolbarActionIconStyles}
                disabled={!hasContent}
                onClick={onPreview}
              >
                <IconMaximize className="top-toolbar-action-icon" size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          {!hideUtilButtons && !utilitiesAtEnd && (
            <Tooltip className="top-toolbar-tooltip" label="下载" position="bottom" withArrow>
              <ActionIcon
                className="top-toolbar-action"
                variant="transparent"
                radius={0}
                size="sm"
                aria-label="下载"
                styles={toolbarActionIconStyles}
                disabled={!hasContent}
                loading={downloading}
                onClick={onDownload}
              >
                <IconDownload className="top-toolbar-action-icon" size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          {!hideUtilButtons && !utilitiesAtEnd && allActions.length > 0 && (
            <div className="top-toolbar-divider" style={{ width: 1, height: 24, background: inlineDividerColor }} />
          )}
          {allActions.map((d) => {
            const action = d.menuItems && d.menuItems.length > 0 ? (
              <MenuWithSubItems
                d={d}
                toolbarActionIconStyles={toolbarActionIconStyles}
                btnRadius={btnRadius}
                trigger={libtvImageMode ? 'hover' : 'click'}
                libtvImageMode={libtvImageMode}
              />
            ) : (
              <Tooltip className="top-toolbar-tooltip" label={d.tooltip ?? d.label} position="bottom" withArrow disabled={libtvImageMode}>
                <ActionIcon
                  className="top-toolbar-action"
                  variant="transparent"
                  radius={0}
                  size="sm"
                  aria-label={d.label}
                  data-tooltip={libtvImageMode ? d.tooltip ?? d.label : undefined}
                  styles={toolbarActionIconStyles}
                  disabled={Boolean(d.disabled || d.loading)}
                  onClick={() => {
                    if (d.disabled || d.loading) return
                    d.onClick()
                  }}
                  loading={d.loading}
                  style={d.active ? { background: 'rgba(122,129,140,0.14)', borderRadius: btnRadius } : undefined}
                >
                  {d.icon}
                  {d.showLabel ? <span className="top-toolbar-action-label">{d.label}</span> : null}
                  {d.badge}
                </ActionIcon>
              </Tooltip>
            )
            return (
              <React.Fragment key={d.key}>
                {libtvImageMode && d.key === 'nine-grid' ? (
                  <div className="top-toolbar-divider top-toolbar-divider--inline" aria-hidden="true" />
                ) : null}
                {libtvImageMode && d.key === 'annotate' ? (
                  <div className="top-toolbar-divider" style={{ width: 1, height: 24, background: inlineDividerColor }} aria-hidden="true" />
                ) : null}
                {action}
              </React.Fragment>
            )
          })}
          {!hideUtilButtons && utilitiesAtEnd && allActions.length > 0 && !libtvImageMode && (
            <div className="top-toolbar-divider" style={{ width: 1, height: 24, background: inlineDividerColor }} />
          )}
          {!hideUtilButtons && utilitiesAtEnd && (
            <Tooltip className="top-toolbar-tooltip" label="下载" position="bottom" withArrow disabled={libtvImageMode}>
              <ActionIcon
                className="top-toolbar-action"
                variant="transparent"
                radius={0}
                size="sm"
                aria-label="下载"
                data-tooltip={libtvImageMode ? '下载图片' : undefined}
                styles={toolbarActionIconStyles}
                disabled={!hasContent}
                loading={downloading}
                onClick={onDownload}
              >
                {libtvImageMode
                  ? <LibTvImageToolbarIcon name="download" size={20} />
                  : <IconDownload className="top-toolbar-action-icon" size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
          {!hideUtilButtons && utilitiesAtEnd && (
            <Tooltip className="top-toolbar-tooltip" label="全屏" position="bottom" withArrow disabled={libtvImageMode}>
              <ActionIcon
                className="top-toolbar-action"
                variant="transparent"
                radius={0}
                size="sm"
                aria-label="全屏"
                data-tooltip={libtvImageMode ? '全屏查看' : undefined}
                styles={toolbarActionIconStyles}
                disabled={!hasContent}
                onClick={onPreview}
              >
                {libtvImageMode
                  ? <LibTvImageToolbarIcon name="fullscreen" size={18} />
                  : <IconMaximize className="top-toolbar-action-icon" size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </div>
      </div>
    </NodeToolbar>
  )
}

const _TopToolbar = React.memo(TopToolbar)
export { _TopToolbar as TopToolbar }

import React from 'react'
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core'
import { IconEye, IconLayoutGrid, IconPhotoPlus } from '@tabler/icons-react'
import {
  getStoryboardEditorGridConfig,
  normalizeStoryboardEditorSelectedIndex,
  resolveStoryboardEditorCellAspect,
  type StoryboardEditorAspect,
  type StoryboardEditorCell,
  type StoryboardEditorGrid,
} from '../storyboardEditor'
import { ManagedImage } from '../../../../domain/resource-runtime'

// Shared presentational layer for the 分镜编辑 (storyboard editor) node.
//
// This renders the EXACT static visual of the storyboard editor — the sized root (.tc-storyboard-editor),
// title row, the active-cell preview panel (image or empty state) with its chip/copy overlay, and the
// footer — using the same CSS classes as the focused body. It is the single source of truth for "what a
// storyboard node looks like".
//
//   - The focused body (StoryboardEditorContent) renders this and injects interactivity through the
//     optional slots/handlers below (toolbar, drop targets, eye buttons, the 切换镜头 actions row).
//   - The lightweight LOD shell (TaskNodeCard) renders this with NO interaction props, so an unfocused
//     storyboard node looks identical to the focused one — just without the controls/tooltips. This keeps
//     the canvas-first promise (every node is recognizable without focusing it) AND the single-focus LOD
//     perf model (no heavy TaskNode body mounted on unfocused nodes).
//
// Pure presentational: it owns no state and runs no side effects, so it is cheap to mount many times.

type PanelInteraction = {
  activeDropIndex: number | null
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
}

export type StoryboardEditorPreviewProps = {
  label: string
  aspect: StoryboardEditorAspect
  grid: StoryboardEditorGrid
  cells: StoryboardEditorCell[]
  selectedIndex: number
  nodeWidth: number
  nodeHeight: number
  editMode?: boolean
  collapsed?: boolean
  composedImageUrl?: string | null
  imageRequestedWidth?: number
  // Interactivity — provided by the focused body, omitted by the static shell.
  /** Expand the collapsed panel (focused only). When omitted the collapsed view is a static div. */
  onExpand?: () => void
  panelInteraction?: PanelInteraction
  /** Eye button for the active cell (focused only). When omitted no preview affordance is shown. */
  onPreviewActiveCell?: () => void
  /** Eye button for the composed grid image in the meta row (focused only). */
  onPreviewComposed?: () => void
  /** The 切换镜头 / 比例 / 清空 actions row beneath the panel (focused only). */
  actions?: React.ReactNode
  /** The floating NodeToolbar (focused + selected only). */
  toolbar?: React.ReactNode
  /** Disable tooltips when not interactive. */
  tooltipDisabled?: boolean
  /** Footer override (e.g. compose error). Falls back to the standard hint text. */
  footerOverride?: string | null
}

type StoryboardEditorCssVars = React.CSSProperties & {
  '--tc-storyboard-editor-width'?: string
  '--tc-storyboard-editor-height'?: string
}

function StoryboardEditorPreview(props: StoryboardEditorPreviewProps) {
  const {
    label,
    aspect,
    grid,
    cells,
    selectedIndex,
    nodeWidth,
    nodeHeight,
    editMode = false,
    collapsed = false,
    composedImageUrl,
    imageRequestedWidth,
    onExpand,
    panelInteraction,
    onPreviewActiveCell,
    onPreviewComposed,
    actions,
    toolbar,
    tooltipDisabled = true,
    footerOverride,
  } = props

  const gridConfig = getStoryboardEditorGridConfig(grid)
  const filledCount = cells.reduce((count, cell) => {
    const imageUrl = typeof cell.imageUrl === 'string' ? cell.imageUrl.trim() : ''
    return imageUrl ? count + 1 : count
  }, 0)
  const normalizedSelectedIndex = normalizeStoryboardEditorSelectedIndex(selectedIndex, cells.length)
  const activeCell = cells[normalizedSelectedIndex] ?? null
  const activeCellImageUrl = typeof activeCell?.imageUrl === 'string' ? activeCell.imageUrl.trim() : ''
  const activeCellLabel = typeof activeCell?.label === 'string' && activeCell.label.trim()
    ? activeCell.label.trim()
    : `镜头 ${normalizedSelectedIndex + 1}`
  const activeCellShotNo = typeof activeCell?.shotNo === 'number' && Number.isFinite(activeCell.shotNo)
    ? activeCell.shotNo
    : normalizedSelectedIndex + 1
  const activeCellPrompt = typeof activeCell?.prompt === 'string' ? activeCell.prompt.trim() : ''
  const resolvedLabel = label.trim() || '分镜编辑'

  const firstCell = cells[0] ?? null
  const collapsedPreviewUrl = typeof firstCell?.imageUrl === 'string' ? firstCell.imageUrl.trim() : ''
  const collapsedPreviewTitle = collapsedPreviewUrl
    ? (typeof firstCell?.label === 'string' && firstCell.label.trim() ? firstCell.label.trim() : '镜头 1')
    : ''
  const collapsedRemainingCount = cells.slice(1).reduce((count, cell) => {
    const imageUrl = typeof cell.imageUrl === 'string' ? cell.imageUrl.trim() : ''
    return imageUrl ? count + 1 : count
  }, 0)
  const collapsedClassName = editMode
    ? 'tc-storyboard-editor__collapsed nodrag'
    : 'tc-storyboard-editor__collapsed'

  const rootStyle: StoryboardEditorCssVars = {
    '--tc-storyboard-editor-width': `${nodeWidth}px`,
    '--tc-storyboard-editor-height': `${nodeHeight}px`,
  }

  return (
    <div className="tc-storyboard-editor" style={rootStyle}>
      {toolbar}

      <div className="tc-storyboard-editor__stage">
        <div className="tc-storyboard-editor__title-row">
          <div className="tc-storyboard-editor__title-main">
            <Text className="tc-storyboard-editor__title-text" size="sm" fw={600}>
              {resolvedLabel}
            </Text>
            <Text className="tc-storyboard-editor__title-subtext" size="xs">
              {gridConfig.label} · {aspect}
            </Text>
          </div>
          <Group className="tc-storyboard-editor__meta" gap={6} wrap="nowrap">
            <div className="tc-storyboard-editor__meta-chip">
              {filledCount}/{cells.length}
            </div>
            {editMode ? (
              <div className="tc-storyboard-editor__meta-chip" data-active="true">
                编辑中
              </div>
            ) : null}
            {composedImageUrl && onPreviewComposed ? (
              <Tooltip label="查看合成图" disabled={tooltipDisabled} withArrow>
                <ActionIcon
                  className="tc-storyboard-editor__meta-icon"
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label="查看合成图"
                  onClick={onPreviewComposed}
                >
                  <IconEye size={14} />
                </ActionIcon>
              </Tooltip>
            ) : null}
          </Group>
        </div>

        {collapsed ? (
          // Collapsed view — an interactive expand button in the focused body, a static div in the shell.
          React.createElement(
            onExpand ? 'button' : 'div',
            {
              className: collapsedClassName,
              ...(onExpand ? { type: 'button' as const, onClick: onExpand } : {}),
            },
            <>
              {collapsedPreviewUrl && collapsedRemainingCount > 0 ? (
                <div className="tc-storyboard-editor__collapsed-stack-underlay" aria-hidden="true" />
              ) : null}
              <div className="tc-storyboard-editor__collapsed-surface">
                {collapsedPreviewUrl ? (
                  <>
                    <ManagedImage
                      className="tc-storyboard-editor__collapsed-preview"
                      src={collapsedPreviewUrl}
                      alt={collapsedPreviewTitle || '分镜首图'}
                      priority="visible"
                      ownerSurface="preview-modal"
                      ownerRequestKey={`storyboard-editor-collapsed:${collapsedPreviewUrl}`}
                      requestedSize={imageRequestedWidth ? { width: imageRequestedWidth } : undefined}
                    />
                    <div className="tc-storyboard-editor__collapsed-overlay" aria-hidden="true" />
                    <Group
                      className="tc-storyboard-editor__collapsed-meta"
                      justify="space-between"
                      align="center"
                      gap={8}
                      wrap="nowrap"
                    >
                      <div className="tc-storyboard-editor__collapsed-badge">首图</div>
                      {collapsedRemainingCount > 0 ? (
                        <div className="tc-storyboard-editor__collapsed-count">
                          +{collapsedRemainingCount}
                        </div>
                      ) : null}
                    </Group>
                    <div className="tc-storyboard-editor__collapsed-copy">
                      <Text className="tc-storyboard-editor__collapsed-title" size="sm" fw={600}>
                        {collapsedPreviewTitle}
                      </Text>
                      <Text className="tc-storyboard-editor__collapsed-subtitle" size="xs">
                        {resolvedLabel} · {gridConfig.label} · {filledCount}/{cells.length}
                      </Text>
                    </div>
                  </>
                ) : (
                  <Group className="tc-storyboard-editor__collapsed-empty" gap={10} wrap="nowrap">
                    <Group className="tc-storyboard-editor__collapsed-left" gap={10}>
                      <div className="tc-storyboard-editor__collapsed-icon">
                        <IconLayoutGrid size={18} />
                      </div>
                      <div className="tc-storyboard-editor__collapsed-copy">
                        <Text className="tc-storyboard-editor__collapsed-title" size="sm" fw={600}>
                          {resolvedLabel}
                        </Text>
                        <Text className="tc-storyboard-editor__collapsed-subtitle" size="xs">
                          {collapsedRemainingCount > 0
                            ? `${gridConfig.label} · 第 1 格为空 · 其余已填 ${collapsedRemainingCount} 张`
                            : `${gridConfig.label} · 第 1 格为空，展开后继续拖入镜头图`}
                        </Text>
                      </div>
                    </Group>
                  </Group>
                )}
              </div>
            </>,
          )
        ) : (
        <div className="tc-storyboard-editor__preview-shell">
          <div
            className="tc-storyboard-editor__preview-panel"
            data-drop-active={panelInteraction && panelInteraction.activeDropIndex === normalizedSelectedIndex ? 'true' : 'false'}
            data-empty={activeCellImageUrl ? 'false' : 'true'}
            data-editing={editMode ? 'true' : 'false'}
            onDragOver={panelInteraction?.onDragOver}
            onDragLeave={panelInteraction?.onDragLeave}
            onDrop={panelInteraction?.onDrop}
            onDoubleClick={panelInteraction?.onDoubleClick}
          >
            {activeCellImageUrl ? (
              <ManagedImage
                className="tc-storyboard-editor__preview-image"
                src={activeCellImageUrl}
                alt={activeCellLabel}
                draggable={false}
                priority="visible"
                ownerSurface="preview-modal"
                ownerRequestKey={`storyboard-editor-preview:${activeCellImageUrl}`}
                requestedSize={imageRequestedWidth ? { width: imageRequestedWidth } : undefined}
              />
            ) : (
              <div className="tc-storyboard-editor__preview-empty">
                <IconPhotoPlus size={18} />
                <Text className="tc-storyboard-editor__preview-empty-title" size="sm" fw={600}>
                  当前镜头为空
                </Text>
                <Text className="tc-storyboard-editor__preview-empty-text" size="xs">
                  {editMode ? '拖入图片到当前选中镜头，或进入弹窗切换其他镜头。' : '点击“切换镜头”查看其他镜头预览。'}
                </Text>
              </div>
            )}

            <div className="tc-storyboard-editor__preview-overlay">
              <div className="tc-storyboard-editor__preview-head">
                <div className="tc-storyboard-editor__preview-chip-row">
                  <div className="tc-storyboard-editor__preview-chip">
                    镜头 {normalizedSelectedIndex + 1}
                  </div>
                  <div className="tc-storyboard-editor__preview-chip" data-variant="muted">
                    #{activeCellShotNo}
                  </div>
                  <div className="tc-storyboard-editor__preview-chip" data-variant="muted">
                    {resolveStoryboardEditorCellAspect(activeCell, aspect)}
                  </div>
                </div>
                {activeCellImageUrl && onPreviewActiveCell ? (
                  <ActionIcon
                    className="tc-storyboard-editor__preview-icon"
                    size="sm"
                    radius="sm"
                    variant="filled"
                    color="dark"
                    aria-label="预览当前镜头"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onPreviewActiveCell()
                    }}
                  >
                    <IconEye size={12} />
                  </ActionIcon>
                ) : null}
              </div>

              <div className="tc-storyboard-editor__preview-copy">
                <Text className="tc-storyboard-editor__preview-title" size="sm" fw={600}>
                  {activeCellLabel}
                </Text>
                <Text className="tc-storyboard-editor__preview-subtitle" size="xs">
                  {activeCellPrompt || `${resolvedLabel} · ${gridConfig.label} · 已填 ${filledCount}/${cells.length}`}
                </Text>
              </div>
            </div>
          </div>

          {actions ? (
            <div className="tc-storyboard-editor__preview-actions">
              {actions}
            </div>
          ) : null}
        </div>
        )}

        <Text className="tc-storyboard-editor__footer" size="xs" c="dimmed" ta="center">
          {footerOverride
            ? footerOverride
            : (filledCount
                ? '外部保留当前选中镜头预览；点击“切换镜头”在弹窗内切换并确认回填。'
                : '当前没有已选镜头，可先拖入图片，或打开弹窗检查镜头列表。')}
        </Text>
      </div>
    </div>
  )
}

const _StoryboardEditorPreview = React.memo(StoryboardEditorPreview)
export { _StoryboardEditorPreview as StoryboardEditorPreview }

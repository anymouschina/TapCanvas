import React from 'react'
import { ActionIcon, Button, Group, Menu, Modal, Text, Tooltip } from '@mantine/core'
import { NodeToolbar, Position } from '@xyflow/react'
import {
  IconArrowsDiagonalMinimize2,
  IconCheck,
  IconEdit,
  IconEye,
  IconLayoutGrid,
  IconPhoto,
  IconPhotoDown,
  IconPhotoPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { getTapImageDragPayload } from '../../../dnd/setTapImageDragData'
import {
  STORYBOARD_EDITOR_ASPECT_OPTIONS,
  STORYBOARD_EDITOR_GRID_OPTIONS,
  buildDefaultStoryboardEditorData,
  getStoryboardEditorGridConfig,
  normalizeStoryboardEditorSelectedIndex,
  resolveStoryboardEditorCellAspect,
  type StoryboardEditorAspect,
  type StoryboardEditorCell,
  type StoryboardEditorGrid,
} from '../storyboardEditor'
import {
  buildStoryboardComposeCanvas,
  canvasToPngBlob,
} from '../storyboardCompose'
import { useUIStore } from '../../../../ui/uiStore'
import { ManagedImage } from '../../../../domain/resource-runtime'
import { StoryboardEditorPreview } from './StoryboardEditorPreview'

type StoryboardEditorContentProps = {
  label: string
  selected: boolean
  nodeWidth: number
  nodeHeight: number
  aspect: StoryboardEditorAspect
  grid: StoryboardEditorGrid
  cells: StoryboardEditorCell[]
  selectedIndex: number
  editMode: boolean
  collapsed: boolean
  composedImageUrl?: string | null
  onComposeToImageNode: (file: File) => Promise<void>
  onUpdateNodeData: (patch: Record<string, unknown>) => void
  isRunning: boolean
  onRun: () => void
  onCancelRun: () => void
}

const normalizeImageFile = (file: File | null | undefined): File | null => {
  if (!file) return null
  return typeof file.type === 'string' && file.type.startsWith('image/') ? file : null
}

function StoryboardEditorContent(props: StoryboardEditorContentProps) {
  const {
    label,
    selected,
    nodeWidth,
    nodeHeight,
    aspect,
    grid,
    cells,
    selectedIndex,
    editMode,
    collapsed,
    composedImageUrl,
    onComposeToImageNode,
    onUpdateNodeData,
    isRunning,
    onRun,
    onCancelRun,
  } = props

  const [activeDropIndex, setActiveDropIndex] = React.useState<number | null>(null)
  const [composing, setComposing] = React.useState(false)
  const [composeError, setComposeError] = React.useState<string | null>(null)
  const [switcherOpened, setSwitcherOpened] = React.useState(false)
  const openPreview = useUIStore((state) => state.openPreview)
  const normalizedSelectedIndex = React.useMemo(
    () => normalizeStoryboardEditorSelectedIndex(selectedIndex, cells.length),
    [cells.length, selectedIndex],
  )
  const [draftSelectedIndex, setDraftSelectedIndex] = React.useState(normalizedSelectedIndex)
  // Active-cell values still needed here for the interaction handlers + Modal passed to the preview.
  const activeCell = cells[normalizedSelectedIndex] ?? null
  const activeCellImageUrl = typeof activeCell?.imageUrl === 'string' ? activeCell.imageUrl.trim() : ''
  const activeCellLabel = typeof activeCell?.label === 'string' && activeCell.label.trim()
    ? activeCell.label.trim()
    : `镜头 ${normalizedSelectedIndex + 1}`
  const modalSelectedCell = cells[draftSelectedIndex] ?? null
  const modalSelectedCellImageUrl = typeof modalSelectedCell?.imageUrl === 'string' ? modalSelectedCell.imageUrl.trim() : ''
  const modalSelectedCellLabel = typeof modalSelectedCell?.label === 'string' && modalSelectedCell.label.trim()
    ? modalSelectedCell.label.trim()
    : `镜头 ${draftSelectedIndex + 1}`
  const modalSelectedCellShotNo = typeof modalSelectedCell?.shotNo === 'number' && Number.isFinite(modalSelectedCell.shotNo)
    ? modalSelectedCell.shotNo
    : draftSelectedIndex + 1

  const showToolbar = selected
  const resolvedLabel = label.trim() || '分镜编辑'
  const tooltipDisabled = !selected

  React.useEffect(() => {
    setDraftSelectedIndex(normalizedSelectedIndex)
  }, [normalizedSelectedIndex])

  const patchCells = React.useCallback((nextCells: StoryboardEditorCell[]) => {
    onUpdateNodeData({ storyboardEditorCells: nextCells })
  }, [onUpdateNodeData])

  const replaceCell = React.useCallback((index: number, patch: Partial<StoryboardEditorCell>) => {
    const nextCells = cells.map((cell, cellIndex) => (
      cellIndex === index
        ? {
            ...cell,
            ...patch,
          }
        : cell
    ))
    patchCells(nextCells)
  }, [cells, patchCells])

  const clearCell = React.useCallback((index: number) => {
    const current = cells[index]
    if (!current) return
    replaceCell(index, {
      imageUrl: null,
      label: undefined,
      prompt: undefined,
      sourceKind: undefined,
      sourceNodeId: undefined,
      sourceIndex: undefined,
      shotNo: undefined,
    })
  }, [cells, replaceCell])

  const openSwitcher = React.useCallback(() => {
    setDraftSelectedIndex(normalizedSelectedIndex)
    setSwitcherOpened(true)
  }, [normalizedSelectedIndex])

  const closeSwitcher = React.useCallback(() => {
    setSwitcherOpened(false)
    setDraftSelectedIndex(normalizedSelectedIndex)
  }, [normalizedSelectedIndex])

  const confirmSwitcher = React.useCallback(() => {
    onUpdateNodeData({
      storyboardEditorSelectedIndex: normalizeStoryboardEditorSelectedIndex(draftSelectedIndex, cells.length),
    })
    setSwitcherOpened(false)
  }, [cells.length, draftSelectedIndex, onUpdateNodeData])

  const handleGridChange = React.useCallback((nextGrid: StoryboardEditorGrid) => {
    const defaults = buildDefaultStoryboardEditorData()
    const nextCellCount = getStoryboardEditorGridConfig(nextGrid).columns * getStoryboardEditorGridConfig(nextGrid).rows
    const nextCells = Array.from({ length: nextCellCount }, (_, index) => cells[index] ?? defaults.storyboardEditorCells[index])
    onUpdateNodeData({
      storyboardEditorGrid: nextGrid,
      storyboardEditorCells: nextCells,
      storyboardEditorSelectedIndex: normalizeStoryboardEditorSelectedIndex(normalizedSelectedIndex, nextCellCount),
    })
  }, [cells, normalizedSelectedIndex, onUpdateNodeData])

  const handleAspectChange = React.useCallback((nextAspect: StoryboardEditorAspect) => {
    onUpdateNodeData({ storyboardEditorAspect: nextAspect })
  }, [onUpdateNodeData])

  const handleCellAspectChange = React.useCallback((index: number, nextAspect: StoryboardEditorAspect | null) => {
    const current = cells[index]
    if (!current) return
    replaceCell(index, {
      aspect: nextAspect ?? undefined,
    })
  }, [cells, replaceCell])

  const handleCompose = React.useCallback(async () => {
    const activeCells = cells.filter((cell) => typeof cell.imageUrl === 'string' && cell.imageUrl.trim())
    if (!activeCells.length) {
      setComposeError('请先放入至少一张图片')
      return
    }

    setComposing(true)
    setComposeError(null)

    try {
      const canvas = await buildStoryboardComposeCanvas({ cells, aspect, grid })
      const blob = await canvasToPngBlob(canvas)
      const fileName = `storyboard-compose-${Date.now()}.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      await onComposeToImageNode(file)
    } catch (error) {
      const message = error instanceof Error ? error.message : '分镜合成失败'
      setComposeError(message)
    } finally {
      setComposing(false)
    }
  }, [aspect, cells, grid, onComposeToImageNode])

  const handleClearAll = React.useCallback(() => {
    onUpdateNodeData({
      ...buildDefaultStoryboardEditorData(),
      storyboardEditorAspect: aspect,
      storyboardEditorGrid: grid,
      storyboardEditorSelectedIndex: 0,
      imageUrl: null,
      imageResults: [],
      imagePrimaryIndex: 0,
    })
  }, [aspect, grid, onUpdateNodeData])

  const handleDropOnCell = React.useCallback(async (event: React.DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    setActiveDropIndex(null)

    const payload = getTapImageDragPayload(event.dataTransfer)
    if (payload?.url) {
      const sourceKind = typeof payload.sourceKind === 'string' ? payload.sourceKind.trim() : ''
      const sourceNodeId = typeof payload.sourceNodeId === 'string' ? payload.sourceNodeId.trim() : ''
      const sourceIndex = typeof payload.sourceIndex === 'number' ? payload.sourceIndex : null
      replaceCell(index, {
        imageUrl: payload.url,
        label: payload.label,
        prompt: payload.prompt,
        sourceKind: sourceKind || undefined,
        sourceNodeId: sourceNodeId || undefined,
        sourceIndex: sourceIndex ?? undefined,
        shotNo: payload.shotNo,
      })
      return
    }

    const file = normalizeImageFile(event.dataTransfer.files?.[0])
    if (!file) return
    const localUrl = URL.createObjectURL(file)
    replaceCell(index, {
      imageUrl: localUrl,
      label: file.name,
    })
  }, [replaceCell])

  const toolbarNode = showToolbar ? (
    <NodeToolbar className="tc-storyboard-editor__toolbar-floating" position={Position.Top} align="center" offset={12}>
          <div className="tc-storyboard-editor__toolbar">
            <Menu withinPortal position="bottom-start">
              <Menu.Target>
                <Button className="tc-storyboard-editor__toolbar-button" size="xs" variant="subtle" color="gray">
                  {STORYBOARD_EDITOR_ASPECT_OPTIONS.find((option) => option.value === aspect)?.label ?? '比例'}
                </Button>
              </Menu.Target>
              <Menu.Dropdown className="tc-storyboard-editor__toolbar-dropdown">
                {STORYBOARD_EDITOR_ASPECT_OPTIONS.map((option) => (
                  <Menu.Item
                    className="tc-storyboard-editor__toolbar-dropdown-item"
                    key={option.value}
                    onClick={() => handleAspectChange(option.value)}
                  >
                    {option.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>

            <Menu withinPortal position="bottom-start">
              <Menu.Target>
                <Button className="tc-storyboard-editor__toolbar-button" size="xs" variant="subtle" color="gray">
                  {STORYBOARD_EDITOR_GRID_OPTIONS.find((option) => option.value === grid)?.label ?? '网格'}
                </Button>
              </Menu.Target>
              <Menu.Dropdown className="tc-storyboard-editor__toolbar-dropdown">
                {STORYBOARD_EDITOR_GRID_OPTIONS.map((option) => (
                  <Menu.Item
                    className="tc-storyboard-editor__toolbar-dropdown-item"
                    key={option.value}
                    onClick={() => handleGridChange(option.value)}
                  >
                    {option.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>

            <div className="tc-storyboard-editor__toolbar-divider" />

            <Button
              className="tc-storyboard-editor__toolbar-button"
              size="xs"
              variant={editMode ? 'filled' : 'subtle'}
              color={editMode ? 'violet' : 'gray'}
              leftSection={<IconEdit size={14} />}
              onClick={() => onUpdateNodeData({ storyboardEditorEditMode: !editMode })}
            >
              {editMode ? '退出' : '编辑'}
            </Button>

            <Button
              className="tc-storyboard-editor__toolbar-button"
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<IconPhotoDown size={14} />}
              loading={composing}
              onClick={() => { void handleCompose() }}
            >
              合成
            </Button>

            {isRunning ? (
              <Button
                className="tc-storyboard-editor__toolbar-button"
                size="xs"
                variant="subtle"
                color="red"
                leftSection={<IconPlayerStop size={14} />}
                onClick={onCancelRun}
              >
                停止
              </Button>
            ) : (
              <Button
                className="tc-storyboard-editor__toolbar-button"
                size="xs"
                variant="subtle"
                color="gray"
                leftSection={<IconPlayerPlay size={14} />}
                onClick={onRun}
              >
                执行
              </Button>
            )}

            <Button
              className="tc-storyboard-editor__toolbar-button"
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<IconTrash size={14} />}
              onClick={handleClearAll}
            >
              清空
            </Button>

            <Tooltip label={collapsed ? '展开面板' : '折叠面板'} disabled={tooltipDisabled} withArrow>
              <ActionIcon
                className="tc-storyboard-editor__toolbar-icon"
                size="lg"
                radius="md"
                variant="subtle"
                color="gray"
                ml="auto"
                onClick={() => onUpdateNodeData({ storyboardEditorCollapsed: !collapsed })}
              >
                <IconArrowsDiagonalMinimize2 size={16} />
              </ActionIcon>
            </Tooltip>
          </div>
        </NodeToolbar>
  ) : null

  const actionsNode = (
    <>
      <Button
        className="tc-storyboard-editor__preview-action"
        size="xs"
        variant="subtle"
        color="gray"
        leftSection={<IconLayoutGrid size={14} />}
        onClick={openSwitcher}
      >
        切换镜头
      </Button>
      {editMode ? (
        <Menu withinPortal position="bottom-start">
          <Menu.Target>
            <Button
              className="tc-storyboard-editor__preview-action"
              size="xs"
              variant="subtle"
              color="gray"
            >
              当前镜头比例
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="tc-storyboard-editor__cell-aspect-dropdown">
            <Menu.Label className="tc-storyboard-editor__cell-aspect-dropdown-label">
              单格比例
            </Menu.Label>
            <Menu.Item
              className="tc-storyboard-editor__cell-aspect-dropdown-item"
              onClick={() => handleCellAspectChange(normalizedSelectedIndex, null)}
            >
              跟随整体（当前 {aspect}）
            </Menu.Item>
            {STORYBOARD_EDITOR_ASPECT_OPTIONS.map((option) => (
              <Menu.Item
                className="tc-storyboard-editor__cell-aspect-dropdown-item"
                key={`preview-${option.value}`}
                onClick={() => handleCellAspectChange(normalizedSelectedIndex, option.value)}
              >
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      ) : null}
      {editMode && activeCellImageUrl ? (
        <ActionIcon
          className="tc-storyboard-editor__preview-action-icon"
          size="sm"
          radius="sm"
          variant="subtle"
          color="gray"
          aria-label="清空当前镜头"
          onClick={() => clearCell(normalizedSelectedIndex)}
        >
          <IconX size={14} />
        </ActionIcon>
      ) : null}
    </>
  )

  return (
    <>
      <StoryboardEditorPreview
        label={label}
        aspect={aspect}
        grid={grid}
        cells={cells}
        selectedIndex={selectedIndex}
        nodeWidth={nodeWidth}
        nodeHeight={nodeHeight}
        editMode={editMode}
        collapsed={collapsed}
        composedImageUrl={composedImageUrl}
        tooltipDisabled={tooltipDisabled}
        footerOverride={composeError}
        toolbar={toolbarNode}
        actions={actionsNode}
        onExpand={() => onUpdateNodeData({ storyboardEditorCollapsed: false })}
        onPreviewActiveCell={activeCellImageUrl ? () => openPreview({ url: activeCellImageUrl, kind: 'image', name: activeCellLabel }) : undefined}
        onPreviewComposed={composedImageUrl ? () => openPreview({ url: composedImageUrl, kind: 'image', name: `${resolvedLabel} · 合成图` }) : undefined}
        panelInteraction={{
          activeDropIndex,
          onDragOver: (event) => {
            event.preventDefault()
            event.stopPropagation()
            try { event.dataTransfer.dropEffect = 'move' } catch { /* ignore */ }
            setActiveDropIndex(normalizedSelectedIndex)
          },
          onDragLeave: (event) => {
            event.preventDefault()
            event.stopPropagation()
            setActiveDropIndex((current) => (current === normalizedSelectedIndex ? null : current))
          },
          onDrop: (event) => { void handleDropOnCell(event, normalizedSelectedIndex) },
          onDoubleClick: () => {
            if (activeCellImageUrl) {
              openPreview({ url: activeCellImageUrl, kind: 'image', name: activeCellLabel })
            }
          },
        }}
      />

      <Modal
        className="tc-storyboard-editor__switcher-modal"
        opened={switcherOpened}
        onClose={closeSwitcher}
        title="切换镜头"
        size="xl"
        centered
      >
        <div className="tc-storyboard-editor__switcher">
          <div className="tc-storyboard-editor__switcher-sidebar">
            <div className="tc-storyboard-editor__switcher-sidebar-head">
              <Text className="tc-storyboard-editor__switcher-title" size="sm" fw={600}>
                镜头列表
              </Text>
              <Text className="tc-storyboard-editor__switcher-subtitle" size="xs">
                左侧切换，右侧确认预览
              </Text>
            </div>
            <div className="tc-storyboard-editor__switcher-list">
              {cells.map((cell, index) => {
                const cellImageUrl = typeof cell.imageUrl === 'string' ? cell.imageUrl.trim() : ''
                const cellLabel = typeof cell.label === 'string' && cell.label.trim() ? cell.label.trim() : `镜头 ${index + 1}`
                const cellShotNo = typeof cell.shotNo === 'number' && Number.isFinite(cell.shotNo) ? cell.shotNo : index + 1
                return (
                  <button
                    key={cell.id}
                    className="tc-storyboard-editor__switcher-item"
                    type="button"
                    data-selected={draftSelectedIndex === index ? 'true' : 'false'}
                    onClick={() => setDraftSelectedIndex(index)}
                  >
                    <div className="tc-storyboard-editor__switcher-item-thumb">
                      {cellImageUrl ? (
                        <ManagedImage
                          className="tc-storyboard-editor__switcher-item-image"
                          src={cellImageUrl}
                          alt={cellLabel}
                          draggable={false}
                          priority="visible"
                          ownerSurface="preview-modal"
                          ownerRequestKey={`storyboard-editor-switcher-item:${cellImageUrl}`}
                        />
                      ) : (
                        <div className="tc-storyboard-editor__switcher-item-placeholder">
                          <IconPhoto size={14} />
                        </div>
                      )}
                    </div>
                    <div className="tc-storyboard-editor__switcher-item-copy">
                      <Text className="tc-storyboard-editor__switcher-item-title" size="sm" fw={600}>
                        {cellLabel}
                      </Text>
                      <Text className="tc-storyboard-editor__switcher-item-text" size="xs">
                        镜头 {index + 1} · #{cellShotNo}
                      </Text>
                    </div>
                    {draftSelectedIndex === index ? (
                      <div className="tc-storyboard-editor__switcher-item-check">
                        <IconCheck size={14} />
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="tc-storyboard-editor__switcher-preview">
            <div className="tc-storyboard-editor__switcher-preview-media">
              {modalSelectedCellImageUrl ? (
                <ManagedImage
                  className="tc-storyboard-editor__switcher-preview-image"
                  src={modalSelectedCellImageUrl}
                  alt={modalSelectedCellLabel}
                  draggable={false}
                  priority="visible"
                  ownerSurface="preview-modal"
                  ownerRequestKey={`storyboard-editor-switcher-preview:${modalSelectedCellImageUrl}`}
                />
              ) : (
                <div className="tc-storyboard-editor__switcher-preview-empty">
                  <IconPhotoPlus size={18} />
                  <Text className="tc-storyboard-editor__switcher-preview-empty-title" size="sm" fw={600}>
                    这个镜头还没有图片
                  </Text>
                  <Text className="tc-storyboard-editor__switcher-preview-empty-text" size="xs">
                    确认后外部会切换到该镜头位，方便继续补图或检查。
                  </Text>
                </div>
              )}
            </div>
            <div className="tc-storyboard-editor__switcher-preview-copy">
              <Text className="tc-storyboard-editor__switcher-preview-title" size="sm" fw={600}>
                {modalSelectedCellLabel}
              </Text>
              <Text className="tc-storyboard-editor__switcher-preview-text" size="xs">
                镜头 {draftSelectedIndex + 1} · #{modalSelectedCellShotNo} · {resolveStoryboardEditorCellAspect(modalSelectedCell, aspect)}
              </Text>
              <Text className="tc-storyboard-editor__switcher-preview-text" size="xs">
                {typeof modalSelectedCell?.prompt === 'string' && modalSelectedCell.prompt.trim()
                  ? modalSelectedCell.prompt.trim()
                  : '当前镜头没有附带提示词。'}
              </Text>
            </div>
            <div className="tc-storyboard-editor__switcher-actions">
              <Button className="tc-storyboard-editor__switcher-action" variant="subtle" color="gray" onClick={closeSwitcher}>
                取消
              </Button>
              <Button className="tc-storyboard-editor__switcher-action" onClick={confirmSwitcher}>
                确定
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}

const _StoryboardEditorContent = React.memo(StoryboardEditorContent)
export { _StoryboardEditorContent as StoryboardEditorContent }

import React from 'react'
import { Handle, NodeResizeControl, Position, useReactFlow } from '@xyflow/react'
import type { Node, NodeProps, ResizeParams } from '@xyflow/react'
import {
  IconArrowsDiff,
  IconColumns2,
  IconEye,
  IconEyeOff,
  IconFocusCentered,
  IconHandFinger,
  IconStack2,
} from '@tabler/icons-react'
import { ManagedImage } from '../../domain/resource-runtime'
import { useRFStore } from '../store'
import { HANDLE_HORIZONTAL_OFFSET } from '../nodes/taskNodeHelpers'
import { resolveImageCompareInputs } from './imageCompareSelection'
import type { ImageCompareSource } from './imageCompareSelection'
import {
  IMAGE_COMPARE_DEFAULT_SIZE,
  IMAGE_COMPARE_MAX_SIZE,
  IMAGE_COMPARE_MIN_SIZE,
  IMAGE_COMPARE_TARGET_HANDLE_ID,
} from './imageCompareNodeData'
import type { ImageCompareMode, ImageCompareNodeData } from './imageCompareNodeData'
import './ImageCompareNode.css'

type ImageCompareCanvasNode = Node<ImageCompareNodeData, 'imageCompare'>

const MODES: ReadonlyArray<{ mode: ImageCompareMode; label: string; Icon: typeof IconColumns2 }> = [
  { mode: 'side', label: '并排', Icon: IconColumns2 },
  { mode: 'slider', label: '滑动', Icon: IconStack2 },
  { mode: 'overlay', label: '叠加', Icon: IconEye },
  { mode: 'toggle', label: '点按', Icon: IconHandFinger },
]

const KEYBOARD_STEP_PERCENT = 2

function clampPercent(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(100, Math.max(0, numeric))
}

function clampSize(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

function readMode(value: unknown): ImageCompareMode {
  return MODES.some((entry) => entry.mode === value) ? (value as ImageCompareMode) : 'side'
}

// 只订阅「入边上游的图片」这一份派生值：序列化成字符串让无关的画布变化不触发重渲染。
function useImageCompareInputs(nodeId: string): ImageCompareSource[] {
  const inputsKey = useRFStore((state) => {
    const sourceIds = new Set<string>()
    for (const edge of state.edges) {
      if (edge.target === nodeId) sourceIds.add(edge.source)
    }
    if (sourceIds.size === 0) return '[]'
    return JSON.stringify(resolveImageCompareInputs(state.nodes.filter((node) => sourceIds.has(node.id))))
  })
  return React.useMemo(() => JSON.parse(inputsKey) as ImageCompareSource[], [inputsKey])
}

function CompareImage({
  nodeId,
  source,
  slot,
  className,
  style,
}: {
  nodeId: string
  source: ImageCompareSource
  slot: string
  className?: string
  style?: React.CSSProperties
}): JSX.Element {
  return (
    <ManagedImage
      className={`tc-image-compare-node__image${className ? ` ${className}` : ''}`}
      style={style}
      src={source.url}
      alt={source.label}
      // 与图片节点主图（ImageContent）请求完全相同的资源：同 kind/variant → 同一资源 id，
      // 直接命中已解码的内存缓存；同 crossOrigin → 同一条浏览器 HTTP 缓存（CORS 与非 CORS 分开缓存）。
      // 任一不同都会变成新资源：等可见性闸门 → 排下载队列 → 重新拉取，连上后要慢一拍才出图。
      kind="image"
      variantKey="original"
      priority="critical"
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      ownerNodeId={nodeId}
      ownerSurface="image-compare-node"
      ownerRequestKey={`image-compare-node:${nodeId}:${slot}:${source.nodeId}`}
      draggable={false}
    />
  )
}

function IndexBadge({ index, className }: { index: number; className?: string }): JSX.Element {
  return (
    <span className={`tc-image-compare-node__badge${className ? ` ${className}` : ''}`}>{index + 1}</span>
  )
}

/**
 * 画布上的图片对比节点。
 *
 * 把图片节点连到左侧输入端即可对比，四种方式：并排 / 滑动分割 / 叠加透明度 / 点按切换。
 * 全部交互都在节点内完成（画布优先），聚焦按钮只是把视图缩放到本节点，不开全屏浮层。
 */
export function ImageCompareNode({ id, data, width, height, selected }: NodeProps<ImageCompareCanvasNode>) {
  const rf = useReactFlow()
  const updateNodeData = useRFStore((state) => state.updateNodeData)
  const readOnly = data.readOnly === true
  const inputs = useImageCompareInputs(id)
  const [first, second] = inputs
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : '对比节点'

  const [mode, setMode] = React.useState<ImageCompareMode>(() => readMode(data.compareMode))
  React.useEffect(() => setMode(readMode(data.compareMode)), [data.compareMode])

  const [splitPercent, setSplitPercent] = React.useState(() => clampPercent(data.splitPercent, 50))
  const [opacityPercent, setOpacityPercent] = React.useState(() => clampPercent(data.overlayOpacity, 50))
  const [draggingSplit, setDraggingSplit] = React.useState(false)
  const [togglePinned, setTogglePinned] = React.useState(false)
  const [togglePressed, setTogglePressed] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!draggingSplit) setSplitPercent(clampPercent(data.splitPercent, 50))
  }, [data.splitPercent, draggingSplit])
  React.useEffect(() => setOpacityPercent(clampPercent(data.overlayOpacity, 50)), [data.overlayOpacity])

  const persist = React.useCallback((patch: Partial<ImageCompareNodeData>) => {
    if (!readOnly) updateNodeData(id, patch)
  }, [id, readOnly, updateNodeData])

  const selectMode = (next: ImageCompareMode) => {
    setMode(next)
    setTogglePinned(false)
    if (next !== readMode(data.compareMode)) persist({ compareMode: next })
  }

  const updateSplitFromClientX = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    setSplitPercent(clampPercent(((clientX - rect.left) / rect.width) * 100, 50))
  }

  const handleSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingSplit(true)
    updateSplitFromClientX(event.clientX)
  }

  const handleSplitPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingSplit) updateSplitFromClientX(event.clientX)
  }

  const endSplitDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!draggingSplit) return
    setDraggingSplit(false)
    persist({ splitPercent: Math.round(splitPercent * 10) / 10 })
  }

  const handleSplitKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEYBOARD_STEP_PERCENT * 5 : KEYBOARD_STEP_PERCENT
    let next: number
    if (event.key === 'ArrowLeft') next = clampPercent(splitPercent - step, 50)
    else if (event.key === 'ArrowRight') next = clampPercent(splitPercent + step, 50)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 100
    else return
    event.preventDefault()
    event.stopPropagation()
    setSplitPercent(next)
    persist({ splitPercent: next })
  }

  const handleResizeEnd = (_event: unknown, params: ResizeParams) => {
    persist({
      nodeWidth: clampSize(params.width, IMAGE_COMPARE_MIN_SIZE.width, IMAGE_COMPARE_MAX_SIZE.width, IMAGE_COMPARE_DEFAULT_SIZE.width),
      nodeHeight: clampSize(params.height, IMAGE_COMPARE_MIN_SIZE.height, IMAGE_COMPARE_MAX_SIZE.height, IMAGE_COMPARE_DEFAULT_SIZE.height),
    })
  }

  const focusNode = () => {
    void rf.fitView({ nodes: [{ id }], padding: 0.12, duration: 280 })
  }

  const rootStyle: React.CSSProperties = {
    width: width ?? clampSize(data.nodeWidth, IMAGE_COMPARE_MIN_SIZE.width, IMAGE_COMPARE_MAX_SIZE.width, IMAGE_COMPARE_DEFAULT_SIZE.width),
    height: height ?? clampSize(data.nodeHeight, IMAGE_COMPARE_MIN_SIZE.height, IMAGE_COMPARE_MAX_SIZE.height, IMAGE_COMPARE_DEFAULT_SIZE.height),
  }

  const renderStage = (): JSX.Element => {
    if (!first) {
      return (
        <div className="tc-image-compare-node__empty">
          <IconArrowsDiff size={22} aria-hidden="true" />
          <span>把两张图片连到左侧输入端开始对比</span>
        </div>
      )
    }

    if (mode === 'side' || !second) {
      const sources = mode === 'side' ? inputs : [first]
      return (
        <div
          className="tc-image-compare-node__side"
          style={{ gridTemplateColumns: `repeat(${Math.min(sources.length, 4)}, minmax(0, 1fr))` }}
        >
          {sources.map((source, index) => (
            <div className="tc-image-compare-node__cell" key={`${source.nodeId}:${index}`} title={source.label}>
              <IndexBadge index={index} />
              <CompareImage nodeId={id} source={source} slot={`side-${index}`} />
            </div>
          ))}
          {!second ? (
            <div className="tc-image-compare-node__cell tc-image-compare-node__cell--placeholder">
              <IndexBadge index={1} />
              <span>再连一张图片</span>
            </div>
          ) : null}
        </div>
      )
    }

    if (mode === 'slider') {
      return (
        <div
          ref={stageRef}
          className={`tc-image-compare-node__stage tc-image-compare-node__stage--slider nodrag nopan${draggingSplit ? ' tc-image-compare-node__stage--dragging' : ''}`}
          style={{ '--tc-image-compare-node-split': `${splitPercent}%` } as React.CSSProperties}
          onPointerDown={handleSplitPointerDown}
          onPointerMove={handleSplitPointerMove}
          onPointerUp={endSplitDrag}
          onPointerCancel={endSplitDrag}
        >
          <CompareImage nodeId={id} source={first} slot="layer-1" className="tc-image-compare-node__image--layer" />
          <div className="tc-image-compare-node__clip" aria-hidden="true">
            <CompareImage nodeId={id} source={second} slot="layer-2" className="tc-image-compare-node__image--layer" />
          </div>
          <IndexBadge index={0} className="tc-image-compare-node__badge--start" />
          <IndexBadge index={1} className="tc-image-compare-node__badge--end" />
          <div
            className="tc-image-compare-node__divider"
            role="slider"
            tabIndex={0}
            aria-label="分割位置"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(splitPercent)}
            onKeyDown={handleSplitKeyDown}
            onDoubleClick={() => {
              setSplitPercent(50)
              persist({ splitPercent: 50 })
            }}
          >
            <span className="tc-image-compare-node__divider-line" />
            <span className="tc-image-compare-node__divider-handle">
              <IconArrowsDiff size={14} aria-hidden="true" />
            </span>
          </div>
        </div>
      )
    }

    if (mode === 'overlay') {
      return (
        <div className="tc-image-compare-node__stage">
          <CompareImage nodeId={id} source={first} slot="layer-1" className="tc-image-compare-node__image--layer" />
          <CompareImage
            nodeId={id}
            source={second}
            slot="layer-2"
            className="tc-image-compare-node__image--layer"
            style={{ opacity: opacityPercent / 100 }}
          />
          <div className="tc-image-compare-node__opacity nodrag nopan">
            <input
              className="tc-image-compare-node__opacity-input"
              type="range"
              min={0}
              max={100}
              value={Math.round(opacityPercent)}
              aria-label="图 2 不透明度"
              style={{ '--tc-image-compare-node-opacity': `${opacityPercent}%` } as React.CSSProperties}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => setOpacityPercent(clampPercent(Number(event.currentTarget.value), 50))}
              onPointerUp={(event) => persist({ overlayOpacity: Number(event.currentTarget.value) })}
              onKeyUp={(event) => persist({ overlayOpacity: Number(event.currentTarget.value) })}
            />
          </div>
        </div>
      )
    }

    const showingSecond = togglePinned !== togglePressed
    return (
      <div
        className="tc-image-compare-node__stage tc-image-compare-node__stage--toggle nodrag nopan"
        title="按住查看另一张，松开还原"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          setTogglePressed(true)
        }}
        onPointerUp={() => setTogglePressed(false)}
        onPointerCancel={() => setTogglePressed(false)}
      >
        <CompareImage
          nodeId={id}
          source={first}
          slot="layer-1"
          className="tc-image-compare-node__image--layer"
          style={{ visibility: showingSecond ? 'hidden' : 'visible' }}
        />
        <CompareImage
          nodeId={id}
          source={second}
          slot="layer-2"
          className="tc-image-compare-node__image--layer"
          style={{ visibility: showingSecond ? 'visible' : 'hidden' }}
        />
        <IndexBadge index={showingSecond ? 1 : 0} className="tc-image-compare-node__badge--start" />
        <button
          type="button"
          className="tc-image-compare-node__pin"
          title={togglePinned ? '切回图 1' : '固定显示图 2'}
          aria-label={togglePinned ? '切回图 1' : '固定显示图 2'}
          aria-pressed={togglePinned}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            setTogglePinned((value) => !value)
          }}
        >
          {togglePinned ? <IconEye size={14} /> : <IconEyeOff size={14} />}
        </button>
      </div>
    )
  }

  return (
    <div className={`tc-image-compare-node${selected ? ' tc-image-compare-node--selected' : ''}`} style={rootStyle}>
      <div className="tc-image-compare-node__title">
        <IconArrowsDiff size={14} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="tc-image-compare-node__card">
        <div className="tc-image-compare-node__toolbar nodrag nopan" role="tablist" aria-label="对比方式">
          {MODES.map(({ mode: entryMode, label: entryLabel, Icon }) => (
            <button
              key={entryMode}
              type="button"
              role="tab"
              aria-selected={mode === entryMode}
              className={`tc-image-compare-node__mode${mode === entryMode ? ' tc-image-compare-node__mode--active' : ''}`}
              title={entryLabel}
              aria-label={entryLabel}
              onClick={(event) => {
                event.stopPropagation()
                selectMode(entryMode)
              }}
            >
              <Icon size={15} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            className="tc-image-compare-node__focus"
            title="聚焦到此节点"
            aria-label="聚焦到此节点"
            onClick={(event) => {
              event.stopPropagation()
              focusNode()
            }}
          >
            <IconFocusCentered size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="tc-image-compare-node__body">{renderStage()}</div>
      </div>
      <div className="tc-handle-layer">
        <Handle
          id={IMAGE_COMPARE_TARGET_HANDLE_ID}
          className="tc-handle"
          type="target"
          position={Position.Left}
          style={{ position: 'absolute', pointerEvents: 'auto', left: -HANDLE_HORIZONTAL_OFFSET, top: '50%' }}
          data-handle-type="image"
          data-handle-position="left"
          title="输入: 图片"
          aria-label="输入: 图片"
        />
      </div>
      {selected && !readOnly ? (
        <NodeResizeControl
          className="tc-task-node__media-resize nodrag"
          position="bottom-right"
          minWidth={IMAGE_COMPARE_MIN_SIZE.width}
          minHeight={IMAGE_COMPARE_MIN_SIZE.height}
          maxWidth={IMAGE_COMPARE_MAX_SIZE.width}
          maxHeight={IMAGE_COMPARE_MAX_SIZE.height}
          onResizeEnd={handleResizeEnd}
        >
          <div className="tc-task-node__media-resize-handle" />
        </NodeResizeControl>
      ) : null}
    </div>
  )
}

export default ImageCompareNode

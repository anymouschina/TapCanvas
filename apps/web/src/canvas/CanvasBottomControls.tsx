import React, { useCallback, useState } from 'react'
import { Panel, MiniMap, useReactFlow, useStore } from '@xyflow/react'
import {
  IconMap,
  IconLayoutGrid,
  IconScan,
  IconLayoutSidebarLeftExpand,
  IconMinus,
  IconPlus,
} from '@tabler/icons-react'
import { Popover, Slider, Tooltip } from '@mantine/core'
import { useUIStore } from '../ui/uiStore'
import { CanvasGraphStats } from './CanvasGraphStats'




type MiniMapClick = NonNullable<React.ComponentProps<typeof MiniMap>['onClick']>
type MiniMapNodeClick = NonNullable<React.ComponentProps<typeof MiniMap>['onNodeClick']>

interface CanvasBottomControlsProps {
  showMinimap: boolean
  showGrid: boolean
  onToggleMinimap: () => void
  onToggleGrid: () => void
  onMiniMapClick: MiniMapClick
  onMiniMapNodeClick: MiniMapNodeClick
  isDarkCanvas: boolean
}

const ICON_BTN_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
  transition: 'background 0.12s, color 0.12s',
}

function PillIconBtn({
  active,
  label,
  onClick,
  children,
  iconColor,
  iconActiveColor,
  isDarkCanvas,
}: {
  active?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
  iconColor: string
  iconActiveColor: string
  isDarkCanvas: boolean
}) {
  const activeBg = isDarkCanvas ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)'
  const hoverBg = isDarkCanvas ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)'

  return (
    <Tooltip label={label} withArrow position="top" openDelay={400}>
      <button
        onClick={onClick}
        style={{
          ...ICON_BTN_BASE,
          color: active ? iconActiveColor : iconColor,
          background: active ? activeBg : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!active) {
            ;(e.currentTarget as HTMLButtonElement).style.background = hoverBg
          }
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = active ? activeBg : 'transparent'
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function CanvasBottomControls({
  showMinimap,
  showGrid,
  onToggleMinimap,
  onToggleGrid,
  onMiniMapClick,
  onMiniMapNodeClick,
  isDarkCanvas,
}: CanvasBottomControlsProps) {
  const rf = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  const [zoomOpen, setZoomOpen] = useState(false)
  const assetManagerOpen = useUIStore((s) => s.assetManagerOpen)
  const toggleAssetManager = useUIStore((s) => s.toggleAssetManager)
  const viewOnly = useUIStore((s) => s.viewOnly)

  const handleFitView = useCallback(() => {
    // 对标 Figma：有选中 fit 选中，无选中 fit 全部内容。
    // minZoom 必须下放（实例 minZoom=0.3 会钳制 fitView——内容铺得开时缩不下去，
    // 视图停在包围盒中心的空白地带，看起来像"没聚焦到内容区"）。
    const selected = rf.getNodes().filter((n) => n.selected)
    rf.fitView({
      padding: 0.15,
      duration: 300,
      minZoom: 0.05,
      maxZoom: 1,
      ...(selected.length > 0 ? { nodes: selected } : {}),
    })
  }, [rf])

  const handleZoom = useCallback(
    (value: number) => {
      rf.zoomTo(value, { duration: 0 })
    },
    [rf],
  )

  const pillBg = isDarkCanvas
    ? 'rgba(22,22,26,0.95)'
    : 'rgba(255,255,255,0.92)'
  const pillBorder = isDarkCanvas
    ? '1px solid rgba(255,255,255,0.06)'
    : '1px solid rgba(0,0,0,0.08)'
  const pillShadow = '0 4px 20px rgba(0,0,0,0.40)'
  const iconColor = isDarkCanvas ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.48)'
  const iconActiveColor = isDarkCanvas
    ? 'rgba(255,255,255,1)'
    : 'rgba(0,0,0,0.88)'

  // minimap 宽度（缩小为原 300 的 1/2）
  const CONTROLS_WIDTH = 150

  return (
    <>
      {showMinimap && (
        <MiniMap
          className="tc-canvas__minimap"
          position="bottom-left"
          style={{
            width: CONTROLS_WIDTH,
            height: Math.round(CONTROLS_WIDTH * 0.55),
            border: isDarkCanvas ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.08)',
          }}
          bgColor={isDarkCanvas ? '#222327' : '#f1f2f4'}
          maskColor={isDarkCanvas ? 'rgba(13, 13, 15, 0.78)' : 'rgba(15, 17, 20, 0.08)'}
          nodeColor={isDarkCanvas ? 'rgba(255, 255, 255, 0.3)' : 'rgba(15, 17, 20, 0.18)'}
          nodeStrokeColor="transparent"
          maskStrokeColor={isDarkCanvas ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 17, 20, 0.2)'}
          maskStrokeWidth={1}
          nodeBorderRadius={4}
          pannable
          zoomable={false}
          onClick={onMiniMapClick}
          onNodeClick={onMiniMapNodeClick}
        />
      )}

      {/* Bottom-left: 资产管理入口 + 缩放%（小地图/网格/适应折进缩放菜单） */}
      <Panel
        position="bottom-left"
        style={{ margin: 0, bottom: 12, left: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 资产管理 */}
          {!viewOnly ? (
            <button
              onClick={toggleAssetManager}
              aria-label="资产管理"
              aria-pressed={assetManagerOpen}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                height: 36,
                padding: '0 12px',
                background: assetManagerOpen
                  ? (isDarkCanvas ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)')
                  : pillBg,
                border: pillBorder,
                borderRadius: 8,
                boxShadow: pillShadow,
                color: assetManagerOpen ? iconActiveColor : (isDarkCanvas ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.7)'),
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <IconLayoutSidebarLeftExpand size={18} stroke={1.8} />
              资产管理
            </button>
          ) : null}

          {/* 缩放% + 菜单 */}
          <Popover
            opened={zoomOpen}
            onChange={setZoomOpen}
            position="top-start"
            offset={10}
            withinPortal
            shadow="md"
            radius={12}
          >
            <Popover.Target>
              <button
                onClick={() => setZoomOpen((p) => !p)}
                aria-label="缩放与视图"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 56,
                  height: 36,
                  padding: '0 10px',
                  background: pillBg,
                  border: pillBorder,
                  borderRadius: 8,
                  boxShadow: pillShadow,
                  color: isDarkCanvas ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.7)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Math.round(zoom * 100)}%
              </button>
            </Popover.Target>
            <Popover.Dropdown
              style={{
                width: 220,
                padding: 10,
                background: isDarkCanvas ? '#141519' : 'rgba(255,255,255,0.98)',
                border: isDarkCanvas ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <PillIconBtn label="缩小" onClick={() => handleZoom(Math.max(0.1, zoom - 0.1))} iconColor={iconColor} iconActiveColor={iconActiveColor} isDarkCanvas={isDarkCanvas}>
                  <IconMinus size={16} stroke={2} />
                </PillIconBtn>
                <div style={{ flex: 1 }}>
                  <Slider
                    value={zoom}
                    min={0.1}
                    max={2}
                    step={0.01}
                    onChange={handleZoom}
                    size="xs"
                    styles={{
                      root: { padding: 0 },
                      track: { background: isDarkCanvas ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)', height: 3 },
                      bar: { background: 'transparent' },
                      thumb: { background: isDarkCanvas ? '#ffffff' : '#1a1a1f', border: 'none', width: 16, height: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.45)' },
                    }}
                  />
                </div>
                <PillIconBtn label="放大" onClick={() => handleZoom(Math.min(2, zoom + 0.1))} iconColor={iconColor} iconActiveColor={iconActiveColor} isDarkCanvas={isDarkCanvas}>
                  <IconPlus size={16} stroke={2} />
                </PillIconBtn>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <PillIconBtn label="适应画布" onClick={() => { handleFitView(); setZoomOpen(false) }} iconColor={iconColor} iconActiveColor={iconActiveColor} isDarkCanvas={isDarkCanvas}>
                  <IconScan size={18} stroke={1.8} />
                </PillIconBtn>
                <PillIconBtn label="小地图" active={showMinimap} onClick={onToggleMinimap} iconColor={iconColor} iconActiveColor={iconActiveColor} isDarkCanvas={isDarkCanvas}>
                  <IconMap size={18} stroke={1.8} />
                </PillIconBtn>
                <PillIconBtn label="网格" active={showGrid} onClick={onToggleGrid} iconColor={iconColor} iconActiveColor={iconActiveColor} isDarkCanvas={isDarkCanvas}>
                  <IconLayoutGrid size={18} stroke={1.8} />
                </PillIconBtn>
                <button
                  onClick={() => { rf.zoomTo(1, { duration: 200 }); setZoomOpen(false) }}
                  style={{
                    marginLeft: 'auto',
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: iconColor,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  100%
                </button>
              </div>
            </Popover.Dropdown>
          </Popover>
        </div>
      </Panel>

      <CanvasGraphStats />

    </>
  )
}

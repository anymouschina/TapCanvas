import React from 'react'
import { Transition } from '@mantine/core'
import { useUIStore } from '../uiStore'
import { PanelCard } from '../PanelCard'
import {
  bottomBarCenteredPanelStyle,
  bottomBarSafeMaxHeight,
  BOTTOM_BAR_PANEL_WIDTH,
} from '../utils/panelPosition'
import { GlobalStyleChip } from './GlobalStyleChip'

/**
 * 画布底部工具条的一级风格入口。
 *
 * 风格选择仍复用 GlobalStyleChip 的项目级持久化与 styleReferenceRequest 回填，
 * 这里只负责稳定的画布内联承载，避免风格库继续藏在项目配置二级页面里。
 */
export default function CanvasStyleLibraryPanel(): JSX.Element | null {
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const projectId = useUIStore((state) => String(state.currentProject?.id || '').trim())
  const styleReferenceRequest = useUIStore((state) => state.styleReferenceRequest)

  React.useEffect(() => {
    if (!styleReferenceRequest || !projectId) return
    setActivePanel('style-library')
  }, [projectId, setActivePanel, styleReferenceRequest])

  if (!projectId) return null

  const mounted = activePanel === 'style-library'
  const maxHeight = bottomBarSafeMaxHeight()

  return (
    <div
      className="canvas-style-library-panel-anchor"
      style={bottomBarCenteredPanelStyle({
        zIndex: 240,
        halfWidth: BOTTOM_BAR_PANEL_WIDTH.wide / 2,
      })}
      data-ux-panel
    >
      <Transition
        className="canvas-style-library-panel-transition"
        mounted={mounted}
        transition="pop"
        duration={140}
        timingFunction="ease"
      >
        {(transitionStyle) => (
          <div className="canvas-style-library-panel-transition-inner" style={transitionStyle}>
            <PanelCard
              className="canvas-style-library-panel"
              padding="default"
              style={{
                width: `min(${BOTTOM_BAR_PANEL_WIDTH.wide}px, calc(100vw - 24px))`,
                maxHeight,
                overflow: 'auto',
              }}
              data-ux-panel
            >
              <div className="canvas-style-library-panel-body">
                <GlobalStyleChip
                  embedded
                  onSelected={() => setActivePanel(null)}
                  onClose={() => setActivePanel(null)}
                />
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}

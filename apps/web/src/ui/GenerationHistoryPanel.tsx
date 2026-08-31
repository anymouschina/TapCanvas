import React from 'react'
import {
  ActionIcon,
  Button,
  Loader,
  SegmentedControl,
  Text,
  Title,
  Tooltip,
  Transition,
} from '@mantine/core'
import {
  IconHistory,
  IconRefresh,
  IconX,
} from '@tabler/icons-react'

import { PanelCard } from './PanelCard'
import {
  GENERATION_KIND_LABELS,
  GenerationHistoryItemCard,
} from './GenerationHistoryItemCard'
import type { GenerationHistoryItem, GenerationHistoryKind } from './generationHistory'
import { useUIStore } from './uiStore'
import { useGenerationHistory } from './useGenerationHistory'
import {
  BOTTOM_BAR_PANEL_WIDTH,
  bottomBarPanelMetrics,
  bottomBarPanelStyle,
} from './utils/panelPosition'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import './GenerationHistoryPanel.css'

type HistoryFilter = 'all' | GenerationHistoryKind

const HISTORY_FILTER_VALUES = new Set<HistoryFilter>(['all', 'image', 'video', 'audio'])

function isHistoryFilter(value: string): value is HistoryFilter {
  return HISTORY_FILTER_VALUES.has(value as HistoryFilter)
}

export default function GenerationHistoryPanel(): JSX.Element | null {
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const anchorX = useUIStore((state) => state.panelAnchorX)
  const openPreview = useUIStore((state) => state.openPreview)
  const mounted = activePanel === 'generation-history'
  const [filter, setFilter] = React.useState<HistoryFilter>('all')
  const history = useGenerationHistory(mounted)

  React.useEffect(() => {
    if (mounted) setFilter('all')
  }, [mounted])

  const visibleItems = React.useMemo(
    () => filter === 'all' ? history.items : history.items.filter((item) => item.kind === filter),
    [filter, history.items],
  )
  const counts = React.useMemo(() => ({
    all: history.items.length,
    image: history.items.filter((item) => item.kind === 'image').length,
    video: history.items.filter((item) => item.kind === 'video').length,
    audio: history.items.filter((item) => item.kind === 'audio').length,
  }), [history.items])
  const handlePreview = React.useCallback((item: GenerationHistoryItem): void => {
    openPreview({ url: item.url, kind: item.kind, name: item.title })
  }, [openPreview])

  if (!mounted) return null

  const panelMetrics = bottomBarPanelMetrics(BOTTOM_BAR_PANEL_WIDTH.regular)
  const filterOptions: Array<{ label: string; value: HistoryFilter }> = [
    { label: `全部 ${counts.all}`, value: 'all' },
    { label: `图片 ${counts.image}`, value: 'image' },
    { label: `视频 ${counts.video}`, value: 'video' },
    { label: `音频 ${counts.audio}`, value: 'audio' },
  ]

  return (
    <div
      className="generation-history-panel__anchor"
      style={{
        ...bottomBarPanelStyle(anchorX, { zIndex: 340, halfWidth: panelMetrics.width / 2 }),
        width: panelMetrics.width,
      }}
      data-ux-panel
    >
      <Transition
        className="generation-history-panel__transition"
        mounted={mounted}
        transition="pop"
        duration={140}
        timingFunction="ease"
      >
        {(transitionStyles) => (
          <div className="generation-history-panel__transition-inner" style={transitionStyles}>
            <PanelCard
              className="generation-history-panel__shell"
              padding="compact"
              style={{ height: panelMetrics.height, maxHeight: panelMetrics.height }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="generation-history-panel__header">
                <div className="generation-history-panel__heading">
                  <IconHistory className="generation-history-panel__heading-icon" size={18} stroke={1.8} />
                  <Title className="generation-history-panel__title" order={5}>生成历史</Title>
                </div>
                <div className="generation-history-panel__header-actions">
                  <Tooltip className="generation-history-panel__tooltip" label="刷新" withArrow>
                    <ActionIcon
                      className="generation-history-panel__icon-button"
                      variant="subtle"
                      size="sm"
                      aria-label="刷新生成历史"
                      disabled={history.loading}
                      onClick={history.reload}
                    >
                      <IconRefresh className="generation-history-panel__action-icon" size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip className="generation-history-panel__tooltip" label="关闭" withArrow>
                    <ActionIcon
                      className="generation-history-panel__icon-button"
                      variant="subtle"
                      size="sm"
                      aria-label="关闭生成历史"
                      onClick={() => setActivePanel(null)}
                    >
                      <IconX className="generation-history-panel__action-icon" size={16} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              </div>

              <SegmentedControl
                className="generation-history-panel__filters"
                value={filter}
                onChange={(value) => {
                  if (isHistoryFilter(value)) setFilter(value)
                }}
                data={filterOptions}
                fullWidth
                size="xs"
              />

              <div className="generation-history-panel__content">
                {history.loading ? (
                  <div className="generation-history-panel__state" role="status" aria-label="正在加载生成历史">
                    <Loader className="generation-history-panel__loader" size="sm" />
                  </div>
                ) : history.error ? (
                  <div className="generation-history-panel__state generation-history-panel__state--error" role="alert">
                    <Text className="generation-history-panel__state-text" size="sm">{history.error}</Text>
                    <Button
                      className="generation-history-panel__retry"
                      variant="subtle"
                      size="compact-xs"
                      onClick={history.reload}
                    >
                      重试
                    </Button>
                  </div>
                ) : visibleItems.length === 0 ? (
                  <div className="generation-history-panel__state">
                    <IconHistory className="generation-history-panel__empty-icon" size={24} stroke={1.5} />
                    <Text className="generation-history-panel__state-text" size="sm" c="dimmed">
                      {filter === 'all' ? '暂无生成记录' : `暂无${GENERATION_KIND_LABELS[filter]}生成记录`}
                    </Text>
                  </div>
                ) : (
                  <div className="generation-history-panel__grid">
                    {visibleItems.map((item) => (
                      <GenerationHistoryItemCard key={item.id} item={item} onPreview={handlePreview} />
                    ))}
                  </div>
                )}
              </div>

              {!history.loading && !history.error && history.hasMore ? (
                <div className="generation-history-panel__footer">
                  <Button
                    className="generation-history-panel__load-more"
                    variant="subtle"
                    size="compact-xs"
                    loading={history.loadingMore}
                    onClick={history.loadMore}
                  >
                    加载更多
                  </Button>
                </div>
              ) : null}
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}

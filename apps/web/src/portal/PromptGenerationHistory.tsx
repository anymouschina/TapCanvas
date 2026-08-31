import React from 'react'
import { IconHistory, IconPhoto, IconPlayerPlay, IconRefresh, IconVideo } from '@tabler/icons-react'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import type { GenerationHistoryItem, GenerationHistoryKind } from '../ui/generationHistory'

type PromptGenerationHistoryProps = Readonly<{
  kind: Extract<GenerationHistoryKind, 'image' | 'video'>
  authenticated: boolean
  items: readonly GenerationHistoryItem[]
  loading: boolean
  error: string
  reload: () => void
  onRequestLogin: () => void
  onPreview: (item: GenerationHistoryItem) => void
}>

function formatHistoryDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '时间不可用'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

export function PromptGenerationHistory(props: PromptGenerationHistoryProps): JSX.Element {
  const kindLabel = props.kind === 'image' ? '图片' : '视频'
  const recentItems = React.useMemo(
    () => props.items.filter((item) => item.kind === props.kind).slice(0, 6),
    [props.items, props.kind],
  )
  return (
    <div className="prompt-generation-panel__history">
      <div className="prompt-generation-panel__history-heading">
        <span className="prompt-generation-panel__history-title">
          <IconHistory className="prompt-generation-panel__history-icon" size={16} />
          <span className="prompt-generation-panel__history-label">最近生成的{kindLabel}</span>
        </span>
        {props.authenticated && !props.loading ? (
          <button className="prompt-generation-panel__history-refresh" type="button" onClick={props.reload} aria-label="刷新生成历史" title="刷新生成历史">
            <IconRefresh className="prompt-generation-panel__history-refresh-icon" size={15} />
          </button>
        ) : null}
      </div>
      {!props.authenticated ? (
        <button className="prompt-generation-panel__history-login" type="button" onClick={props.onRequestLogin}>登录后查看个人生成历史</button>
      ) : props.loading ? (
        <p className="prompt-generation-panel__history-state">正在读取生成历史…</p>
      ) : props.error ? (
        <div className="prompt-generation-panel__history-error" role="alert">
          <span className="prompt-generation-panel__history-error-text">{props.error}</span>
          <button className="prompt-generation-panel__history-retry" type="button" onClick={props.reload}>重试</button>
        </div>
      ) : recentItems.length === 0 ? (
        <p className="prompt-generation-panel__history-state">还没有{kindLabel}生成记录</p>
      ) : (
        <div className="prompt-generation-panel__history-list">
          {recentItems.map((item) => (
            <button className="prompt-generation-panel__history-item" type="button" key={item.id} onClick={() => props.onPreview(item)} aria-label={`预览历史${kindLabel}：${item.title}`}>
              <span className="prompt-generation-panel__history-media">
                {item.kind === 'image' ? (
                  <ManagedImage className="prompt-generation-panel__history-thumbnail" src={item.url} alt="" priority="visible" />
                ) : item.thumbnailUrl ? (
                  <ManagedImage className="prompt-generation-panel__history-thumbnail" src={item.thumbnailUrl} alt="" priority="visible" />
                ) : (
                  <span className="prompt-generation-panel__history-placeholder">
                    {item.kind === 'video' ? <IconVideo className="prompt-generation-panel__history-placeholder-icon" size={20} /> : <IconPhoto className="prompt-generation-panel__history-placeholder-icon" size={20} />}
                  </span>
                )}
                {item.kind === 'video' ? (
                  <span className="prompt-generation-panel__history-play" aria-hidden="true">
                    <IconPlayerPlay className="prompt-generation-panel__history-play-icon" size={12} fill="currentColor" />
                  </span>
                ) : null}
              </span>
              <span className="prompt-generation-panel__history-copy">
                <span className="prompt-generation-panel__history-item-title">{item.title}</span>
                <span className="prompt-generation-panel__history-time">{formatHistoryDate(item.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

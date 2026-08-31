import React from 'react'
import { IconBrain, IconCircleCheck, IconExclamationCircle, IconLoader2, IconPlayerPause } from '@tabler/icons-react'

import type { LiveChatRunRecord } from './chat/liveChatRunStore'

function runPresentation(run: LiveChatRunRecord): {
  label: string
  className: string
  icon: React.ReactNode
} {
  if (run.status === 'active') {
    return { label: 'AI 编排中', className: 'task-inbox-panel__status--active', icon: <IconLoader2 className="task-inbox-panel__status-icon creative-agent-activity__spinner" size={15} /> }
  }
  if (run.status === 'succeeded') {
    return { label: 'AI 已完成', className: 'task-inbox-panel__status--succeeded', icon: <IconCircleCheck className="task-inbox-panel__status-icon" size={15} /> }
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    return { label: run.status === 'cancelled' ? 'AI 已取消' : 'AI 执行失败', className: 'task-inbox-panel__status--failed', icon: <IconExclamationCircle className="task-inbox-panel__status-icon" size={15} /> }
  }
  return { label: run.status === 'waiting_input' ? '等待你的输入' : '等待外部证据', className: 'task-inbox-panel__status--waiting', icon: <IconPlayerPause className="task-inbox-panel__status-icon" size={15} /> }
}

function formatRunTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function latestRunStep(run: LiveChatRunRecord): string {
  const currentTodo = run.todoItems.find((item) => item.status === 'in_progress')
  if (currentTodo) return currentTodo.text
  const completedTodo = [...run.todoItems].reverse().find((item) => item.status === 'completed')
  if (completedTodo) return completedTodo.text
  return run.skillName || run.projectName || '小 T 编排工作流'
}

export function CreativeAgentActivityRow({
  run,
  onOpenChat,
}: Readonly<{
  run: LiveChatRunRecord
  onOpenChat: () => void
}>): JSX.Element {
  const status = runPresentation(run)
  const title = run.displayText || run.requestText || '小 T 创作任务'
  return (
    <div className="task-inbox-panel__item creative-agent-activity" data-agent-activity>
      <button
        className="task-inbox-panel__item-main creative-agent-activity__main"
        type="button"
        onClick={onOpenChat}
        aria-label={`${title}，${status.label}，打开小 T 对话`}
      >
        <span className={`task-inbox-panel__status ${status.className}`}>{status.icon}</span>
        <span className="task-inbox-panel__item-body">
          <span className="task-inbox-panel__item-title-row">
            <IconBrain className="creative-agent-activity__brain" size={13} stroke={1.7} />
            <span className="task-inbox-panel__item-title">{title}</span>
          </span>
          <span className="task-inbox-panel__item-meta">
            <span className="task-inbox-panel__item-status-label">{status.label}</span>
            <span className="task-inbox-panel__item-separator">·</span>
            <span className="creative-agent-activity__step">{latestRunStep(run)}</span>
          </span>
        </span>
        <time className="task-inbox-panel__item-time" dateTime={new Date(run.updatedAt).toISOString()}>{formatRunTime(run.updatedAt)}</time>
        <span className="task-inbox-panel__preview-hint">对话</span>
      </button>
    </div>
  )
}

import React from 'react'
import { IconChevronDown, IconListCheck, IconSend2, IconSparkles } from '@tabler/icons-react'

export type ChatQueuedItem = {
  id: string
  text: string
  mode: 'steering' | 'follow_up'
}

export type ChatQueueDockProps = {
  /** 本浏览器已知、已持久化的排队消息（m_user_queued_* 本地投影）。 */
  items: ChatQueuedItem[]
  /**
   * 服务端仍有、但本浏览器已不掌握全文的排队条数（刷新/新窗口场景）。
   * 仅作计数展示，不做猜测性文案补全。
   */
  serverOnlyCount: number
  /** 本地条目中已被当前回合消费（开始执行）的条数：不再当作「排队中」展示。 */
  consumedCount: number
  /** 当前回合是否在运行：决定 dock 是否可交互展开（纯展示，不可编辑）。 */
  running: boolean
  compact?: boolean
}

function formatQueueSummary(items: ChatQueuedItem[]): string {
  const steering = items.filter((item) => item.mode === 'steering').length
  const followUps = items.length - steering
  const parts: string[] = []
  if (steering > 0) parts.push(`${steering} 条纠偏`)
  if (followUps > 0) parts.push(`${followUps} 条续做`)
  return parts.join(' · ')
}

/**
 * 排队消息 Dock（吸收 DeepSeek Harness QueueDock 的「输入区上方、与输入卡粘连、
 * 单条直接铺开、多条默认折叠为计数头」设计）。
 *
 * 与参考实现的差异（事实约束）：当前后端只暴露排队总数（pendingQueueCount），
 * 没有逐条查询/编辑/删除接口，因此本 dock 为**只读投影**：
 * - 本浏览器排队过的消息有全文（m_user_queued_*），逐条展示；
 * - 刷新/新窗口后服务端仍有、但前端无全文的排队条数，以独立计数行如实呈现，
 *   不伪造条目文案、不提供无效的编辑/删除按钮。
 */
export function ChatQueueDock({ items, serverOnlyCount, consumedCount, running, compact = false }: ChatQueueDockProps): JSX.Element | null {
  const [collapsed, setCollapsed] = React.useState(true)
  const totalCount = items.length + serverOnlyCount
  if (totalCount === 0) return null
  // 单条直接铺开；多条默认折叠（与参考 QueueDock 一致）。
  const expanded = !collapsed || items.length <= 1
  // 只有计数提示（刷新前排队/已消费）时也渲染列表区，让提示行可见。
  const showList = expanded && (items.length > 0 || serverOnlyCount > 0 || consumedCount > 0)
  return (
    <div className="tc-ai-chat-queue" data-queue-dock data-running={running || undefined} data-compact={compact || undefined}>
      <div className="tc-ai-chat-queue__panel">
        {items.length > 1 ? (
          <button
            type="button"
            className="tc-ai-chat-queue__header"
            aria-expanded={expanded}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span className="tc-ai-chat-queue__lead" aria-hidden="true">
              <IconListCheck size={14} />
            </span>
            <span className="tc-ai-chat-queue__count">
              {totalCount} 条排队 · {formatQueueSummary(items)}
            </span>
            <span className={`tc-ai-chat-queue__chevron${expanded ? ' tc-ai-chat-queue__chevron--open' : ''}`} aria-hidden="true">
              <IconChevronDown size={13} />
            </span>
          </button>
        ) : (
          <div className="tc-ai-chat-queue__header tc-ai-chat-queue__header--static">
            <span className="tc-ai-chat-queue__lead" aria-hidden="true">
              <IconListCheck size={14} />
            </span>
            <span className="tc-ai-chat-queue__count">1 条排队</span>
          </div>
        )}
        {showList ? (
          <ul className="tc-ai-chat-queue__list">
            {items.map((item) => (
              <li key={item.id} className="tc-ai-chat-queue__row">
                <span className="tc-ai-chat-queue__row-icon" aria-hidden="true">
                  {item.mode === 'steering' ? <IconSend2 size={13} /> : <IconSparkles size={13} />}
                </span>
                <span className="tc-ai-chat-queue__row-mode" aria-label={item.mode === 'steering' ? '纠偏' : '续做'}>
                  {item.mode === 'steering' ? '纠偏' : '续做'}
                </span>
                <span className="tc-ai-chat-queue__row-text">{item.text}</span>
              </li>
            ))}
            {serverOnlyCount > 0 ? (
              <li className="tc-ai-chat-queue__row tc-ai-chat-queue__row--server-only">
                <span className="tc-ai-chat-queue__row-mode">排队</span>
                <span className="tc-ai-chat-queue__row-text">
                  另有 {serverOnlyCount} 条刷新前已排队的请求（内容在当前窗口不可见）
                </span>
              </li>
            ) : null}
            {consumedCount > 0 ? (
              <li className="tc-ai-chat-queue__row tc-ai-chat-queue__row--server-only">
                <span className="tc-ai-chat-queue__row-mode">已执行</span>
                <span className="tc-ai-chat-queue__row-text">
                  {consumedCount} 条排队消息已在当前回合开始执行
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

const ChatQueueDockMemo = React.memo(ChatQueueDock)
export default ChatQueueDockMemo

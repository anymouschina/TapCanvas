import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { serializeSbaChoiceSelection } from '@tapcanvas/storyboard-adventure-protocol'

const CARD_REMARK_PLUGINS = [remarkGfm]
const CLIPBOARD_WRITE_TIMEOUT_MS = 1_500
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconFileText,
  IconPlus,
  IconSparkles,
  IconVolume,
} from '@tabler/icons-react'
import { ManagedImage } from '../../../domain/resource-runtime/components/ManagedImage'
import { toast } from '../../toast'
import { useChatCommandStore } from '../chatCommandStore'
import { XIAOT_ROLE, getTeamRole } from '../teamRoster'
import { focusCanvasNode, sendChatAction } from './blockActions'
import type {
  ActionBannerPayload,
  ArtifactPayload,
  CharacterCardsPayload,
  ChoicesCardPayload,
  DataBlock,
  RoleNoteCardPayload,
  SceneListPayload,
} from './types'
import type { BlockViewProps } from './registry'

// ── 小T ↔ 画布数据流通的两个出口 ──
// 卡片携带 nodeId → 点击聚焦画布节点；卡片携带 action 原话 → 走 chatCommandStore 以用户身份发回对话。

let sharedVoiceAudio: HTMLAudioElement | null = null
function playVoice(url: string): void {
  if (typeof window === 'undefined') return
  if (sharedVoiceAudio) {
    sharedVoiceAudio.pause()
    sharedVoiceAudio = null
  }
  sharedVoiceAudio = new Audio(url)
  void sharedVoiceAudio.play().catch(() => undefined)
}

async function writeClipboardText(value: string): Promise<void> {
  const writeText = navigator.clipboard?.writeText
  if (!writeText) throw new Error('当前浏览器不支持写入剪贴板')
  let timeoutId: number | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('剪贴板响应超时，请保持页面在前台后重试'))
    }, CLIPBOARD_WRITE_TIMEOUT_MS)
  })
  try {
    await Promise.race([writeText.call(navigator.clipboard, value), timeout])
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

/* ── ① 角色卡：横向排列，图占满、名字/语音沉底 ── */
export function CharacterCardsView({ block }: BlockViewProps<DataBlock>) {
  const payload = block.payload as CharacterCardsPayload | null
  const items = Array.isArray(payload?.items)
    ? payload.items.filter((item) => item && String(item.name || '').trim())
    : []
  if (!items.length) return null
  return (
    <div className="tc-ai-card tc-ai-card--characters">
      <div className="tc-ai-card__title">{String(payload?.title || '角色设计')}</div>
      <div className="tc-ai-character-row">
        {items.map((item, idx) => {
          const image = String(item.thumbnailUrl || item.imageUrl || '').trim()
          const clickable = Boolean(String(item.nodeId || '').trim())
          return (
            <div
              key={`${block.id}_role_${idx}`}
              className={`tc-ai-character-card${clickable ? ' tc-ai-character-card--clickable' : ''}`}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              title={clickable ? '点击聚焦画布节点' : undefined}
              onClick={() => focusCanvasNode(item.nodeId)}
            >
              {image ? (
                <ManagedImage className="tc-ai-character-card__image" src={image} alt={item.name} />
              ) : (
                <div className="tc-ai-character-card__placeholder">{item.name.slice(0, 1)}</div>
              )}
              <div className="tc-ai-character-card__footer">
                <span className="tc-ai-character-card__name">{item.name}</span>
                {String(item.voiceUrl || '').trim() ? (
                  <button
                    type="button"
                    className="tc-ai-character-card__voice"
                    aria-label={`试听 ${item.name} 的声音`}
                    onClick={(event) => {
                      event.stopPropagation()
                      playVoice(String(item.voiceUrl || '').trim())
                    }}
                  >
                    <IconVolume size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── ② 场景列表：要点 + 缩略图网格 + 新建场景 ── */
export function SceneListView({ block }: BlockViewProps<DataBlock>) {
  const payload = block.payload as SceneListPayload | null
  const items = Array.isArray(payload?.items)
    ? payload.items.filter((item) => item && String(item.name || '').trim())
    : []
  if (!items.length) return null
  const newSceneAction = String(payload?.newSceneAction || '').trim()
  return (
    <div className="tc-ai-card tc-ai-card--scenes">
      <div className="tc-ai-card__header">
        <div className="tc-ai-card__title">{String(payload?.title || '场景列表')}</div>
        {newSceneAction ? (
          <button type="button" className="tc-ai-card__chip" onClick={() => sendChatAction(newSceneAction)}>
            <IconPlus size={12} /> 新建场景
          </button>
        ) : null}
      </div>
      <ul className="tc-ai-scene-points">
        {items.filter((item) => String(item.summary || '').trim()).map((item, idx) => (
          <li key={`${block.id}_pt_${idx}`} className="tc-ai-scene-points__item">
            <strong>{item.name}：</strong>
            {item.summary}
          </li>
        ))}
      </ul>
      <div className="tc-ai-scene-grid">
        {items.filter((item) => String(item.thumbnailUrl || item.imageUrl || '').trim()).map((item, idx) => {
          const clickable = Boolean(String(item.nodeId || '').trim())
          return (
            <div
              key={`${block.id}_scene_${idx}`}
              className={`tc-ai-scene-card${clickable ? ' tc-ai-scene-card--clickable' : ''}`}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              title={clickable ? '点击聚焦画布节点' : undefined}
              onClick={() => focusCanvasNode(item.nodeId)}
            >
              <ManagedImage
                className="tc-ai-scene-card__image"
                src={String(item.thumbnailUrl || item.imageUrl || '').trim()}
                alt={item.name}
              />
              <span className="tc-ai-scene-card__name">{item.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── ③ 策划文档卡：折叠卡片，点击展开完整 markdown ── */
export function ArtifactCardView({ block }: BlockViewProps<DataBlock>) {
  const payload = block.payload as ArtifactPayload | null
  const [expanded, setExpanded] = React.useState(false)
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const title = String(payload?.title || '').trim()
  const markdown = String(payload?.markdown || '').trim()
  if (!title && !markdown) return null
  const copyDocument = async (): Promise<void> => {
    try {
      await writeClipboardText(markdown)
      setCopyState('copied')
      toast('文档已复制', 'success')
    } catch (reason: unknown) {
      setCopyState('failed')
      toast(reason instanceof Error && reason.message.trim() ? reason.message : '文档复制失败', 'error')
    }
  }
  const toggleExpanded = (): void => setExpanded((prev) => !prev)
  return (
    <div className={`tc-ai-card tc-ai-card--artifact${expanded ? ' tc-ai-card--artifact-open' : ''}`}>
      <div className="tc-ai-artifact__head">
        <button
          type="button"
          className="tc-ai-artifact__toggle"
          aria-expanded={expanded}
          aria-label={expanded ? '收起文档' : '展开文档'}
          onClick={toggleExpanded}
        >
          <span className="tc-ai-artifact__icon"><IconFileText size={16} /></span>
          <span className="tc-ai-artifact__meta">
            <span className="tc-ai-artifact__title">{title || '策划文档'}</span>
            {String(payload?.summary || payload?.timestamp || '').trim() ? (
              <span className="tc-ai-artifact__summary">{String(payload?.summary || payload?.timestamp)}</span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          className="tc-ai-artifact__copy"
          aria-label={copyState === 'copied' ? '文档已复制' : copyState === 'failed' ? '重新复制文档' : '复制文档'}
          title={copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，点击重试' : '复制文档'}
          onClick={() => void copyDocument()}
        >
          {copyState === 'copied' ? <IconCheck className="tc-ai-artifact__copy-icon" size={14} /> : <IconCopy className="tc-ai-artifact__copy-icon" size={14} />}
        </button>
        <button
          type="button"
          className="tc-ai-artifact__expand"
          aria-expanded={expanded}
          aria-label={expanded ? '收起文档' : '展开文档'}
          title={expanded ? '收起文档' : '展开文档'}
          onClick={toggleExpanded}
        >
          <IconChevronDown className={`tc-ai-artifact__chevron${expanded ? ' tc-ai-artifact__chevron--open' : ''}`} size={14} />
        </button>
        <span className={`tc-ai-artifact__copy-state tc-ai-artifact__copy-state--${copyState}`} aria-live="polite">
          {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : ''}
        </span>
      </div>
      {expanded ? (
        <div className="tc-ai-artifact__body tc-ai-chat-markdown">
          <ReactMarkdown
            remarkPlugins={CARD_REMARK_PLUGINS}
            components={{
              img: ({ node: _node, src, alt }) => {
                const url = String(src || '').trim()
                if (!url) return null
                return (
                  <a href={url} target="_blank" rel="noreferrer" className="tc-ai-chat-bubble__asset-link">
                    <ManagedImage className="tc-ai-chat-bubble__asset-image" src={url} alt={String(alt || 'image')} />
                  </a>
                )
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  )
}

/* ── ⑤ 轻量选项卡：普通项发 value/label；SBA 发真实节点身份，气泡只展示 label ── */
export function ChoicesCardView({ block }: BlockViewProps<DataBlock>) {
  // 回合在飞时按钮仍可点：点选会进发送队列、回合结束自动补发（AiChatDialog 侧实现），
  // 这里只把提示语换成诚实版本，不再让用户以为点了没反应。
  const chatBusy = useChatCommandStore((s) => s.busy)
  const payload = block.payload as ChoicesCardPayload | null
  const options = Array.isArray(payload?.options)
    ? payload.options.filter((opt) => opt && String(opt.label || '').trim())
    : []
  if (!options.length) return null
  const sba = Boolean(payload?.sba)
  const question = String(payload?.question || '').trim()
  // 回合报错/中断收尾时被标过期的中途提问：小T 当时没等回答就继续推进了，
  // 渲染成灰态说明（不可点），避免被误读成「小T停下来在等你选」。
  if (payload?.superseded) {
    return (
      <div className="tc-ai-chat-bubble__choices tc-ai-chat-bubble__choices--superseded">
        <div className="tc-ai-chat-bubble__choice-group">
          {question ? <span className="tc-ai-chat-bubble__choice-group-label">{question}</span> : null}
          <p className="tc-ai-choice-btn-hint">（中途提问，小T 未等待选择已继续推进；本回合被中断，此卡已过期）</p>
        </div>
      </div>
    )
  }
  const wrapClass = ['tc-ai-chat-bubble__choices', sba ? 'tc-ai-chat-bubble__choices--sba' : ''].filter(Boolean).join(' ')
  const btnClass = ['tc-ai-choice-btn', sba ? 'tc-ai-choice-btn--sba' : ''].filter(Boolean).join(' ')
  return (
    <div className={wrapClass}>
      <div className="tc-ai-chat-bubble__choice-group">
        {question ? <span className="tc-ai-chat-bubble__choice-group-label">{question}</span> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((opt, idx) => (
            <button
              key={`${block.id}_opt_${idx}`}
              type="button"
              className={btnClass}
              onClick={() => {
                const selection = opt.metadata
                  ? serializeSbaChoiceSelection(opt.metadata, opt.label)
                  : opt.value || opt.label
                sendChatAction(selection, { displayText: opt.label })
              }}
            >
              {sba ? <span className="tc-ai-choice-btn__sba-arrow">▶</span> : null}
              <span className="tc-ai-choice-btn__label">{opt.label}</span>
              {String(opt.description || '').trim() ? (
                <span className="tc-ai-choice-btn__desc">{opt.description}</span>
              ) : null}
            </button>
          ))}
        </div>
        <p className="tc-ai-choice-btn-hint">
          {chatBusy
            ? '小T 正在工作中——现在点选也有效，会在本轮结束后自动发送。'
            : sba ? '或直接输入你的故事走向' : '如果您有其他想法，也可以直接告诉我。'}
        </p>
      </div>
    </div>
  )
}

/* ── ④ 推荐操作横幅：一键执行（替用户发送 action 原话），可带积分价 ── */
export function ActionBannerView({ block }: BlockViewProps<DataBlock>) {
  const payload = block.payload as ActionBannerPayload | null
  const title = String(payload?.title || '').trim()
  const action = String(payload?.action || '').trim()
  if (!title || !action) return null
  const cost = Number(payload?.cost)
  return (
    <div className="tc-ai-action-banner">
      <span className="tc-ai-action-banner__icon"><IconSparkles size={15} /></span>
      <span className="tc-ai-action-banner__text">
        <span className="tc-ai-action-banner__title">{title}</span>
        {String(payload?.description || '').trim() ? (
          <span className="tc-ai-action-banner__desc">{payload?.description}</span>
        ) : null}
      </span>
      <button type="button" className="tc-ai-action-banner__cta" onClick={() => sendChatAction(action)}>
        一键执行{Number.isFinite(cost) && cost > 0 ? <span className="tc-ai-action-banner__cost"> ✦{cost}</span> : null}
      </button>
    </div>
  )
}

/* ── ⑥ 角色介入评估卡：角色头像 + 类别徽标 + 点评正文，把智能团角色的专业判断留进对话历史 ── */
export function RoleNoteView({ block }: BlockViewProps<DataBlock>) {
  const payload = block.payload as RoleNoteCardPayload | null
  const role = getTeamRole(payload?.role)
  const roleName = String(payload?.roleName || role?.name || '').trim()
  const markdown = String(payload?.markdown || '').trim()
  if (!roleName || !markdown) return null
  const label = String(payload?.label || '').trim().toUpperCase()
  const accent = role?.accent || '#7c8190'
  const avatar = role?.avatar || XIAOT_ROLE.avatar
  const nodeId = Array.isArray(payload?.nodeIds)
    ? String(payload.nodeIds.find((id) => String(id || '').trim()) || '').trim()
    : ''
  const clickable = Boolean(nodeId)
  return (
    <div
      className={`tc-ai-card tc-ai-card--role-note${clickable ? ' tc-ai-card--role-note-clickable' : ''}`}
      style={{ ['--tc-role-accent' as string]: accent }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? '点击聚焦画布节点' : undefined}
      onClick={clickable ? () => focusCanvasNode(nodeId) : undefined}
    >
      <div className="tc-ai-role-note__head">
        {/* 头像为本地静态资源（teamRoster import），按 CLAUDE.md 例外用原生 <img> */}
        <img className="tc-ai-role-note__avatar" src={avatar} alt={roleName} />
        <span className="tc-ai-role-note__name">{roleName}</span>
        {label ? <span className="tc-ai-role-note__label">{label}</span> : null}
      </div>
      <div className="tc-ai-role-note__body tc-ai-chat-markdown">
        <ReactMarkdown
          remarkPlugins={CARD_REMARK_PLUGINS}
          components={{
            img: ({ node: _node, src, alt }) => {
              const url = String(src || '').trim()
              if (!url) return null
              return (
                <a href={url} target="_blank" rel="noreferrer" className="tc-ai-chat-bubble__asset-link">
                  <ManagedImage className="tc-ai-chat-bubble__asset-image" src={url} alt={String(alt || 'image')} />
                </a>
              )
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  )
}

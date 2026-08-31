// 全屏登录覆盖层：左侧后台可配的视频背景轮播，右侧登录面板。
// 替代旧 LoginModal 的 Mantine Modal 外壳；表单逻辑完全复用 LoginForm。
import React from 'react'
import ReactDOM from 'react-dom'
import { ActionIcon } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import {
  clearPendingRefCode,
  fetchHomepageDecoration,
  type HomepageDecoration,
  type LoginVideoItem,
} from '../api/server'
import { TapCanvasWordmark } from '../ui/brand/TapCanvasMark'
import { LoginForm } from './LoginForm'
import { useAuth } from './store'
import './loginOverlay.css'

// 装修数据模块级缓存：多次打开登录层不重复请求
let decorationPromise: Promise<HomepageDecoration> | null = null
function getDecoration(): Promise<HomepageDecoration> {
  if (!decorationPromise) decorationPromise = fetchHomepageDecoration()
  return decorationPromise
}

function LoginVideoPane({ videos }: { videos: LoginVideoItem[] }): JSX.Element {
  const [index, setIndex] = React.useState(0)
  const active = videos[index] ?? null
  const single = videos.length <= 1

  return (
    <div className="tc-login__stage">
      {active ? (
        <video
          key={active.url}
          className="tc-login__video"
          src={active.url}
          poster={active.posterUrl || undefined}
          autoPlay
          muted
          playsInline
          preload="metadata"
          loop={single}
          onEnded={() => { if (!single) setIndex((i) => (i + 1) % videos.length) }}
          onError={() => { if (!single) setIndex((i) => (i + 1) % videos.length) }}
        />
      ) : (
        <div className="tc-login__fallback" />
      )}
      <div className="tc-login__stage-shade" />
      {active?.caption ? (
        <div className="tc-login__caption">{active.caption}</div>
      ) : null}
      {videos.length > 1 ? (
        <div className="tc-login__dots" role="tablist">
          {videos.map((v, i) => (
            <button
              key={v.url + i}
              className={`tc-login__dot${i === index ? ' tc-login__dot--active' : ''}`}
              aria-label={`第 ${i + 1} 条视频`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export interface LoginOverlayProps {
  opened: boolean
  onClose: () => void
}

export function LoginOverlay({ opened, onClose }: LoginOverlayProps): JSX.Element | null {
	const setAuth = useAuth((s) => s.setAuth)
	const [videos, setVideos] = React.useState<LoginVideoItem[]>([])

  React.useEffect(() => {
    if (!opened) return
    let alive = true
    void getDecoration().then((d) => { if (alive) setVideos(d.loginVideos) })
    return () => { alive = false }
  }, [opened])

  React.useEffect(() => {
    if (!opened) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opened, onClose])

  const handleLoginSuccess = React.useCallback(
		(user: Parameters<typeof setAuth>[0]) => {
			setAuth(user)
			clearPendingRefCode()
			onClose()
    },
    [setAuth, onClose],
  )

  if (!opened) return null

  return ReactDOM.createPortal(
    <div className="tc-login" role="dialog" aria-modal="true" aria-label="登录 TapCanvas">
      <LoginVideoPane videos={videos} />

      <div className="tc-login__panel">
        <ActionIcon
          className="tc-login__close"
          style={{ position: 'absolute', top: 20, right: 20, zIndex: 2 }}
          variant="subtle"
          color="gray"
          size="lg"
          radius="xl"
          aria-label="关闭"
          onClick={onClose}
        >
          <IconX size={18} />
        </ActionIcon>

        <div className="tc-login__panel-inner">
          <TapCanvasWordmark
            className="tc-login__brand"
            markClassName="tc-login__brand-mark"
            nameClassName="tc-login__brand-name"
            markSize={32}
          />
          <h2 className="tc-login__title">欢迎登录</h2>
          <p className="tc-login__subtitle">继续你的创作之旅</p>

          <LoginForm
            onLoginSuccess={handleLoginSuccess}
            showTitle={false}
          />

          <p className="tc-login__agreement">
            登录即表示同意 TapCanvas 平台用户协议与隐私政策
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

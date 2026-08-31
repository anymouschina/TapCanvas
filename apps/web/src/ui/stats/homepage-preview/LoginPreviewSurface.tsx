import React from 'react'

import type { HomepageDecoration } from '../../../api/server'

export function LoginPreviewSurface({ decoration }: { decoration: HomepageDecoration }): JSX.Element {
  const videos = decoration.loginVideos.filter((video) => video.url.trim())
  const [activeVideoIndex, setActiveVideoIndex] = React.useState(0)
  const activeVideo = videos[activeVideoIndex] ?? null

  React.useEffect(() => {
    if (activeVideoIndex >= videos.length) setActiveVideoIndex(0)
  }, [activeVideoIndex, videos.length])

  return (
    <div className="stats-homepage-preview-login">
      <div className="stats-homepage-preview-login__stage">
        {activeVideo ? (
          <video
            className="stats-homepage-preview-login__video"
            key={activeVideo.url}
            src={activeVideo.url}
            poster={activeVideo.posterUrl || undefined}
            muted
            playsInline
            autoPlay
            loop
            preload="metadata"
          />
        ) : (
          <div className="stats-homepage-preview-login__empty">尚未配置登录页背景视频</div>
        )}
        <div className="stats-homepage-preview-login__shade" />
        {activeVideo?.caption?.trim() ? (
          <p className="stats-homepage-preview-login__caption">{activeVideo.caption}</p>
        ) : null}
        {videos.length > 1 ? (
          <div className="stats-homepage-preview-login__dots" aria-label="登录背景切换">
            {videos.map((video, index) => (
              <button
                className={`stats-homepage-preview-login__dot${index === activeVideoIndex ? ' is-active' : ''}`}
                type="button"
                aria-label={`查看第 ${index + 1} 条登录背景视频`}
                key={`${video.url}-${index}`}
                onClick={() => setActiveVideoIndex(index)}
              />
            ))}
          </div>
        ) : null}
      </div>
      <aside className="stats-homepage-preview-login__panel">
        <strong className="stats-homepage-preview-login__brand">TapCanvas</strong>
        <h2 className="stats-homepage-preview-login__title">欢迎登录</h2>
        <p className="stats-homepage-preview-login__subtitle">继续你的创作之旅</p>
        <div className="stats-homepage-preview-login__modes">
          <span className="stats-homepage-preview-login__mode is-active">登录</span>
          <span className="stats-homepage-preview-login__mode">注册</span>
        </div>
        <div className="stats-homepage-preview-login__field">手机号</div>
        <div className="stats-homepage-preview-login__field">密码</div>
        <div className="stats-homepage-preview-login__submit">登录</div>
      </aside>
    </div>
  )
}

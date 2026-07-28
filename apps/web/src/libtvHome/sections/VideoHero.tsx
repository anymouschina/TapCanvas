import React from "react";
import CreativeInput from "./CreativeInput";

interface VideoHeroProps {
  idea: string;
  onIdeaChange: (value: string) => void;
  onCreate: () => void;
}

export default function VideoHero({
  idea,
  onIdeaChange,
  onCreate,
}: VideoHeroProps): JSX.Element {
  const [videoError, setVideoError] = React.useState<string | null>(null);

  return (
    <section className="libtv-video-hero" aria-labelledby="libtv-video-hero-title">
      <div className="libtv-video-hero__media" aria-hidden="true">
        <video
          className="libtv-video-hero__video"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onCanPlay={() => setVideoError(null)}
          onError={() => setVideoError("首页背景视频加载失败，请检查 /videos/home-hero.mp4。")}
        >
          <source
            className="libtv-video-hero__source"
            src="/videos/home-hero.mp4"
            type="video/mp4"
          />
        </video>
        <div className="libtv-video-hero__scrim" />
        <div className="libtv-video-hero__light" />
      </div>

      <div className="libtv-video-hero__content">
        <p className="libtv-video-hero__eyebrow">HMAIGC AI SHORT DRAMA STUDIO</p>
        <h1 id="libtv-video-hero-title" className="libtv-video-hero__title">
          今天想拍点什么故事？
        </h1>
        <p className="libtv-video-hero__description">
          从一个灵感开始，完成剧本、角色、分镜与视频的连续创作。
        </p>
        <CreativeInput
          value={idea}
          onChange={onIdeaChange}
          onSubmit={onCreate}
        />
        {videoError ? (
          <p className="libtv-video-hero__error" role="alert">
            {videoError}
          </p>
        ) : null}
      </div>

    </section>
  );
}

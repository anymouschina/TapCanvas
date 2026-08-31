import React from 'react'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import type { CarouselSlide } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'

type CarouselPosition = 'is-left' | 'is-center' | 'is-right'

type NeoTvCarouselProps = {
  slides: CarouselSlide[]
  loading: boolean
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}

function wrapIndex(index: number, length: number): number {
  return (index % length + length) % length
}

export function NeoTvCarousel({ slides, loading, activeIndex, onActiveIndexChange }: NeoTvCarouselProps): JSX.Element | null {
  if (loading) {
    return (
      <section className="neo-tv-carousel neo-tv-carousel--loading" aria-label="平台动态" aria-busy="true">
        <div className="neo-tv-carousel__stage">
          <div className="neo-tv-carousel__skeleton tc-portal-skeleton" aria-hidden="true" />
        </div>
        <div className="neo-tv-carousel__dots neo-tv-carousel__dots--skeleton" aria-hidden="true">
          <span className="neo-tv-carousel__dot is-active" />
        </div>
      </section>
    )
  }
  if (slides.length === 0) return null

  const slots: ReadonlyArray<{ position: CarouselPosition; index: number }> = slides.length === 1
    ? [{ position: 'is-center', index: 0 }]
    : [
        { position: 'is-left', index: wrapIndex(activeIndex - 1, slides.length) },
        { position: 'is-center', index: wrapIndex(activeIndex, slides.length) },
        { position: 'is-right', index: wrapIndex(activeIndex + 1, slides.length) },
      ]

  const activateRelative = (offset: number): void => {
    onActiveIndexChange(wrapIndex(activeIndex + offset, slides.length))
  }

  return (
    <section className="neo-tv-carousel" aria-label="平台动态">
      {slides.length > 1 ? (
        <button
          className="neo-tv-carousel__nav neo-tv-carousel__nav--prev"
          type="button"
          aria-label="上一张"
          onClick={() => activateRelative(-1)}
        >
          <IconChevronLeft className="neo-tv-carousel__nav-icon" size={20} />
        </button>
      ) : null}
      <div className="neo-tv-carousel__stage">
        {slots.map(({ position, index }) => {
          const slide = slides[index]
          const isCenter = position === 'is-center'
          const clickable = isCenter ? Boolean(slide.linkUrl) : true
          return (
            <button
              className={`neo-tv-carousel__card ${position}${clickable ? ' is-clickable' : ''}`}
              type="button"
              key={`${position}:${slide.imageUrl}:${index}`}
              aria-label={slide.title || `平台动态 ${index + 1}`}
              onClick={() => {
                if (!isCenter) {
                  onActiveIndexChange(index)
                  return
                }
                if (slide.linkUrl) window.location.href = slide.linkUrl
              }}
            >
              <ManagedImage
                className="neo-tv-carousel__image"
                src={slide.imageUrl}
                alt={slide.title || '平台动态'}
                priority={isCenter ? 'visible' : 'prefetch'}
              />
              {isCenter && slide.title ? (
                <span className="neo-tv-carousel__overlay">
                  <strong className="neo-tv-carousel__title">{slide.title}</strong>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {slides.length > 1 ? (
        <button
          className="neo-tv-carousel__nav neo-tv-carousel__nav--next"
          type="button"
          aria-label="下一张"
          onClick={() => activateRelative(1)}
        >
          <IconChevronRight className="neo-tv-carousel__nav-icon" size={20} />
        </button>
      ) : null}
      <div className="neo-tv-carousel__dots">
        {slides.map((slide, index) => (
          <button
            className={`neo-tv-carousel__dot${index === wrapIndex(activeIndex, slides.length) ? ' is-active' : ''}`}
            type="button"
            aria-label={`查看第 ${index + 1} 张`}
            key={`${slide.imageUrl}:${index}`}
            onClick={() => onActiveIndexChange(index)}
          />
        ))}
      </div>
    </section>
  )
}

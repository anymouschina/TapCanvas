import React from 'react'

type TapCanvasMarkProps = {
  className: string
  size: number
  alt?: string
}

type TapCanvasWordmarkProps = {
  className: string
  markClassName: string
  nameClassName: string
  markSize: number
}

export function TapCanvasMark({ className, size, alt = 'TapCanvas' }: TapCanvasMarkProps): JSX.Element {
  return (
    <img
      className={className}
      src="/tapcanvas-mark.svg"
      alt={alt}
      width={size}
      height={size}
      draggable={false}
    />
  )
}

export function TapCanvasWordmark({
  className,
  markClassName,
  nameClassName,
  markSize,
}: TapCanvasWordmarkProps): JSX.Element {
  return (
    <span className={className} role="img" aria-label="TapCanvas">
      <TapCanvasMark className={markClassName} size={markSize} alt="" />
      <span className={nameClassName} aria-hidden="true">TapCanvas</span>
    </span>
  )
}

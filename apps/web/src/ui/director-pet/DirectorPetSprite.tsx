import React from 'react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import {
  DIRECTOR_PET_FRAME_INTERVAL_MS,
  DIRECTOR_PET_SPRITE_SHEETS,
  resolveDirectorPetFrameIndex,
  resolveDirectorPetFrameOffset,
  type DirectorPetAnimationState,
} from './directorPetAnimation'

type DirectorPetSpriteProps = {
  state: DirectorPetAnimationState
  reducedMotion: boolean
  mirrored?: boolean
  paused?: boolean
  preloadStates?: readonly DirectorPetAnimationState[]
}

export function DirectorPetSprite({
  state,
  reducedMotion,
  mirrored = false,
  paused = false,
  preloadStates = [],
}: DirectorPetSpriteProps): JSX.Element {
  const [step, setStep] = React.useState(0)
  const [documentVisible, setDocumentVisible] = React.useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )
  const animationPaused = reducedMotion || paused || !documentVisible

  React.useEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  React.useEffect(() => {
    setStep(0)
    if (animationPaused) return undefined
    const timer = window.setInterval(() => {
      setStep((currentStep) => currentStep + 1)
    }, DIRECTOR_PET_FRAME_INTERVAL_MS[state])
    return () => window.clearInterval(timer)
  }, [animationPaused, state])

  const sheet = DIRECTOR_PET_SPRITE_SHEETS[state]
  const activeFrameIndex = resolveDirectorPetFrameIndex(state, step, animationPaused)
  const offset = resolveDirectorPetFrameOffset(sheet, activeFrameIndex)

  return (
    <div
      className={`director-pet-sprite director-pet-sprite--${state}${mirrored ? ' director-pet-sprite--mirrored' : ''}`}
      data-animation-state={state}
      data-animation-paused={animationPaused ? 'true' : 'false'}
      data-frame-index={activeFrameIndex}
    >
      <ManagedImage
        className="director-pet-sprite__sheet"
        src={sheet.src}
        alt=""
        priority="critical"
        loading="eager"
        decoding="async"
        fetchPriority="high"
        draggable={false}
        style={{
          width: `${offset.widthPercent}%`,
          height: `${offset.heightPercent}%`,
          transform: `translate3d(${offset.xPercent}%, ${offset.yPercent}%, 0)`,
        }}
      />
      <div className="director-pet-sprite__preloads" aria-hidden="true">
        {preloadStates.filter((preloadState) => preloadState !== state).map((preloadState) => (
          <ManagedImage
            key={preloadState}
            className="director-pet-sprite__preload-sheet"
            src={DIRECTOR_PET_SPRITE_SHEETS[preloadState].src}
            alt=""
            priority="prefetch"
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            draggable={false}
          />
        ))}
      </div>
    </div>
  )
}

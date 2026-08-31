import React from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { useUIStore } from './uiStore'
import { useChatCommandStore } from './chat/chatCommandStore'
import { useChatActivityStore } from './chat/chatActivityStore'
import { isTerminalRunState, useVideoRunStore } from '../runner/videoRunStore'
import { DirectorPetSprite } from './director-pet/DirectorPetSprite'
import type { DirectorPetAnimationState } from './director-pet/directorPetAnimation'
import { resolveDirectorPetProductionActivity } from './director-pet/directorPetProductionActivity'
import {
  clampDirectorPetPosition,
  defaultDirectorPetPosition,
  DIRECTOR_PET_HEIGHT,
  DIRECTOR_PET_WIDTH,
  placeDirectorPetAtWall,
  resolveDirectorPetWallSide,
  settleDirectorPetPosition,
  type DirectorPetPosition,
  type DirectorPetViewport,
  type DirectorPetWallSide,
} from './directorPetPosition'
import './DirectorPetLauncher.css'

const POSITION_STORAGE_KEY = 'tapcanvas.director-pet.position.v1'
const ACTIVITY_INITIAL_DELAY_MS = 8_000
const ACTIVITY_REPEAT_DELAY_MS = 22_000
const DIRECTOR_PET_ACTIVITY_STATES = ['playful', 'idea', 'gacha', 'gaming'] as const satisfies readonly DirectorPetAnimationState[]
const DIRECTOR_PET_ACTIVITY_DURATION_MS: Record<(typeof DIRECTOR_PET_ACTIVITY_STATES)[number], number> = {
  playful: 1_200,
  idea: 1_800,
  gacha: 1_320,
  gaming: 1_440,
}

function currentViewport(): DirectorPetViewport {
  if (typeof window === 'undefined') return { width: 1280, height: 800 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function readStoredPosition(): DirectorPetPosition {
  const fallback = defaultDirectorPetPosition(currentViewport())
  if (typeof window === 'undefined') return fallback
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return fallback
    const candidate = parsed as { x?: unknown; y?: unknown }
    if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return fallback
    return settleDirectorPetPosition({ x: candidate.x, y: candidate.y }, currentViewport())
  } catch {
    return fallback
  }
}

function persistPosition(position: DirectorPetPosition): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position))
  } catch {
    // Position persistence is optional; interaction remains available.
  }
}

type DirectorPetLauncherProps = {
  onActivate?: () => void
}

export default function DirectorPetLauncher({ onActivate }: DirectorPetLauncherProps = {}): JSX.Element {
  const suppressNextClickRef = React.useRef(false)
  const activityTimerRef = React.useRef<number | null>(null)
  const activityResetTimerRef = React.useRef<number | null>(null)
  const aiChatOpen = useUIStore((state) => state.aiChatOpen)
  const chatBusy = useChatCommandStore((state) => state.busy)
  const backgroundActive = useChatActivityStore((state) => state.active)
  const videoRunsById = useVideoRunStore((state) => state.runsById)
  const prefersReducedMotion = useReducedMotion()
  const initialPosition = React.useMemo(readStoredPosition, [])
  const x = useMotionValue(initialPosition.x)
  const y = useMotionValue(initialPosition.y)
  const initialWallSide = React.useMemo(
    () => resolveDirectorPetWallSide(initialPosition, currentViewport()),
    [initialPosition],
  )
  const wallSideRef = React.useRef<DirectorPetWallSide | null>(initialWallSide)
  const [bubbleVisible, setBubbleVisible] = React.useState(true)
  const [bubbleSide, setBubbleSide] = React.useState<'left' | 'right'>(() => initialPosition.x < 230 ? 'right' : 'left')
  const [wallSide, setWallSide] = React.useState<DirectorPetWallSide | null>(initialWallSide)
  const [activityState, setActivityState] = React.useState<DirectorPetAnimationState | null>(null)
  const productionActivity = React.useMemo(
    () => resolveDirectorPetProductionActivity(
      Object.values(videoRunsById).filter(
        (run) => !isTerminalRunState(run.state) && run.state !== 'video_success',
      ),
    ),
    [videoRunsById],
  )
  const working = chatBusy || backgroundActive || productionActivity !== null
  const chatDialogOpen = onActivate ? false : aiChatOpen

  const updatePosition = React.useCallback((
    next: DirectorPetPosition,
    persist: boolean,
    settleAtWall = false,
  ) => {
    const viewport = currentViewport()
    const resolved = settleAtWall
      ? settleDirectorPetPosition(next, viewport)
      : clampDirectorPetPosition(next, viewport)
    const nextWallSide = resolveDirectorPetWallSide(resolved, viewport)
    x.set(resolved.x)
    y.set(resolved.y)
    wallSideRef.current = nextWallSide
    setWallSide(nextWallSide)
    setBubbleSide(nextWallSide === 'left' || (nextWallSide === null && resolved.x < viewport.width / 2) ? 'right' : 'left')
    if (persist) persistPosition(resolved)
  }, [x, y])

  React.useEffect(() => {
    if (wallSide) {
      setBubbleVisible(false)
      return undefined
    }
    const hideInitial = window.setTimeout(() => setBubbleVisible(false), 5600)
    const showPeriodically = window.setInterval(() => {
      setBubbleVisible(true)
      window.setTimeout(() => setBubbleVisible(false), 4200)
    }, 24000)
    return () => {
      window.clearTimeout(hideInitial)
      window.clearInterval(showPeriodically)
    }
  }, [wallSide])

  React.useEffect(() => {
    const onResize = () => {
      const viewport = currentViewport()
      const side = wallSideRef.current
      const next = side
        ? placeDirectorPetAtWall(side, y.get(), viewport)
        : { x: x.get(), y: y.get() }
      updatePosition(next, true)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [updatePosition, x, y])

  React.useEffect(() => {
    if (prefersReducedMotion || working || wallSide || chatDialogOpen) {
      setActivityState(null)
      return undefined
    }

    let cancelled = false
    let activityIndex = 0
    const scheduleActivity = (delay: number) => {
      activityTimerRef.current = window.setTimeout(() => {
        activityTimerRef.current = null
        if (cancelled) return
        if (document.visibilityState !== 'visible') {
          scheduleActivity(ACTIVITY_REPEAT_DELAY_MS)
          return
        }
        const nextActivity = DIRECTOR_PET_ACTIVITY_STATES[activityIndex]
        setActivityState(nextActivity)
        activityResetTimerRef.current = window.setTimeout(() => {
          activityResetTimerRef.current = null
          if (cancelled) return
          setActivityState(null)
          activityIndex = (activityIndex + 1) % DIRECTOR_PET_ACTIVITY_STATES.length
          scheduleActivity(ACTIVITY_REPEAT_DELAY_MS)
        }, DIRECTOR_PET_ACTIVITY_DURATION_MS[nextActivity])
      }, delay)
    }
    scheduleActivity(ACTIVITY_INITIAL_DELAY_MS)

    return () => {
      cancelled = true
      if (activityTimerRef.current != null) window.clearTimeout(activityTimerRef.current)
      if (activityResetTimerRef.current != null) window.clearTimeout(activityResetTimerRef.current)
      activityTimerRef.current = null
      activityResetTimerRef.current = null
    }
  }, [chatDialogOpen, prefersReducedMotion, wallSide, working])

  const openChat = React.useCallback(() => {
    if (onActivate) {
      onActivate()
      return
    }
    const expand = (window as unknown as { __tcExpandChat?: () => void }).__tcExpandChat
    expand?.()
  }, [onActivate])

  const handleClick = React.useCallback(() => {
    if (suppressNextClickRef.current) return
    openChat()
  }, [openChat])

  const handleDragStart = React.useCallback(() => {
    suppressNextClickRef.current = true
    wallSideRef.current = null
    setWallSide(null)
    setActivityState(null)
    setBubbleVisible(false)
  }, [])

  const handleDragEnd = React.useCallback(() => {
    suppressNextClickRef.current = true
    updatePosition({ x: x.get(), y: y.get() }, true, true)
    setBubbleVisible(false)
    window.setTimeout(() => {
      suppressNextClickRef.current = false
    }, 0)
  }, [updatePosition, x, y])

  const handleChatPeekDragStart = React.useCallback(() => {
    suppressNextClickRef.current = true
    setActivityState(null)
    setBubbleVisible(false)
  }, [])

  const handleChatPeekDragEnd = React.useCallback(() => {
    suppressNextClickRef.current = true
    const viewport = currentViewport()
    const clampedY = clampDirectorPetPosition({ x: x.get(), y: y.get() }, viewport).y
    y.set(clampedY)
    persistPosition({ x: x.get(), y: clampedY })
    window.setTimeout(() => {
      suppressNextClickRef.current = false
    }, 0)
  }, [x, y])

  const collapseChatFromPeek = React.useCallback(() => {
    if (suppressNextClickRef.current) return
    const toggleChat = (window as unknown as { __tcToggleChat?: () => void }).__tcToggleChat
    if (!toggleChat) {
      console.error('[director-pet] AI dialog toggle is unavailable while the dialog is open')
      return
    }
    updatePosition(placeDirectorPetAtWall('right', y.get(), currentViewport()), true)
    toggleChat()
  }, [updatePosition, y])

  const bubbleText = productionActivity?.bubbleText ?? (working ? '小T 正在片场' : '今天拍什么？')
  const bodyAnimation = wallSide || prefersReducedMotion
    ? { y: 0, rotate: 0, scale: 1 }
    : working
      ? { y: [0, -2, 0], rotate: 0, scale: [1, 1.01, 1] }
      : { y: [0, -3, 0], rotate: 0, scale: [1, 1.006, 1] }
  const spriteState: DirectorPetAnimationState = wallSide
    ? 'peek'
    : productionActivity
      ? productionActivity.animationState
      : working
      ? 'working'
      : activityState ?? 'idle'

  return (
    <div
      className={`director-pet-plane${chatDialogOpen ? ' director-pet-plane--chat-open' : ''}`}
      data-ux-floating
    >
      <AnimatePresence initial={false} mode="wait">
        {chatDialogOpen ? (
          <motion.button
            key="director-pet-chat-peek"
            type="button"
            className="director-pet director-pet--chat-peek"
            style={{ y, width: DIRECTOR_PET_WIDTH, height: DIRECTOR_PET_HEIGHT }}
            drag="y"
            dragElastic={0}
            dragMomentum={false}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            whileDrag={{ scale: 1.04, cursor: 'ns-resize' }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            aria-label="收起AI对话"
            title="上下拖动调整位置，点击收起AI对话"
            data-wall-side="chat-left"
            onDragStart={handleChatPeekDragStart}
            onDrag={() => {
              const viewport = currentViewport()
              const clampedY = clampDirectorPetPosition({ x: x.get(), y: y.get() }, viewport).y
              if (clampedY !== y.get()) y.set(clampedY)
            }}
            onDragEnd={handleChatPeekDragEnd}
            onClick={collapseChatFromPeek}
          >
            <motion.div className="director-pet__body director-pet__body--chat-peek">
              <DirectorPetSprite
                state="peek"
                reducedMotion={Boolean(prefersReducedMotion)}
                mirrored
                paused
              />
            </motion.div>
          </motion.button>
        ) : (
          <motion.button
            key="director-pet"
            type="button"
            className="director-pet"
            style={{ x, y, width: DIRECTOR_PET_WIDTH, height: DIRECTOR_PET_HEIGHT }}
            drag
            dragElastic={0}
            dragMomentum={false}
            initial={false}
            animate={{ opacity: 1, scale: 1 }}
            whileDrag={{ scale: 1.05, cursor: 'grabbing' }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            aria-label="打开导演小T对话"
            title="导演小T"
            data-wall-side={wallSide ?? 'none'}
            data-activity-state={activityState ?? 'none'}
            data-production-phase={productionActivity?.phase ?? 'none'}
            onHoverStart={() => {
              if (!wallSideRef.current) setBubbleVisible(true)
            }}
            onHoverEnd={() => {
              setBubbleVisible(false)
            }}
            onDragStart={handleDragStart}
            onDrag={() => {
              const clamped = clampDirectorPetPosition({ x: x.get(), y: y.get() }, currentViewport())
              if (clamped.x !== x.get()) x.set(clamped.x)
              if (clamped.y !== y.get()) y.set(clamped.y)
            }}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
          >
            <AnimatePresence>
              {(bubbleVisible || working) ? (
                <motion.span
                  key={bubbleText}
                  className={`director-pet__bubble director-pet__bubble--${bubbleSide}`}
                  initial={{ opacity: 0, y: 4, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.96 }}
                  transition={{ duration: 0.16 }}
                  role="status"
                >
                  <span className="director-pet__bubble-name">导演小T</span>
                  <span className="director-pet__bubble-text">{bubbleText}</span>
                </motion.span>
              ) : null}
            </AnimatePresence>
            <motion.div
              className="director-pet__body"
              animate={bodyAnimation}
              transition={{ duration: working ? 1.45 : 3.4, ease: 'easeInOut', repeat: wallSide || prefersReducedMotion ? 0 : Infinity }}
            >
              <DirectorPetSprite
                state={spriteState}
                reducedMotion={Boolean(prefersReducedMotion)}
                mirrored={wallSide === 'right'}
                paused={Boolean(wallSide)}
                preloadStates={wallSide ? [] : DIRECTOR_PET_ACTIVITY_STATES}
              />
            </motion.div>
            <motion.span
              className="director-pet__shadow"
              aria-hidden="true"
              animate={wallSide
                ? { scaleX: 0.7, opacity: 0 }
                : prefersReducedMotion
                  ? { scaleX: 1, opacity: 0.22 }
                  : { scaleX: [1, 0.78, 1], opacity: [0.22, 0.12, 0.22] }}
              transition={{ duration: working ? 1.45 : 3.4, ease: 'easeInOut', repeat: wallSide || prefersReducedMotion ? 0 : Infinity }}
            />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

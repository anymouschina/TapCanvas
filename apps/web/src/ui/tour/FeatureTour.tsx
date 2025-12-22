import React from 'react'
import { Portal, Paper, Title, Text, Group, Button } from '@mantine/core'
import { $ } from '../../canvas/i18n'

export type FeatureTourStep = {
  id: string
  target: string // data-tour key
  title: string
  description: string
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function getTargetElement(targetKey: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(`[data-tour="${CSS.escape(targetKey)}"]`)
}

function getTargetRect(el: HTMLElement | null): DOMRect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!Number.isFinite(r.left) || !Number.isFinite(r.top) || r.width <= 0 || r.height <= 0) return null
  return r
}

function computeTooltipPosition(opts: {
  highlight: { left: number; top: number; width: number; height: number }
  tooltip: { width: number; height: number }
  viewport: { width: number; height: number }
  gap: number
  margin: number
}) {
  const { highlight, tooltip, viewport, gap, margin } = opts

  const rightSpace = viewport.width - (highlight.left + highlight.width) - gap - margin
  const leftSpace = highlight.left - gap - margin
  const bottomSpace = viewport.height - (highlight.top + highlight.height) - gap - margin
  const topSpace = highlight.top - gap - margin

  const candidates: Array<{ placement: 'right' | 'left' | 'bottom' | 'top'; left: number; top: number; score: number }> = [
    {
      placement: 'right',
      left: highlight.left + highlight.width + gap,
      top: highlight.top + highlight.height / 2 - tooltip.height / 2,
      score: rightSpace,
    },
    {
      placement: 'left',
      left: highlight.left - tooltip.width - gap,
      top: highlight.top + highlight.height / 2 - tooltip.height / 2,
      score: leftSpace,
    },
    {
      placement: 'bottom',
      left: highlight.left + highlight.width / 2 - tooltip.width / 2,
      top: highlight.top + highlight.height + gap,
      score: bottomSpace,
    },
    {
      placement: 'top',
      left: highlight.left + highlight.width / 2 - tooltip.width / 2,
      top: highlight.top - tooltip.height - gap,
      score: topSpace,
    },
  ]

  const sorted = candidates.sort((a, b) => b.score - a.score)
  const best = sorted[0]

  return {
    placement: best.placement,
    left: clamp(best.left, margin, viewport.width - tooltip.width - margin),
    top: clamp(best.top, margin, viewport.height - tooltip.height - margin),
  }
}

export function FeatureTour(props: {
  opened: boolean
  steps: FeatureTourStep[]
  onClose: () => void
}) {
  const { opened, steps, onClose } = props
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [highlight, setHighlight] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const [tooltipPos, setTooltipPos] = React.useState<{ left: number; top: number } | null>(null)

  React.useEffect(() => {
    if (!opened) return
    setActiveIndex(0)
  }, [opened])

  const step = steps[activeIndex]

  const recompute = React.useCallback(() => {
    if (!opened || !step) return
    const el = getTargetElement(step.target)
    const rect = getTargetRect(el)

    if (!rect) {
      setHighlight(null)
      setTooltipPos(null)
      return
    }

    const padding = 10
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    const left = clamp(rect.left - padding, 8, viewportW - 16)
    const top = clamp(rect.top - padding, 8, viewportH - 16)
    const width = clamp(rect.width + padding * 2, 24, viewportW - left - 8)
    const height = clamp(rect.height + padding * 2, 24, viewportH - top - 8)

    setHighlight({ left, top, width, height })
  }, [opened, step])

  React.useLayoutEffect(() => {
    if (!opened || !step) return
    try {
      const el = getTargetElement(step.target)
      el?.scrollIntoView?.({ block: 'center', inline: 'center' })
    } catch {
      // ignore
    }
    recompute()
  }, [opened, step, recompute])

  React.useEffect(() => {
    if (!opened) return
    const onWin = () => recompute()
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    return () => {
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onWin, true)
    }
  }, [opened, recompute])

  React.useLayoutEffect(() => {
    if (!opened) return
    const el = tooltipRef.current
    if (!el) return

    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const tooltip = { width: el.offsetWidth || 360, height: el.offsetHeight || 160 }

    if (!highlight) {
      setTooltipPos({
        left: Math.round((viewport.width - tooltip.width) / 2),
        top: Math.round((viewport.height - tooltip.height) / 2),
      })
      return
    }

    const pos = computeTooltipPosition({
      highlight,
      tooltip,
      viewport,
      gap: 14,
      margin: 12,
    })
    setTooltipPos({ left: Math.round(pos.left), top: Math.round(pos.top) })
  }, [opened, highlight, activeIndex])

  if (!opened || steps.length === 0 || !step) return null

  const isFirst = activeIndex === 0
  const isLast = activeIndex === steps.length - 1

  return (
    <Portal>
      <div style={{ position: 'fixed', inset: 0, zIndex: 5000 }}>
        {/* Block interactions */}
        <div
          style={{ position: 'absolute', inset: 0, background: highlight ? 'transparent' : 'rgba(0,0,0,0.55)' }}
          onClick={onClose}
        />

        {/* Highlight with "hole" via huge shadow */}
        {highlight && (
          <div
            style={{
              position: 'absolute',
              left: highlight.left,
              top: highlight.top,
              width: highlight.width,
              height: highlight.height,
              borderRadius: 14,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              outline: '1px solid rgba(255,255,255,0.22)',
              background: 'transparent',
              pointerEvents: 'none',
            }}
          />
        )}

        <div
          ref={tooltipRef}
          style={{
            position: 'absolute',
            left: tooltipPos?.left ?? 0,
            top: tooltipPos?.top ?? 0,
            maxWidth: 380,
            width: 360,
          }}
        >
          <Paper withBorder shadow="xl" radius="lg" p="md" className="glass" style={{ pointerEvents: 'auto' }}>
            <Group justify="space-between" align="flex-start" gap="sm" mb={6}>
              <div style={{ minWidth: 0 }}>
                <Title order={6} style={{ lineHeight: 1.2 }}>
                  {step.title}
                </Title>
                <Text size="xs" c="dimmed">
                  {activeIndex + 1} / {steps.length}
                </Text>
              </div>
              <Button size="xs" variant="subtle" onClick={onClose}>
                {$('跳过')}
              </Button>
            </Group>

            <Text size="sm" style={{ lineHeight: 1.55 }}>
              {step.description}
            </Text>

            <Group justify="space-between" mt="md">
              <Button size="xs" variant="default" disabled={isFirst} onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}>
                {$('上一个')}
              </Button>
              <Button
                size="xs"
                onClick={() => {
                  if (isLast) onClose()
                  else setActiveIndex((i) => Math.min(steps.length - 1, i + 1))
                }}
              >
                {isLast ? $('完成') : $('下一个')}
              </Button>
            </Group>
          </Paper>
        </div>
      </div>
    </Portal>
  )
}


import { useMantineColorScheme, useMantineTheme } from '@mantine/core'
import { useContext, useMemo, type CSSProperties } from 'react'
import { CanvasLODContext } from '../CanvasLODContext'

type EdgeKind = 'image' | 'audio' | 'subtitle' | 'video' | 'any'

function normalizeEdgeType(type?: string | null): EdgeKind {
  if (!type) return 'any'
  const normalized = type.toLowerCase()
  if (normalized === 'image' || normalized === 'audio' || normalized === 'subtitle' || normalized === 'video') {
    return normalized
  }
  return 'any'
}

export function useEdgeVisuals(type?: string | null) {
  const { colorScheme } = useMantineColorScheme()
  const theme = useMantineTheme()
  const degraded = useContext(CanvasLODContext)

  return useMemo(() => {
    const edgeType = normalizeEdgeType(type)
    const isLight = colorScheme === 'light'
    const rgba = (color: string, alpha: number) => {
      if (typeof theme.fn?.rgba === 'function') return theme.fn.rgba(color, alpha)
      return color
    }

    // 描边完全对齐 Neowow 实测 DOM（2026-07-15 用户提供）：rgba(255,255,255,0.15) / 宽 2、
    // 无 vector-effect——低不透明度 + 世界坐标描边，缩到极限时亚像素 AA 自然柔化，
    // 既无点状断线也无锯齿（高对比细线才会暴露 AA 伪影，这就是之前两轮修不好的根因）。
    const edgeStroke = degraded
      ? (isLight ? 'rgba(17,18,21,0.10)' : 'rgba(255,255,255,0.08)')
      : (isLight ? 'rgba(17,18,21,0.18)' : 'rgba(255,255,255,0.15)')

    // 雅黑灰白基调：类型仅靠明度区分，不引入色相
    const palette: Record<EdgeKind, { light: string; dark: string }> = {
      image: { light: theme.colors.dark[5], dark: theme.colors.gray[3] },
      audio: { light: theme.colors.dark[3], dark: theme.colors.gray[5] },
      subtitle: { light: theme.colors.dark[2], dark: theme.colors.gray[2] },
      video: { light: theme.colors.dark[6], dark: theme.colors.gray[4] },
      any: { light: theme.colors.dark[4], dark: theme.colors.gray[5] },
    }

    const base = palette[edgeType] || palette.any
    const baseStroke = base[isLight ? 'light' : 'dark']
    const stroke = edgeStroke

    const edgeStyle: CSSProperties = {
      stroke,
      strokeWidth: 2,
      opacity: 1,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }

    const labelStyle = {
      color: isLight ? theme.colors.dark[6] : stroke,
      background: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(15,16,20,0.82)',
      borderColor: stroke,
      boxShadow: isLight ? '0 4px 12px rgba(17,18,21,0.12)' : '0 4px 12px rgba(0,0,0,0.35)',
    }

    const directionTextColor = isLight ? theme.colors.dark[8] : 'rgba(255,255,255,0.95)'
    const directionChipStyle: CSSProperties = {
      background: `linear-gradient(90deg, ${rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.7 : 0.65)} 0%, ${rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.98 : 0.95)} 100%)`,
      color: directionTextColor,
      border: `1px solid ${rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.6 : 0.8)}`,
      boxShadow: isLight ? '0 10px 30px rgba(17,18,21,0.18)' : '0 12px 30px rgba(0,0,0,0.45)',
      padding: '4px 10px',
      borderRadius: 14,
      fontWeight: 700,
      letterSpacing: 0.2,
    }

    const startCapColor = rgba(baseStroke, isLight ? 0.75 : 0.7)
    const endCapColor = rgba(baseStroke, isLight ? 0.65 : 0.6)

    return { stroke, edgeStyle, labelStyle, isLight, directionChipStyle, startCapColor, endCapColor }
  }, [colorScheme, theme, type, degraded])
}

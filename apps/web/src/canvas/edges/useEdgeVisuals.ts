import { useMantineColorScheme, useMantineTheme } from '@mantine/core'
import { useMemo, type CSSProperties } from 'react'

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

  return useMemo(() => {
    const edgeType = normalizeEdgeType(type)
    const isLight = colorScheme === 'light'
    const rgba = (color: string, alpha: number) => {
      if (typeof theme.fn?.rgba === 'function') return theme.fn.rgba(color, alpha)
      return color
    }

    const palette: Record<EdgeKind, { light: string; dark: string }> = {
      image: { light: theme.colors.blue[6], dark: theme.colors.blue[4] },
      audio: { light: theme.colors.teal[5], dark: theme.colors.teal[4] },
      subtitle: { light: theme.colors.yellow[6], dark: theme.colors.yellow[4] },
      video: { light: theme.colors.violet[5], dark: theme.colors.violet[3] },
      any: { light: theme.colors.dark[4], dark: theme.colors.gray[5] },
    }

    const base = palette[edgeType] || palette.any
    const stroke = rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.96 : 0.85)

    const edgeStyle: CSSProperties = {
      stroke,
      strokeWidth: isLight ? 3.4 : 3,
      opacity: 0.95,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }

    const labelStyle = {
      color: isLight ? theme.colors.dark[6] : stroke,
      background: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(15,16,20,0.82)',
      borderColor: stroke,
      boxShadow: isLight ? '0 4px 12px rgba(15,23,42,0.12)' : '0 4px 12px rgba(0,0,0,0.35)',
    }

    const directionChipStyle: CSSProperties = {
      background: `linear-gradient(90deg, ${rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.7 : 0.65)} 0%, ${rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.98 : 0.95)} 100%)`,
      color: isLight ? theme.white : 'rgba(255,255,255,0.95)',
      border: `1px solid ${rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.6 : 0.8)}`,
      boxShadow: isLight ? '0 10px 30px rgba(15,23,42,0.18)' : '0 12px 30px rgba(0,0,0,0.45)',
      padding: '4px 10px',
      borderRadius: 14,
      fontWeight: 700,
      letterSpacing: 0.2,
    }

    const startCapColor = rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.95 : 0.9)
    const endCapColor = rgba(base[isLight ? 'light' : 'dark'], isLight ? 0.85 : 0.8)

    return { stroke, edgeStyle, labelStyle, isLight, directionChipStyle, startCapColor, endCapColor }
  }, [colorScheme, theme, type])
}

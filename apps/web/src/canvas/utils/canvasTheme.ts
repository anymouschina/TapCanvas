import type { MantineTheme } from '@mantine/core'

type CanvasThemeColors = {
  backgroundGridColor: string
  connectionStrokeColor: string
  edgeMarkerColor: string
  emptyGuideBackground: string
  emptyGuideTextColor: string
  selectionBorderColor: string
}

export const buildCanvasThemeColors =
  (theme: MantineTheme, colorScheme: 'light' | 'dark'): CanvasThemeColors => {
    const isDarkCanvas = colorScheme === 'dark'
    const rgba = (color: string, alpha: number) =>
      typeof theme.fn?.rgba === 'function' ? theme.fn.rgba(color, alpha) : color

    const backgroundGridColor = isDarkCanvas ? theme.colors.dark[5] : theme.colors.gray[2]
    const connectionStrokeColor =
      theme.colors[theme.primaryColor]?.[isDarkCanvas ? 4 : 6] ||
      theme.colors.blue[isDarkCanvas ? 4 : 6]
    const edgeMarkerColor = isDarkCanvas ? theme.colors.gray[6] : theme.colors.gray[5]
    const emptyGuideBackground = isDarkCanvas ? rgba(theme.colors.dark[7], 0.9) : rgba(theme.white, 0.95)
    const emptyGuideTextColor = isDarkCanvas ? theme.white : theme.colors.dark[6]
    const selectionBorderColor = rgba(isDarkCanvas ? theme.white : theme.colors.gray[6], isDarkCanvas ? 0.35 : 0.5)

    return {
      backgroundGridColor,
      connectionStrokeColor,
      edgeMarkerColor,
      emptyGuideBackground,
      emptyGuideTextColor,
      selectionBorderColor,
    }
  }

import React from 'react'
import { useMantineColorScheme, useMantineTheme } from '@mantine/core'

export interface TaskNodeTheme {
  isDarkUi: boolean
  themeWhite: string
  rgba: (color: string, alpha: number) => string
  accentPrimary: string
  accentSecondary: string
  nodeShellBackground: string
  nodeShellBorder: string
  nodeShellShadow: string
  nodeShellGlow: string
  nodeShellText: string
  quickActionBackgroundActive: string
  quickActionIconColor: string
  quickActionIconActive: string
  quickActionHint: string
  mediaOverlayBackground: string
  mediaOverlayText: string
  toolbarBackground: string
  toolbarShadow: string
  subtleOverlayBackground: string
  mediaFallbackSurface: string
  mediaFallbackText: string
  videoSurface: string
  inlineDividerColor: string
  sleekChipBorderColor: string
  toolbarButtonBorderColor: string
  galleryCardBackground: string
  placeholderIconColor: string
  iconBadgeBackground: string
  iconBadgeShadow: string
  darkContentBackground: string
  darkCardShadow: string
  lightContentBackground: string
  summaryChipStyles: React.CSSProperties
  controlValueStyle: React.CSSProperties
  sleekChipBase: React.CSSProperties
  toolbarActionIconStyles: { root: React.CSSProperties; icon: React.CSSProperties }
}

export function useTaskNodeTheme(): TaskNodeTheme {
  const { colorScheme } = useMantineColorScheme()
  const theme = useMantineTheme()
  const isDarkUi = colorScheme === 'dark'

  return React.useMemo<TaskNodeTheme>(() => {
    const rgba = (color: string, alpha: number) =>
      typeof theme.fn?.rgba === 'function' ? theme.fn.rgba(color, alpha) : color
    const accentPrimary = theme.colors.blue?.[isDarkUi ? 4 : 6] || '#767d8a'
    const accentSecondary = theme.colors.cyan?.[isDarkUi ? 4 : 5] || '#a8aeb8'
    const nodeShellBackground = isDarkUi ? 'rgba(15,20,28,0.96)' : 'rgba(255,255,255,0.98)'
    const nodeShellBorder = isDarkUi
      ? '1px solid rgba(255,255,255,0.06)'
      : '1px solid rgba(17,18,21,0.08)'
    const nodeShellShadow = isDarkUi
      ? '0 18px 36px rgba(0, 0, 0, 0.5)'
      : '0 16px 32px rgba(17, 18, 21, 0.12)'
    const nodeShellGlow = '0 0 0 rgba(0, 0, 0, 0)'
    const nodeShellText = isDarkUi ? theme.white : (theme.colors.gray?.[9] || '#131316')
    const quickActionBackgroundActive = isDarkUi ? rgba(accentPrimary, 0.25) : rgba(accentPrimary, 0.12)
    const quickActionIconColor = rgba(nodeShellText, 0.55)
    const quickActionIconActive = accentPrimary
    const quickActionHint = rgba(nodeShellText, 0.55)
    const mediaOverlayBackground = isDarkUi ? 'rgba(4, 7, 16, 0.92)' : 'rgba(246, 248, 255, 0.95)'
    const mediaOverlayText = nodeShellText
    const toolbarBackground = isDarkUi ? 'rgba(4, 7, 16, 0.97)' : 'rgba(255,255,255,0.98)'
    const toolbarShadow = isDarkUi
      ? '0 22px 45px rgba(0,0,0,0.6)'
      : '0 22px 50px rgba(17,18,21,0.14)'
    const subtleOverlayBackground = isDarkUi ? 'rgba(255,255,255,0.04)' : 'rgba(17,18,21,0.05)'
    const mediaFallbackSurface = isDarkUi ? 'rgba(3,6,12,0.92)' : 'rgba(244,247,255,0.95)'
    const mediaFallbackText = isDarkUi
      ? rgba(theme.colors.gray?.[4] || '#84878d', 0.85)
      : rgba(theme.colors.gray?.[6] || '#585b60', 0.85)
    const videoSurface = isDarkUi ? 'rgba(11, 16, 28, 0.9)' : 'rgba(236, 241, 255, 0.9)'
    const inlineDividerColor = rgba(nodeShellText, 0.12)
    const sleekChipBorderColor = rgba(nodeShellText, 0.08)
    const toolbarButtonBorderColor = rgba(nodeShellText, 0.12)
    const galleryCardBackground = isDarkUi ? 'rgba(7,12,24,0.96)' : 'rgba(255,255,255,0.96)'
    const placeholderIconColor = nodeShellText
    const iconBadgeBackground = isDarkUi ? rgba(accentPrimary, 0.2) : rgba(accentPrimary, 0.12)
    const iconBadgeShadow = isDarkUi
      ? '0 10px 20px rgba(0,0,0,0.35)'
      : '0 10px 20px rgba(17,18,21,0.1)'
    const darkContentBackground = isDarkUi ? 'rgba(9,13,20,0.92)' : 'rgba(246,248,255,0.95)'
    const darkCardShadow = isDarkUi
      ? '0 12px 24px rgba(0, 0, 0, 0.4)'
      : '0 12px 24px rgba(17, 18, 21, 0.1)'
    const lightContentBackground = isDarkUi ? 'rgba(9,14,28,0.3)' : 'rgba(227,235,255,0.7)'

    const summaryChipStyles: React.CSSProperties = {
      borderRadius: 999,
      background: isDarkUi ? 'rgba(255,255,255,0.04)' : 'rgba(17,18,21,0.04)',
      color: nodeShellText,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      fontWeight: 600,
      fontSize: 12,
      height: 30,
      lineHeight: 1.1,
      letterSpacing: 0.25,
    }
    const controlValueStyle: React.CSSProperties = {
      fontSize: 12,
      fontWeight: 600,
      color: nodeShellText,
    }
    const sleekChipBase: React.CSSProperties = {
      padding: '6px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      fontWeight: 500,
      color: nodeShellText,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      borderRadius: 999,
      background: isDarkUi ? 'rgba(255,255,255,0.03)' : 'rgba(17,18,21,0.03)',
    }
    const toolbarActionIconStyles = {
      root: {
        width: 36,
        height: 36,
        borderRadius: 12,
        background: 'transparent',
        color: nodeShellText,
        padding: 0,
      } as React.CSSProperties,
      icon: {
        fontSize: 16,
      } as React.CSSProperties,
    }

    return {
      isDarkUi,
      themeWhite: theme.white,
      rgba,
      accentPrimary,
      accentSecondary,
      nodeShellBackground,
      nodeShellBorder,
      nodeShellShadow,
      nodeShellGlow,
      nodeShellText,
      quickActionBackgroundActive,
      quickActionIconColor,
      quickActionIconActive,
      quickActionHint,
      mediaOverlayBackground,
      mediaOverlayText,
      toolbarBackground,
      toolbarShadow,
      subtleOverlayBackground,
      mediaFallbackSurface,
      mediaFallbackText,
      videoSurface,
      inlineDividerColor,
      sleekChipBorderColor,
      toolbarButtonBorderColor,
      galleryCardBackground,
      placeholderIconColor,
      iconBadgeBackground,
      iconBadgeShadow,
      darkContentBackground,
      darkCardShadow,
      lightContentBackground,
      summaryChipStyles,
      controlValueStyle,
      sleekChipBase,
      toolbarActionIconStyles,
    }
  }, [isDarkUi, theme])
}

import { createTheme, type MantineColorScheme } from '@mantine/core'

export const tapCanvasDesignTokens = {
  radius: {
    sharp: '0px',
    field: '6px',
    panel: '10px',
    modal: '14px',
    pill: '999px'
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px'
  },
  fontSize: {
    micro: '11px',
    caption: '12px',
    bodySm: '13px',
    body: '14px',
    title: '16px',
    h2: '20px',
    h1: '24px'
  },
  lineHeight: {
    micro: '14px',
    caption: '16px',
    bodySm: '18px',
    body: '20px',
    title: '22px',
    h2: '26px',
    h1: '30px'
  },
  shadow: {
    subtle: '0 10px 24px rgba(0, 0, 0, 0.18)',
    panel: '0 18px 40px rgba(0, 0, 0, 0.28)',
    modal: '0 28px 64px rgba(0, 0, 0, 0.4)'
  },
  dark: {
    appBg: '#05070b',
    appBgStrong: '#020409',
    surface: '#0b0f14',
    surfaceRaised: '#10161d',
    surfaceSubtle: '#131a22',
    surfaceInline: 'rgba(255, 255, 255, 0.035)',
    borderSubtle: 'rgba(226, 232, 240, 0.08)',
    borderStrong: 'rgba(125, 211, 252, 0.24)',
    textPrimary: '#edf3ff',
    textSecondary: '#aab7ca',
    textTertiary: '#73839a',
    accentBlue: '#60a5fa',
    accentCyan: '#22d3ee',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
    info: '#38bdf8'
  }
} as const

const sansSerifFontFamily = [
  'Inter',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'sans-serif'
].join(', ')

const monospaceFontFamily = [
  'ui-monospace',
  '"SFMono-Regular"',
  'Menlo',
  'Monaco',
  'Consolas',
  'monospace'
].join(', ')

export function buildTapCanvasTheme(colorScheme: MantineColorScheme) {
  const isDark = colorScheme === 'dark'

  return createTheme({
    focusRing: 'auto',
    cursorType: 'pointer',
    defaultRadius: 'xs',
    primaryColor: isDark ? 'gray' : 'dark',
    primaryShade: { light: 6, dark: 4 },
    fontFamily: sansSerifFontFamily,
    fontFamilyMonospace: monospaceFontFamily,
    radius: {
      xs: tapCanvasDesignTokens.radius.field,
      sm: tapCanvasDesignTokens.radius.panel,
      md: tapCanvasDesignTokens.radius.modal,
      lg: tapCanvasDesignTokens.radius.modal,
      xl: tapCanvasDesignTokens.radius.modal
    },
    spacing: {
      xs: tapCanvasDesignTokens.spacing[2],
      sm: tapCanvasDesignTokens.spacing[3],
      md: tapCanvasDesignTokens.spacing[4],
      lg: tapCanvasDesignTokens.spacing[5],
      xl: tapCanvasDesignTokens.spacing[6]
    },
    fontSizes: {
      xs: tapCanvasDesignTokens.fontSize.micro,
      sm: tapCanvasDesignTokens.fontSize.caption,
      md: tapCanvasDesignTokens.fontSize.bodySm,
      lg: tapCanvasDesignTokens.fontSize.body,
      xl: tapCanvasDesignTokens.fontSize.title
    },
    lineHeights: {
      xs: tapCanvasDesignTokens.lineHeight.micro,
      sm: tapCanvasDesignTokens.lineHeight.caption,
      md: tapCanvasDesignTokens.lineHeight.bodySm,
      lg: tapCanvasDesignTokens.lineHeight.body,
      xl: tapCanvasDesignTokens.lineHeight.title
    },
    headings: {
      fontFamily: sansSerifFontFamily,
      fontWeight: '700',
      textWrap: 'balance',
      sizes: {
        h1: {
          fontSize: tapCanvasDesignTokens.fontSize.h1,
          lineHeight: tapCanvasDesignTokens.lineHeight.h1
        },
        h2: {
          fontSize: tapCanvasDesignTokens.fontSize.h2,
          lineHeight: tapCanvasDesignTokens.lineHeight.h2,
          fontWeight: '650'
        },
        h3: {
          fontSize: tapCanvasDesignTokens.fontSize.title,
          lineHeight: tapCanvasDesignTokens.lineHeight.title,
          fontWeight: '650'
        },
        h4: {
          fontSize: tapCanvasDesignTokens.fontSize.body,
          lineHeight: tapCanvasDesignTokens.lineHeight.body,
          fontWeight: '650'
        },
        h5: {
          fontSize: tapCanvasDesignTokens.fontSize.bodySm,
          lineHeight: tapCanvasDesignTokens.lineHeight.bodySm,
          fontWeight: '600'
        },
        h6: {
          fontSize: tapCanvasDesignTokens.fontSize.caption,
          lineHeight: tapCanvasDesignTokens.lineHeight.caption,
          fontWeight: '600'
        }
      }
    },
    shadows: {
      xs: tapCanvasDesignTokens.shadow.subtle,
      sm: tapCanvasDesignTokens.shadow.subtle,
      md: tapCanvasDesignTokens.shadow.panel,
      lg: tapCanvasDesignTokens.shadow.modal,
      xl: tapCanvasDesignTokens.shadow.modal
    },
    other: {
      design: tapCanvasDesignTokens
    },
    components: {
      Button: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        },
        styles: {
          root: {
            fontWeight: 600,
            letterSpacing: '0.01em'
          }
        }
      },
      ActionIcon: {
        defaultProps: {
          radius: 'xs',
          size: 'md',
          variant: 'subtle'
        }
      },
      TextInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      PasswordInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      NumberInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      Textarea: {
        defaultProps: {
          radius: 'xs',
          size: 'sm',
          autosize: true,
          minRows: 3
        }
      },
      Select: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      MultiSelect: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      Card: {
        defaultProps: {
          radius: 'sm',
          padding: 'md'
        },
        styles: {
          root: isDark ? {
            backgroundColor: tapCanvasDesignTokens.dark.surface,
            borderColor: tapCanvasDesignTokens.dark.borderSubtle,
            boxShadow: tapCanvasDesignTokens.shadow.panel,
          } : undefined
        }
      },
      Paper: {
        defaultProps: {
          radius: 'sm'
        },
        styles: {
          root: isDark ? {
            backgroundColor: tapCanvasDesignTokens.dark.surface,
            borderColor: tapCanvasDesignTokens.dark.borderSubtle,
          } : undefined
        }
      },
      Modal: {
        defaultProps: {
          radius: 'md',
          shadow: 'lg'
        },
        styles: {
          content: isDark ? {
            backgroundColor: tapCanvasDesignTokens.dark.surface,
            border: `1px solid ${tapCanvasDesignTokens.dark.borderSubtle}`,
          } : undefined,
          header: isDark ? {
            backgroundColor: tapCanvasDesignTokens.dark.surface,
          } : undefined
        }
      },
      Drawer: {
        defaultProps: {
          radius: 'sm',
          shadow: 'lg'
        }
      },
      Menu: {
        defaultProps: {
          radius: 'sm',
          shadow: 'md'
        }
      },
      Popover: {
        defaultProps: {
          radius: 'sm',
          shadow: 'md'
        },
        styles: {
          dropdown: isDark ? {
            backgroundColor: tapCanvasDesignTokens.dark.surfaceRaised,
            borderColor: tapCanvasDesignTokens.dark.borderSubtle,
          } : undefined
        }
      },
      Tabs: {
        defaultProps: {
          radius: 'sm'
        }
      },
      Badge: {
        defaultProps: {
          radius: 999
        },
        styles: {
          root: {
            fontWeight: 600,
            letterSpacing: '0.02em'
          }
        }
      },
      Tooltip: {
        defaultProps: {
          openDelay: 140
        },
        styles: {
          tooltip: isDark ? {
            backgroundColor: tapCanvasDesignTokens.dark.surfaceRaised,
            border: `1px solid ${tapCanvasDesignTokens.dark.borderSubtle}`,
            color: tapCanvasDesignTokens.dark.textPrimary,
          } : undefined
        }
      }
    }
  })
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { MantineProvider, MantineThemeProvider, localStorageColorSchemeManager, useMantineColorScheme, createTheme, type MantineColorScheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './dark.css'
import './light.css'
import { installAuth401Interceptor } from './auth/fetch401Interceptor'

const COLOR_SCHEME_STORAGE_KEY = 'tapcanvas-color-scheme'
const DEFAULT_COLOR_SCHEME: MantineColorScheme = 'dark'
const colorSchemeManager = localStorageColorSchemeManager({ key: COLOR_SCHEME_STORAGE_KEY })

function primeColorSchemeAttribute() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  try {
    const stored = colorSchemeManager.get(DEFAULT_COLOR_SCHEME)
    const prefersDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    const computed = stored === 'auto' ? (prefersDark ? 'dark' : 'light') : stored
    document.documentElement.setAttribute('data-mantine-color-scheme', computed)
  } catch {
    document.documentElement.setAttribute('data-mantine-color-scheme', DEFAULT_COLOR_SCHEME)
  }
}

primeColorSchemeAttribute()
installAuth401Interceptor()

const baseTheme = {
  defaultRadius: 'sm',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji'
}

function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useMantineColorScheme()
  const theme = React.useMemo(() => createTheme({
    ...baseTheme,
    primaryColor: colorScheme === 'dark' ? 'gray' : 'dark',
    primaryShade: { light: 6, dark: 4 }
  }), [colorScheme])

  return <MantineThemeProvider theme={theme}>{children}</MantineThemeProvider>
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')
const root = createRoot(container)

root.render(
  <React.StrictMode>
    <MantineProvider colorSchemeManager={colorSchemeManager} defaultColorScheme={DEFAULT_COLOR_SCHEME}>
      <DynamicThemeProvider>
        <Notifications position="top-right" zIndex={2000} />
        <App />
      </DynamicThemeProvider>
    </MantineProvider>
  </React.StrictMode>
)

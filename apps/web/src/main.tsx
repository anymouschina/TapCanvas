import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { MantineProvider, localStorageColorSchemeManager, useMantineColorScheme, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './dark.css'
import './light.css'

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

  return (
    <MantineProvider theme={theme}>
      {children}
    </MantineProvider>
  )
}

const colorSchemeManager = localStorageColorSchemeManager({ key: 'tapcanvas-color-scheme' })

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')
const root = createRoot(container)

root.render(
  <React.StrictMode>
    <MantineProvider colorSchemeManager={colorSchemeManager} defaultColorScheme="dark">
      <DynamicThemeProvider>
        <Notifications position="top-right" zIndex={2000} />
        <App />
      </DynamicThemeProvider>
    </MantineProvider>
  </React.StrictMode>
)

import React from 'react'
import { MantineProvider, MantineThemeProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/code-highlight/styles.css'
import '../dark.css'
import { buildTapCanvasTheme } from '../theme/tapCanvasTheme'

const darkTheme = buildTapCanvasTheme('dark')

type MantineRuntimeProviderProps = {
  children: React.ReactNode
}

export function MantineRuntimeProvider({ children }: MantineRuntimeProviderProps): JSX.Element {
  return (
    <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
      <MantineThemeProvider theme={darkTheme}>
        <ModalsProvider>
          <Notifications className="tc-mantine-runtime__notifications" position="top-right" zIndex={12_000} />
          {children}
        </ModalsProvider>
      </MantineThemeProvider>
    </MantineProvider>
  )
}

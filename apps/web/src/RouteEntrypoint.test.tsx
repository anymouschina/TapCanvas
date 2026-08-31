// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RouteEntrypoint from './RouteEntrypoint'

vi.mock('./utils/mediaPlayback', () => ({
	installPageMediaLifecycle: () => () => undefined,
}))

vi.mock('./portal/portalRouteModules', async () => {
	const ReactModule = await import('react')
	const { useMantineTheme } = await import('@mantine/core')
	const MantineContextProbe = (): React.ReactElement => {
		useMantineTheme()
		return ReactModule.createElement('div', { className: 'mantine-context-probe' }, 'mantine-context-ready')
	}
	const loadProbe = async () => ({ default: MantineContextProbe })
	return {
		loadCanvasHubPage: loadProbe,
		loadNeoHomePage: loadProbe,
		loadNeoTvPage: loadProbe,
		loadSkillPortalPage: loadProbe,
		loadPromptLibraryPage: loadProbe,
		loadPromptDetailPage: loadProbe,
	}
})

Object.defineProperty(window, 'matchMedia', {
	configurable: true,
	value: vi.fn((query: string): MediaQueryList => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(() => false),
	})),
})

describe('RouteEntrypoint', () => {
	beforeEach(() => window.history.replaceState({}, '', '/neo-tv'))
	afterEach(() => cleanup())

	it('provides Mantine context to portal routes', async () => {
		render(React.createElement(RouteEntrypoint))

		expect(await screen.findByText('mantine-context-ready', {}, { timeout: 10_000 })).not.toBeNull()
	}, 15_000)
})

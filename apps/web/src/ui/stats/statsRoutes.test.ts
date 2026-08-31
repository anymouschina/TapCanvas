import { describe, expect, it } from 'vitest'
import { getPathnameForStatsSection, parseStatsSectionFromPathname } from './statsRoutes'

describe('stats route contract', () => {
  it('keeps only the three supported admin sections directly addressable', () => {
    expect(parseStatsSectionFromPathname('/stats')).toBe('overview')
    expect(parseStatsSectionFromPathname('/stats/users')).toBe('users')
    expect(parseStatsSectionFromPathname('/stats/task-logs')).toBe('task-logs')
  })

  it('maps removed and unknown pages to overview without compatibility aliases', () => {
    expect(parseStatsSectionFromPathname('/stats/system')).toBe('overview')
    expect(parseStatsSectionFromPathname('/stats/homepage')).toBe('overview')
    expect(parseStatsSectionFromPathname('/stats/model-credits')).toBe('overview')
    expect(parseStatsSectionFromPathname('/stats/not-a-section')).toBe('overview')
  })

  it('builds canonical section URLs', () => {
    expect(getPathnameForStatsSection('overview')).toBe('/stats')
    expect(getPathnameForStatsSection('users')).toBe('/stats/users')
    expect(getPathnameForStatsSection('task-logs')).toBe('/stats/task-logs')
  })
})

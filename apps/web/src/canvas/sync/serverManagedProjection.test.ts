import { describe, expect, it } from 'vitest'

import { isServerManagedProjectionData } from './serverManagedProjection'

describe('isServerManagedProjectionData', () => {
  it('recognizes only the canonical server-owned video run projection', () => {
    expect(isServerManagedProjectionData({ managedProjection: 'video_run_status' })).toBe(true)
    expect(isServerManagedProjectionData({ managedProjection: 'invented' })).toBe(false)
    expect(isServerManagedProjectionData(null)).toBe(false)
  })
})

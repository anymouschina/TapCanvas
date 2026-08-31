import { describe, expect, it } from 'vitest'
import {
  buildPublicCreativeProcessPath,
  resolvePublicCreativeProcessProjectId,
} from './publicCreativeProcess'

describe('publicCreativeProcess', () => {
  it('uses the published source project when its canvas is public', () => {
    const asset = {
      canvasPublic: true,
      sourceProjectId: ' source-project ',
      projectId: 'snapshot-project',
    }

    expect(resolvePublicCreativeProcessProjectId(asset)).toBe('source-project')
    expect(buildPublicCreativeProcessPath(asset)).toBe('/share/source-project')
  })

  it('uses the attached project when no source project is recorded', () => {
    expect(buildPublicCreativeProcessPath({
      canvasPublic: true,
      sourceProjectId: null,
      projectId: 'project/with spaces',
    })).toBe('/share/project%2Fwith%20spaces')
  })

  it('does not expose a private canvas', () => {
    expect(buildPublicCreativeProcessPath({
      canvasPublic: false,
      sourceProjectId: 'private-project',
      projectId: null,
    })).toBeNull()
  })

  it('requires a real project id', () => {
    expect(buildPublicCreativeProcessPath({
      canvasPublic: true,
      sourceProjectId: '  ',
      projectId: null,
    })).toBeNull()
  })

  it('opens the complete project when the published work originated from a chapter', () => {
    expect(buildPublicCreativeProcessPath({
      canvasPublic: true,
      sourceProjectId: 'project-1',
      projectId: null,
    })).toBe('/share/project-1')
  })
})

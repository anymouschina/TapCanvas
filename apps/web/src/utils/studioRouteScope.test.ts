import { describe, expect, it } from 'vitest'
import { parseStudioRouteScope, selectStudioProject } from './studioRouteScope'

describe('parseStudioRouteScope', () => {
  it('accepts an unbound Studio route', () => {
    expect(parseStudioRouteScope('http://localhost:5175/studio')).toEqual({
      ok: true,
      scope: { projectId: null, ownerType: null, ownerId: null, flowId: null },
    })
  })

  it('accepts a complete project scope', () => {
    expect(parseStudioRouteScope(
      'http://localhost:5175/studio?projectId=project-a&ownerType=project&ownerId=project-a&flowId=flow-a',
    )).toEqual({
      ok: true,
      scope: { projectId: 'project-a', ownerType: 'project', ownerId: 'project-a', flowId: 'flow-a' },
    })
  })

  it('rejects a project and owner mismatch instead of mixing their data', () => {
    expect(parseStudioRouteScope(
      'http://localhost:5175/studio?projectId=project-a&ownerType=project&ownerId=project-b',
    )).toMatchObject({ ok: false, code: 'project_owner_mismatch' })
  })

  it('rejects partial owner scope', () => {
    expect(parseStudioRouteScope(
      'http://localhost:5175/studio?projectId=project-a&ownerType=chapter',
    )).toMatchObject({ ok: false, code: 'incomplete_owner_scope' })
  })

  it('rejects a flow without its owner scope', () => {
    expect(parseStudioRouteScope(
      'http://localhost:5175/studio?projectId=project-a&flowId=flow-a',
    )).toMatchObject({ ok: false, code: 'owner_scope_required_for_flow' })
  })
})

describe('selectStudioProject', () => {
  const projects = [
    { id: 'newest-project', name: 'newest' },
    { id: 'requested-project', name: 'requested' },
  ]

  it('selects only the project named by the route, not the first project', () => {
    expect(selectStudioProject(projects, 'requested-project')).toEqual({
      kind: 'selected',
      project: projects[1],
    })
  })

  it('reports a missing explicit project instead of falling back', () => {
    expect(selectStudioProject(projects, 'missing-project')).toEqual({
      kind: 'missing',
      projectId: 'missing-project',
    })
  })

  it('keeps an unbound Studio route unbound', () => {
    expect(selectStudioProject(projects, null)).toEqual({ kind: 'unbound' })
  })
})

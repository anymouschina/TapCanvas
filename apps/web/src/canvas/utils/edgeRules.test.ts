import { describe, expect, it } from 'vitest'
import {
  createTaskNodeInitialData,
  getTaskNodeSchema,
  listTaskNodeSchemas,
} from '../nodes/taskNodeSchema'
import { buildEdgeValidator } from './edgeRules'

describe('buildEdgeValidator', () => {
  const isValidEdge = buildEdgeValidator()

  it('allows video outputs to create every supported video consumer', () => {
    expect(isValidEdge('video', 'video')).toBe(true)
    expect(isValidEdge('video', 'videoCompose')).toBe(true)
    expect(isValidEdge('video', 'videoAnalysis')).toBe(true)
    expect(isValidEdge('videoCompose', 'videoAnalysis')).toBe(true)

    expect(
      listTaskNodeSchemas()
        .filter((schema) => isValidEdge('video', schema.kind))
        .map((schema) => schema.kind),
    ).toEqual(['video', 'videoCompose', 'videoAnalysis'])
  })

  it('does not widen video output compatibility to unrelated text nodes', () => {
    expect(isValidEdge('video', 'shotTable')).toBe(false)
    expect(isValidEdge('video', 'text')).toBe(false)
    expect(isValidEdge('audio', 'videoAnalysis')).toBe(false)
  })

  it('keeps the inserted video analysis node executable', () => {
    expect(getTaskNodeSchema('videoAnalysis').handles).toMatchObject({
      targets: [{ id: 'in-video', type: 'video' }],
    })
    expect(createTaskNodeInitialData('videoAnalysis')).toMatchObject({
      videoAnalysisFps: 1,
      videoAnalysisFocus: '',
      videoAnalysisRuns: [],
      videoAnalysisUndeliveredResults: [],
      status: 'idle',
    })
  })

  it('isolates admin workflow-stage edges from creative asset edges', () => {
    expect(isValidEdge('workflowStage', 'workflowStage')).toBe(true)
    expect(isValidEdge('workflowTrigger', 'workflowStage')).toBe(true)
    expect(isValidEdge('workflowStage', 'workflowTrigger')).toBe(false)
    expect(isValidEdge('workflowStage', 'text')).toBe(false)
    expect(isValidEdge('video', 'workflowStage')).toBe(false)
    expect(getTaskNodeSchema('workflowStage').handles).toMatchObject({
      targets: [{ id: 'in-workflow', type: 'workflow' }],
      sources: [{ id: 'out-workflow', type: 'workflow' }],
    })
  })
})

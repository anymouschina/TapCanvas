import { describe, expect, it } from 'vitest'
import {
  parseVideoRunStatusEvent,
  parseVideoRunStatusSnapshot,
  VIDEO_RUN_STATUS_PROTOCOL_VERSION,
} from '@tapcanvas/video-orchestrator-protocol'

const validEvent = {
  protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
  runId: 'run-1',
  flowId: 'flow-1',
  state: 'collecting',
  totalClips: 1,
  clipsDone: 0,
  errorMessage: null,
  completedAt: null,
  authoringState: 'assets_ready',
  authoringClipsReady: 1,
  authoringTotalClips: 1,
  chapterId: null,
  chapterTitle: null,
  updatedAt: '2026-08-03T05:31:00.433Z',
} as const

describe('video orchestrator protocol', () => {
  it('parses the versioned canonical SSE event', () => {
    expect(parseVideoRunStatusEvent(validEvent)).toEqual({ success: true, data: validEvent })
  })

  it('rejects an unversioned legacy event', () => {
    const { protocolVersion: _removed, ...legacyEvent } = validEvent
    expect(parseVideoRunStatusEvent(legacyEvent)).toEqual({
      success: false,
      error: { message: 'protocolVersion must equal 2' },
    })
  })

  it('rejects unknown state aliases instead of normalizing them', () => {
    const result = parseVideoRunStatusEvent({ ...validEvent, state: 'storyboard_ready' })
    expect(result).toEqual({ success: false, error: { message: 'state is not canonical' } })
  })

  it('parses one authoritative active-set snapshot with a persisted watermark', () => {
    const snapshot = {
      protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
      scopeType: 'project',
      scopeId: 'project-1',
      generatedAt: '2026-08-03T05:31:01.000Z',
      watermarkUpdatedAt: '2026-08-03T05:31:00.433Z',
      runs: [validEvent],
    } as const
    expect(parseVideoRunStatusSnapshot(snapshot)).toEqual({ success: true, data: snapshot })
  })

  it('rejects a snapshot without the ordering watermark field', () => {
    expect(parseVideoRunStatusSnapshot({
      protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
      scopeType: 'project',
      scopeId: 'project-1',
      generatedAt: '2026-08-03T05:31:01.000Z',
      runs: [],
    })).toEqual({
      success: false,
      error: { message: 'watermarkUpdatedAt must be an ISO timestamp or null' },
    })
  })
})

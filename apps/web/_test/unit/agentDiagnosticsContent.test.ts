import { describe, expect, it } from 'vitest'
import { getCanvasPlanTimelineStatus } from '../../src/ui/AgentDiagnosticsContent'

describe('agent diagnostics canvas plan status', () => {
  it('marks parsed canvas plan as parsed', () => {
    expect(
      getCanvasPlanTimelineStatus({
        parseSuccess: true,
        reason: '',
        summary: '',
      }),
    ).toBe('parsed')
  })

  it('marks text-only answers without canvas plan as info instead of invalid', () => {
    expect(
      getCanvasPlanTimelineStatus({
        parseSuccess: false,
        reason: 'not_applicable_text_only',
        summary: 'plain_text_answer_without_canvas_plan',
      }),
    ).toBe('info')
  })

  it('keeps malformed canvas plans as invalid', () => {
    expect(
      getCanvasPlanTimelineStatus({
        parseSuccess: false,
        reason: '',
        summary: '',
      }),
    ).toBe('invalid')
  })
})

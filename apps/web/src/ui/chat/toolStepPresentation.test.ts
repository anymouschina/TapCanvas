import { describe, expect, it } from 'vitest'

import {
  buildAgentContinuationSummary,
  buildToolProgressSummary,
  buildToolStepSummary,
  readPresentedToolName,
  resolvePresentedToolName,
} from './toolStepPresentation'

describe('tool step presentation', () => {
  it('shows the concrete TapCanvas business tool behind tapcanvas_call_tool', () => {
    expect(resolvePresentedToolName('tapcanvas_call_tool', {
      name: 'tapcanvas_image_generate_to_canvas',
      args: { nodes: [] },
    })).toBe('tapcanvas_image_generate_to_canvas')
  })

  it('keeps the wrapper name when its structured input has no business tool name', () => {
    expect(resolvePresentedToolName('tapcanvas_call_tool', null)).toBe('tapcanvas_call_tool')
  })

  it('reads structured tool identities without rendering an object as [object Object]', () => {
    expect(readPresentedToolName({ name: 'tapcanvas_video_orchestrate' })).toBe('tapcanvas_video_orchestrate')
    expect(resolvePresentedToolName({ toolName: 'tapcanvas_call_tool' }, {
      name: 'tapcanvas_flow_get',
    })).toBe('tapcanvas_flow_get')
    expect(readPresentedToolName({ name: { nested: true } })).toBe('')
    expect(resolvePresentedToolName({ name: { nested: true } }, null)).toBe('tool')
  })

  it('summarizes a collapsed active run with the concrete current tool', () => {
    expect(buildToolStepSummary({
      totalCount: 31,
      currentToolLabel: '生成图片到画布',
      failedCount: 0,
      active: true,
    })).toBe('正在执行 · 生成图片到画布')
  })

  it('keeps completed and failed tool traces inside a compact execution-detail summary', () => {
    expect(buildToolStepSummary({
      totalCount: 5,
      currentToolLabel: '生成图片到画布',
      failedCount: 1,
      active: false,
    })).toBe('执行详情 · 5 次调用 · 1 次异常')
    expect(buildToolStepSummary({
      totalCount: 3,
      currentToolLabel: null,
      failedCount: 0,
      active: false,
    })).toBe('执行详情 · 3 次调用')
  })

  it('does not present an action-level failure as a terminal chat failure', () => {
    expect(buildToolProgressSummary({
      label: '核验交付结果',
      phase: 'completed',
      status: 'failed',
    })).toBe('核验交付结果未完成，正在确认后续处理')
  })

  it('replaces stale failed-tool copy when agents-cli starts a continuation', () => {
    expect(buildAgentContinuationSummary('failed')).toBe('正在调整处理方式并继续完成请求')
    expect(buildAgentContinuationSummary('denied')).toBe('正在调整处理方式并继续完成请求')
    expect(buildAgentContinuationSummary('succeeded')).toBe('正在继续处理你的请求')
    expect(buildAgentContinuationSummary(undefined)).toBe('正在继续处理你的请求')
  })
})

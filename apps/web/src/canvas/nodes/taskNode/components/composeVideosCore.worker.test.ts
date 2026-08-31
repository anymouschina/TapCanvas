// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeVideosToBlob, type ComposeWorkerOutbound } from './composeVideosCore'

class SuccessfulComposeWorker {
  onmessage: ((event: MessageEvent<ComposeWorkerOutbound>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null

  postMessage(): void {
    queueMicrotask(() => {
      this.onmessage?.(new MessageEvent<ComposeWorkerOutbound>('message', {
        data: { type: 'phase', value: 'loading_media' },
      }))
      this.onmessage?.(new MessageEvent<ComposeWorkerOutbound>('message', {
        data: { type: 'done', blob: new Blob(['video'], { type: 'video/mp4' }) },
      }))
    })
  }

  terminate(): void {}
}

class InvalidMessageComposeWorker extends SuccessfulComposeWorker {
  override postMessage(): void {
    queueMicrotask(() => this.onmessageerror?.())
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('composeVideosToBlob worker lifecycle', () => {
  it('reports preparation and worker phases before returning the result', async () => {
    vi.stubGlobal('Worker', SuccessfulComposeWorker)
    const phases: string[] = []

    const blob = await composeVideosToBlob(
      [{ url: 'https://example.com/a.mp4' }, { url: 'https://example.com/a.mp4' }],
      { onPhase: (phase) => phases.push(phase) },
    )

    expect(phases).toEqual(['preparing', 'loading_media'])
    expect(blob.type).toBe('video/mp4')
  })

  it('fails explicitly when the worker response cannot be deserialized', async () => {
    vi.stubGlobal('Worker', InvalidMessageComposeWorker)

    await expect(composeVideosToBlob([
      { url: 'https://example.com/a.mp4' },
      { url: 'https://example.com/a.mp4' },
    ])).rejects.toThrow('视频合成 Worker 响应无法解析')
  })
})

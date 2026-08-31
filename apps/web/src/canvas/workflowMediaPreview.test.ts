import { describe, expect, it } from 'vitest'
import {
  resolveWorkflowMediaPreview,
  workflowMediaDisplayMode,
  workflowMediaKind,
} from './workflowMediaPreview'

describe('workflow media preview', () => {
  it('recognizes media only from the explicit atomic operation contract', () => {
    expect(workflowMediaKind({ label: '图片生成', kind: 'workflowStage' })).toBeNull()
    expect(workflowMediaKind({ workflowAtomicSpec: { operation: 'image_generate' } })).toBe('image')
    expect(workflowMediaKind({ workflowAtomicSpec: { operation: 'video_generate' } })).toBe('video')
  })

  it('defaults to icon mode and accepts only the persisted result mode literal', () => {
    expect(workflowMediaDisplayMode({})).toBe('icon')
    expect(workflowMediaDisplayMode({ workflowCanvasDisplayMode: 'preview' })).toBe('icon')
    expect(workflowMediaDisplayMode({ workflowCanvasDisplayMode: 'result' })).toBe('result')
  })

  it('reads and deduplicates real image artifacts while rejecting non-http values', () => {
    const preview = resolveWorkflowMediaPreview({
      workflowAtomicSpec: { operation: 'image_generate' },
      workflowCanvasDisplayMode: 'result',
      workflowOutputArtifacts: [
        { type: 'tapcanvas.image/v1', identity: 'image-1', value: 'https://cdn.example.com/image-1.webp' },
        { type: 'tapcanvas.image/v1', identity: 'invalid', value: 'data:image/png;base64,AAAA' },
        { type: 'tapcanvas.video/v1', identity: 'wrong-kind', value: 'https://cdn.example.com/video.mp4' },
      ],
      workflowExecutionEvidence: { imageUrl: 'https://cdn.example.com/image-1.webp' },
    })

    expect(preview).toEqual({
      kind: 'image',
      displayMode: 'result',
      assets: [{ kind: 'image', url: 'https://cdn.example.com/image-1.webp', thumbnailUrl: null }],
      primaryAsset: { kind: 'image', url: 'https://cdn.example.com/image-1.webp', thumbnailUrl: null },
    })
  })

  it('keeps item order and merges a real video thumbnail into its matching artifact', () => {
    const preview = resolveWorkflowMediaPreview({
      workflowAtomicSpec: { operation: 'video_generate' },
      workflowItemRuns: [
        {
          artifacts: [{
            type: 'tapcanvas.video/v1',
            identity: 'video-1',
            value: 'https://cdn.example.com/video-1.mp4',
          }],
          evidence: {
            videoUrl: 'https://cdn.example.com/video-1.mp4',
            thumbnailUrl: 'https://cdn.example.com/video-1.webp',
          },
        },
        {
          evidence: { videoUrl: 'https://cdn.example.com/video-2.mp4' },
        },
      ],
    })

    expect(preview.assets).toEqual([
      {
        kind: 'video',
        url: 'https://cdn.example.com/video-1.mp4',
        thumbnailUrl: 'https://cdn.example.com/video-1.webp',
      },
      {
        kind: 'video',
        url: 'https://cdn.example.com/video-2.mp4',
        thumbnailUrl: null,
      },
    ])
    expect(preview.primaryAsset?.url).toBe('https://cdn.example.com/video-2.mp4')
  })

  it('reads typed media URLs nested inside real runtime ports', () => {
    const preview = resolveWorkflowMediaPreview({
      workflowAtomicSpec: { operation: 'image_generate' },
      workflowLocalTestOutput: {
        images: {
          protocolVersion: 'workflow.collection/v1',
          items: [
            { value: { imageUrl: 'https://cdn.example.com/a.webp' } },
            { value: { imageUrl: 'https://cdn.example.com/b.webp' } },
          ],
        },
      },
    })

    expect(preview.assets.map((asset) => asset.url)).toEqual([
      'https://cdn.example.com/a.webp',
      'https://cdn.example.com/b.webp',
    ])
    expect(preview.primaryAsset?.url).toBe('https://cdn.example.com/b.webp')
  })
})

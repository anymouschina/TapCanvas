import { describe, expect, it, vi } from 'vitest'
import type { PromptLibraryCard } from '../api/promptLibrary'
import { buildPromptLibraryCanvasNode, createPromptLibraryProject, PromptLibraryCanvasSaveError } from './promptLibraryProject'

function entry(kind: 'image' | 'video'): PromptLibraryCard {
  return {
    id: `entry-${kind}`,
    title: `${kind} 项目`,
    description: null,
    promptText: `${kind} prompt`,
    mediaType: kind,
    authorLabel: '搜集自网络',
    publishedAt: null,
    models: [{ slug: kind === 'image' ? 'gpt-image-2' : 'seedance-2-5', name: '模型' }],
    media: [{
      id: `media-${kind}`,
      kind,
      url: `https://assets.example.com/${kind}.${kind === 'image' ? 'jpg' : 'mp4'}`,
      thumbnailUrl: kind === 'video' ? 'https://assets.example.com/poster.jpg' : null,
      width: 1920,
      height: 1080,
      order: 0,
    }],
  }
}

describe('prompt library project creation', () => {
  it('builds an already-resolved image or video canvas node from the source card', () => {
    const imageNode = buildPromptLibraryCanvasNode(entry('image'))
    const videoNode = buildPromptLibraryCanvasNode(entry('video'))

    expect(imageNode.data).toMatchObject({
      kind: 'image',
      prompt: 'image prompt',
      imageUrl: 'https://assets.example.com/image.jpg',
      imageResults: [{ url: 'https://assets.example.com/image.jpg', title: 'image 项目' }],
      aspectRatio: '1920:1080',
      status: 'success',
    })
    expect(videoNode.data).toMatchObject({
      kind: 'video',
      prompt: 'video prompt',
      videoUrl: 'https://assets.example.com/video.mp4',
      videoThumbnailUrl: 'https://assets.example.com/poster.jpg',
      status: 'success',
    })
  })

  it('creates the project, persists the canvas and returns both identifiers', async () => {
    const bootstrapProject = vi.fn().mockResolvedValue({
      status: 'complete',
      project: { id: 'project-1', name: 'image 项目', createdAt: '', updatedAt: '' },
      flow: { id: 'flow-1', name: 'image 项目', createdAt: '', updatedAt: '' },
    })

    const result = await createPromptLibraryProject(entry('image'), 'team-1', { bootstrapProject })

    expect(bootstrapProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'image 项目',
      teamId: 'team-1',
      nodes: [expect.objectContaining({ type: 'taskNode' })],
    }))
    expect(result).toMatchObject({ project: { id: 'project-1' }, flow: { id: 'flow-1' } })
  })

  it('preserves and reports a project when canvas persistence fails', async () => {
    const project = { id: 'project-1', name: 'image 项目', createdAt: '', updatedAt: '' }
    const bootstrapProject = vi.fn().mockResolvedValue({ status: 'partial', project, error: 'flow unavailable' })

    await expect(createPromptLibraryProject(entry('image'), null, { bootstrapProject }))
      .rejects.toMatchObject<Partial<PromptLibraryCanvasSaveError>>({ project, message: 'flow unavailable' })
  })
})

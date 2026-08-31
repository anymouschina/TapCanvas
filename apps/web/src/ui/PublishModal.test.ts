import { describe, expect, it } from 'vitest'
import { buildPublishRecordPayload, getPublishValidationError } from './PublishModal'

describe('PublishModal publish association', () => {
  it('persists an explicit chapter association in the publish snapshot', () => {
    const payload = buildPublishRecordPayload({
      title: ' 章节作品 ',
      description: ' 作品说明 ',
      coverImageUrl: 'https://assets.example.com/cover.jpg',
      videoUrl: 'https://assets.example.com/video.mp4',
      ownerType: 'chapter',
      ownerId: ' chapter-1 ',
      sourceProjectId: 'project-1',
      sourceProjectName: '项目一',
      sourceChapterTitle: ' 第一章 ',
    })

    expect(payload).toMatchObject({
      title: '章节作品',
      description: '作品说明',
      ownerType: 'chapter',
      ownerId: 'chapter-1',
      sourceProjectId: 'project-1',
      sourceProjectName: '项目一',
      sourceChapterId: 'chapter-1',
      sourceChapterTitle: '第一章',
    })
  })

  it('does not manufacture chapter fields for a project association', () => {
    const payload = buildPublishRecordPayload({
      title: '项目作品',
      description: '',
      coverImageUrl: 'https://assets.example.com/cover.jpg',
      videoUrl: 'https://assets.example.com/video.mp4',
      ownerType: 'project',
      ownerId: 'project-1',
      sourceProjectId: 'project-1',
      sourceProjectName: '项目一',
      sourceChapterTitle: null,
    })

    expect(payload.sourceChapterId).toBe('')
    expect(payload.sourceChapterTitle).toBe('')
  })

  it('requires a real source in the portal publish flow', () => {
    expect(getPublishValidationError({
      title: '作品',
      videoUrl: 'https://assets.example.com/video.mp4',
      coverUrl: 'https://assets.example.com/cover.jpg',
      requireSource: true,
      ownerId: null,
    })).toBe('请选择要关联的项目、章节或短片')
  })
})

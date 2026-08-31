import { describe, expect, it } from 'vitest'
import {
  CHAPTER_META_UPDATED_EVENT,
  dispatchChapterMetaUpdate,
  readChapterMetaUpdate,
} from './chapterMetaEvents'

describe('chapter meta update events', () => {
  it('carries a saved manual chapter draft to the mounted chapter canvas', () => {
    let received: ReturnType<typeof readChapterMetaUpdate> = null
    const listener = (event: Event) => {
      received = readChapterMetaUpdate(event)
    }
    window.addEventListener(CHAPTER_META_UPDATED_EVENT, listener)

    dispatchChapterMetaUpdate({
      chapterId: 'chapter-1',
      title: '登录方舟',
      summary: '先完成 30 秒开场。',
    })

    window.removeEventListener(CHAPTER_META_UPDATED_EVENT, listener)
    expect(received).toEqual({
      chapterId: 'chapter-1',
      title: '登录方舟',
      summary: '先完成 30 秒开场。',
    })
  })
})

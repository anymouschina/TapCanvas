import { describe, expect, it, vi } from 'vitest'

import type { HomepageDecoration } from '../../../api/server'
import {
  runHomepageSave,
  type HomepageSaveTask,
  validateHomepageSaveDraft,
} from './homepageSaveCoordinator'

const EMPTY_DECORATION: HomepageDecoration = {
  greetingSubtitle: null,
  heroPlaceholder: null,
  skillCards: [],
  loginVideos: [],
}

describe('homepageSaveCoordinator', () => {
  it('runs every valid save task and retains individual outcomes', async () => {
    const first = vi.fn(async () => undefined)
    const second = vi.fn(async () => undefined)
    const tasks: HomepageSaveTask[] = [
      { key: 'carousel', label: '首页轮播图', run: first },
      { key: 'moderation', label: '首页作品拉黑', run: second },
    ]

    const result = await runHomepageSave({ slides: [], decoration: EMPTY_DECORATION }, tasks)

    expect(result.validationError).toBeNull()
    expect(result.outcomes.map(({ error }) => error)).toEqual([null, null])
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('reports one failed task without discarding successful writes', async () => {
    const successful = vi.fn(async () => undefined)
    const failed = vi.fn(async () => { throw new Error('审核配置写入失败') })

    const result = await runHomepageSave({ slides: [], decoration: EMPTY_DECORATION }, [
      { key: 'ranking', label: '首页推荐算法', run: successful },
      { key: 'moderation', label: '首页作品拉黑', run: failed },
    ])

    expect(result.outcomes).toHaveLength(2)
    expect(result.outcomes[0]?.error).toBeNull()
    expect(result.outcomes[1]?.error).toBe('审核配置写入失败')
    expect(successful).toHaveBeenCalledOnce()
  })

  it('does not start any write when a draft row is incomplete', async () => {
    const write = vi.fn(async () => undefined)
    const result = await runHomepageSave({
      slides: [{ imageUrl: '  ', title: null, linkUrl: null }],
      decoration: EMPTY_DECORATION,
    }, [{ key: 'carousel', label: '首页轮播图', run: write }])

    expect(result.validationError).toBe('第 1 张轮播图缺少图片，请补充或删除该项')
    expect(result.outcomes).toEqual([])
    expect(write).not.toHaveBeenCalled()
  })

  it('identifies incomplete decoration rows explicitly', () => {
    expect(validateHomepageSaveDraft({
      slides: [],
      decoration: {
        ...EMPTY_DECORATION,
        skillCards: [{ title: '', subtitle: null, imageUrl: null, link: null }],
      },
    })).toBe('第 1 个 Skill 快捷卡缺少标题，请补充或删除该项')

    expect(validateHomepageSaveDraft({
      slides: [],
      decoration: {
        ...EMPTY_DECORATION,
        loginVideos: [{ url: '', posterUrl: null, caption: null }],
      },
    })).toBe('第 1 个登录页视频缺少视频 URL，请补充或删除该项')
  })
})

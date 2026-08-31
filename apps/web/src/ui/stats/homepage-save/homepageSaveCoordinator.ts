import type { CarouselSlide, HomepageDecoration } from '../../../api/server'

export type HomepageSaveTaskKey = 'carousel' | 'decoration' | 'ranking' | 'moderation' | 'template'

export type HomepageSaveTask = {
  key: HomepageSaveTaskKey
  label: string
  templateId?: string
  run: () => Promise<unknown>
}

export type HomepageSaveOutcome = {
  task: HomepageSaveTask
  error: string | null
}

export type HomepageSaveResult = {
  validationError: string | null
  outcomes: HomepageSaveOutcome[]
}

type HomepageSaveDraft = {
  slides: readonly CarouselSlide[]
  decoration: HomepageDecoration
}

function resolveSaveError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export function validateHomepageSaveDraft(draft: HomepageSaveDraft): string | null {
  const invalidSlideIndex = draft.slides.findIndex((slide) => !slide.imageUrl.trim())
  if (invalidSlideIndex >= 0) {
    return `第 ${invalidSlideIndex + 1} 张轮播图缺少图片，请补充或删除该项`
  }

  const invalidSkillCardIndex = draft.decoration.skillCards.findIndex((card) => !card.title.trim())
  if (invalidSkillCardIndex >= 0) {
    return `第 ${invalidSkillCardIndex + 1} 个 Skill 快捷卡缺少标题，请补充或删除该项`
  }

  const invalidLoginVideoIndex = draft.decoration.loginVideos.findIndex((video) => !video.url.trim())
  if (invalidLoginVideoIndex >= 0) {
    return `第 ${invalidLoginVideoIndex + 1} 个登录页视频缺少视频 URL，请补充或删除该项`
  }

  return null
}

export async function runHomepageSave(
  draft: HomepageSaveDraft,
  tasks: readonly HomepageSaveTask[],
): Promise<HomepageSaveResult> {
  const validationError = validateHomepageSaveDraft(draft)
  if (validationError) return { validationError, outcomes: [] }

  const outcomes = await Promise.all(tasks.map(async (task): Promise<HomepageSaveOutcome> => {
    try {
      await task.run()
      return { task, error: null }
    } catch (error: unknown) {
      return { task, error: resolveSaveError(error, `${task.label}保存失败`) }
    }
  }))

  return { validationError: null, outcomes }
}

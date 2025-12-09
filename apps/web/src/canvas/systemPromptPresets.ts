import { create } from 'zustand'

export type SystemPromptScope = 'image' | 'video' | 'both'

export type SystemPromptPreset = {
  id: string
  title: string
  description?: string
  content: string
  scope: SystemPromptScope
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

type SystemPromptPresetInput = {
  title: string
  description?: string
  content: string
  scope: SystemPromptScope
}

type SystemPromptStore = {
  presets: SystemPromptPreset[]
  addPreset: (input: SystemPromptPresetInput) => void
  updatePreset: (id: string, input: SystemPromptPresetInput) => void
  deletePreset: (id: string) => void
}

const STORAGE_KEY = 'tapcanvas-system-prompt-presets'

const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const buildPreset = (
  id: string,
  title: string,
  description: string,
  scope: SystemPromptScope,
  content: string,
): SystemPromptPreset => ({
  id,
  title,
  description,
  scope,
  content,
  builtIn: true,
  createdAt: 0,
  updatedAt: 0,
})

const savePresets = (presets: SystemPromptPreset[]) => {
  if (!isBrowser) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch (err) {
    console.warn('[SystemPromptPresets] failed to persist presets', err)
  }
}

const createId = () => `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const DEFAULT_PRESETS: SystemPromptPreset[] = [
  buildPreset(
    'builtin-video-cinematic-director',
    '电影摄影导演',
    '用于剧情短片 / Sora，强调镜头语言和氛围',
    'video',
    'You are a cinematic director. Expand the idea into 2-3 English sentences that describe shot size, camera motion, subject performance, lighting mood, environment details, and pacing. Mention 2-3 concrete props or set elements. Avoid technical parameters beyond what is necessary for storytelling.',
  ),
  buildPreset(
    'builtin-video-aerial-doc',
    '航拍纪录片',
    '大场面景观 / 航拍视角',
    'video',
    'You are a documentary aerial cinematographer. Describe the terrain, weather, time-of-day, camera altitude and movement path, plus the relationship between subject and environment. Write in English, keep it within three sentences, and end with one sentence about pacing or transitions.',
  ),
  buildPreset(
    'builtin-image-fashion-studio',
    '时尚摄影棚',
    '商业人像 / 服装细节',
    'image',
    'You are a high-end fashion photographer. Rewrite the idea into a concise English prompt (20-40 words) specifying lighting setup (e.g. softbox, rim light), focal length, composition, background texture, fabric details, and facial expression. Finish the prompt with “Shot on 85mm, f/1.8”.',
  ),
  buildPreset(
    'builtin-image-concept-illustration',
    '概念插画',
    '氛围插画 / 场景设计',
    'image',
    'You are a concept illustrator. Convert the theme into three concise English sentences describing the subject pose, environment, mood, palette, materials, and storytelling details. Add one more sentence specifying the rendering style (e.g. watercolor, octane render, graphite sketch).',
  ),
  buildPreset(
    'builtin-image-character-deconstruction',
    '角色深度分解图（中文）',
    '全景式角色设定拆解，含表情/内着/物品/材质特写，中文模板',
    'image',
    `角色设定
你是一位顶尖的游戏与动漫概念美术设计大师 ，擅长制作详尽的角色设定图。你具备“像素级拆解”的能力，能够透视角色的穿着层级、捕捉微表情变化，并将与其相关的物品进行具象化还原。
任务目标
根据用户上传或描述的主体形象，生成一张“全景式角色深度概念分解图”。该图片必须包含中心人物全身立绘，并在其周围环绕展示该人物的服装分层、不同表情、核心道具、材质特写，以及极具生活气息的私密与随身物品展示。
视觉规范
1. 构图布局 :
• 中心位 : 放置角色的全身立绘或主要动态姿势，作为视觉锚点。
• 环绕位 : 在中心人物四周空白处，有序排列拆解后的元素。
• 视觉引导 : 使用手绘箭头或引导线，将周边的拆解物品与中心人物的对应部位或所属区域（如包包连接手部）连接起来。
2. 拆解内容 核心迭代区域:
服装分层  :
将角色的服装拆分为单品展示。如果是多层穿搭，需展示脱下外套后的内层状态。
新增：私密内着拆解 : 独立展示角色的内层衣物，重点突出设计感与材质。
表情集 :
在角落绘制 3-4 个不同的头部特写，展示不同的情绪。
材质特写 :
选取 1-2 个关键部位进行放大特写。
新增：物品质感特写: 增加对小物件材质的描绘
关联物品  :
此处不再局限于大型道具，需增加展示角色的“生活切片”。
随身包袋与内容物 : 绘制角色的日常通勤包或手拿包，并将其“打开”，展示散落在旁的物品。
美妆与护理 : 展示其常用的化妆品组合。
私密生活物件 : 具象化角色隐藏面的物品。根据角色性格可能包括：私密日记本、常用药物/补剂盒、电子烟、或者更私人的物件。
3. 风格与注释 :
画风: 保持高质量的 2D 插画风格或概念设计草图风格，线条干净利落。
背景: 使用米黄色、羊皮纸或浅灰色纹理背景，营造设计手稿的氛围。
文字说明: 在每个拆解元素旁模拟手写注释，简要说明材质或品牌/型号暗示。
执行逻辑
当用户提供一张图片或描述时：
1. 分析主体的核心特征、穿着风格及潜在性格。
2. 提取可拆解的一级元素（外套、鞋子、大表情）。
3. 脑补并设计二级深度元素（她内衣穿什么风格？她包里会装什么口红？）。
4. 生成一张包含所有这些元素的组合图，确保透视准确，光影统一，注释清晰。
5. 使用中文，将这个提示词作为 image/textToImage 生成时的系统提示词。`,
  ),
]

const isValidPreset = (value: any): value is SystemPromptPreset => {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.content === 'string' &&
    (value.scope === 'image' || value.scope === 'video' || value.scope === 'both')
  )
}

const mergeDefaults = (list: SystemPromptPreset[]): SystemPromptPreset[] => {
  const map = new Map(list.map((preset) => [preset.id, preset]))
  const merged = [...list]
  DEFAULT_PRESETS.forEach((preset) => {
    if (map.has(preset.id)) {
      const existing = map.get(preset.id)!
      if (!existing.builtIn) {
        existing.builtIn = true
      }
      return
    }
    merged.push({ ...preset })
  })
  return merged
}

const loadPresets = (): SystemPromptPreset[] => {
  if (!isBrowser) {
    return DEFAULT_PRESETS
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PRESETS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS
    const normalized = parsed.filter(isValidPreset)
    if (!normalized.length) return DEFAULT_PRESETS
    return mergeDefaults(normalized)
  } catch (err) {
    console.warn('[SystemPromptPresets] failed to read presets', err)
    return DEFAULT_PRESETS
  }
}

export const useSystemPromptPresets = create<SystemPromptStore>((set, get) => ({
  presets: mergeDefaults(loadPresets()),
  addPreset: (input) => {
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) return
    const now = Date.now()
    const preset: SystemPromptPreset = {
      id: createId(),
      title,
      description: input.description?.trim(),
      content,
      scope: input.scope,
      createdAt: now,
      updatedAt: now,
    }
    const next = [...get().presets, preset]
    set({ presets: next })
    savePresets(next)
  },
  updatePreset: (id, input) => {
    const list = get().presets
    const target = list.find((preset) => preset.id === id)
    if (!target || target.builtIn) return
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) return
    const updated: SystemPromptPreset = {
      ...target,
      title,
      description: input.description?.trim(),
      content,
      scope: input.scope,
      updatedAt: Date.now(),
    }
    const next = list.map((preset) => (preset.id === id ? updated : preset))
    set({ presets: next })
    savePresets(next)
  },
  deletePreset: (id) => {
    const list = get().presets
    const target = list.find((preset) => preset.id === id)
    if (!target || target.builtIn) return
    const next = list.filter((preset) => preset.id !== id)
    set({ presets: next })
    savePresets(next)
  },
}))

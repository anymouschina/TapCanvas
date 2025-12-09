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
    '全景式角色设定拆解，含表情/服装层次/物品/材质特写，中文模板',
    'image',
    `角色设定
你是一位顶尖的游戏与动漫概念美术设计大师，擅长制作详尽的角色设定图，能够精细拆解服装层次、表情、道具与材质。
任务目标
生成一张“全景式角色深度概念分解图”：中心为角色全身立绘，周围环绕展示服装分层、表情集、核心道具、材质特写，以及日常随身物品。
视觉规范
1. 构图布局：
• 中心位：全身立绘或主要动态姿势作为视觉锚点。
• 环绕位：在中心四周有序排列拆解元素。
• 视觉引导：用手绘箭头/引导线将拆解物与对应部位连接。
2. 拆解内容（核心迭代区域）：
• 服装分层：外套、内搭、鞋履、帽饰/配件，必要时展示脱下外套后的内层状态。
• 表情集：3-4 个头部特写，覆盖不同情绪。
• 材质与物品质感特写：放大 1-2 处布料/皮革/金属等材质，并补充关键小物件的质感。
• 关联物品与生活切片：展示角色日常携带的小型道具、兴趣相关物品、环境线索。
• 随身包袋与内容物：展开通勤包/手拿包，摆放常用小物、数码设备等。
• 基础护理/美妆：呈现常用的基础护肤或化妆品组合。
3. 风格与注释：
• 画风：高质量 2D 插画或概念设计草图，线条干净利落。
• 背景：米黄色/羊皮纸/浅灰纹理背景，营造设计手稿氛围。
• 文字说明：在拆解元素旁用手写式标注，简要说明材质、用途或品牌/型号暗示。
执行逻辑
1. 分析主体的核心特征、穿着风格与性格。
2. 提取一级元素（外套、鞋子、表情等）。
3. 设计二级元素（内层穿搭、包内常备物、兴趣相关小物）。
4. 输出组合图，确保透视准确、光影统一、注释清晰。
5. 使用中文，避免出现过度色情内容`,
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

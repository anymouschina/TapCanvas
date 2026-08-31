export type LibTvImagePresetKey =
  | 'blocking-storyboard'
  | 'storyboard'
  | 'storyboard-25'
  | 'plot-4'
  | 'evolution-3s-after'
  | 'evolution-5s-before'
  | 'portrait-texture'
  | 'lighting-correction'
  | 'panorama-720'
  | 'multi-camera-9'
  | 'character-face-3view'
  | 'character-setting'
  | 'character-3view'
  | 'character-fission'
  | 'scene-setting'
  | 'product-setting'

export type LibTvImagePreset = Readonly<{
  key: LibTvImagePresetKey
  label: string
  description: string
  prompt: string
  execution: 'image-edit' | 'panorama' | 'character-fission'
}>

export type LibTvImagePresetGroup = Readonly<{
  key: 'storyboard' | 'quality' | 'camera' | 'setting'
  label: string
  presets: readonly LibTvImagePreset[]
}>

export const LIBTV_IMAGE_PRESET_GROUPS: readonly LibTvImagePresetGroup[] = [
  {
    key: 'storyboard',
    label: '分镜叙事',
    presets: [
      {
        key: 'blocking-storyboard',
        label: '调度故事板',
        description: '生成带有运动轨迹等调度草图分镜',
        execution: 'image-edit',
        prompt: '基于参考画面生成影视调度故事板。用连续分镜明确人物、道具和摄影机的运动轨迹、走位箭头、视线方向与场面调度，保持角色、场景和空间关系连续，画面应可直接供导演和分镜师执行。',
      },
      {
        key: 'storyboard',
        label: '故事板',
        description: '生成完整剧情片段',
        execution: 'image-edit',
        prompt: '基于参考画面生成一个完整剧情片段的电影故事板。用连续镜头呈现清晰的起因、行动、反应与结果，保持角色造型、场景、光线、轴线和空间关系一致，每格都具备明确景别和叙事功能。',
      },
      {
        key: 'storyboard-25',
        label: '25宫格连贯分镜',
        description: '生成连续分镜长图',
        execution: 'image-edit',
        prompt: '将参考画面展开为25格连贯分镜长图，形成完整的动态叙事流。每格自然承接前一格，保持角色身份、服装、场景结构、道具位置、光线方向与运动连续，避免重复镜头。',
      },
      {
        key: 'plot-4',
        label: '剧情推演四宫格',
        description: '生成四格剧情推演',
        execution: 'image-edit',
        prompt: '将参考画面推演为四宫格故事分镜，依次呈现四个连续的剧情发展时刻。保持角色、场景与视觉风格一致，让动作和情绪逐格推进并形成明确结果。',
      },
      {
        key: 'evolution-3s-after',
        label: '画面推演 - 3秒后',
        description: '推演画面后续动作',
        execution: 'image-edit',
        prompt: '推演参考画面在3秒后的视觉状态，延续当前人物动作、物体运动、环境变化与镜头逻辑，保持场景结构、角色身份和整体风格一致，呈现可信的下一关键时刻。',
      },
      {
        key: 'evolution-5s-before',
        label: '画面推演 - 5秒前',
        description: '还原画面前置状态',
        execution: 'image-edit',
        prompt: '还原参考画面在5秒前的视觉状态，根据当前人物姿态、物体位置和事件结果反推可信的前置动作，保持场景结构、角色身份、镜头方向和整体风格一致。',
      },
    ],
  },
  {
    key: 'quality',
    label: '质感调节',
    presets: [
      {
        key: 'portrait-texture',
        label: '人像质感调节',
        description: '降低 AI 感，优化人物质感与光影',
        execution: 'image-edit',
        prompt: '在不改变人物身份、五官比例、发型、服装、姿态和构图的前提下，降低人像的AI塑料感，恢复自然皮肤纹理、真实材质细节、可信光影过渡和镜头层次，保留原有色彩与氛围。',
      },
      {
        key: 'lighting-correction',
        label: '电影级光影校正',
        description: '调整画面光影质感',
        execution: 'image-edit',
        prompt: '对参考画面进行电影级光影校正，优化曝光、色温、层次、主体塑形与戏剧性明暗对比。严格保持人物身份、构图、物体位置和场景内容不变，呈现自然可信的院线级质感。',
      },
    ],
  },
  {
    key: 'camera',
    label: '空间与机位',
    presets: [
      {
        key: 'panorama-720',
        label: '720°全景图',
        description: '生成全景场景图',
        execution: 'panorama',
        prompt: '将参考图片扩展为标准2:1等距柱状投影的720°全景场景图。补全画面四周与上下空间，保持原始主体、场景结构、材质、光线和视觉风格一致，左右边缘必须无缝衔接，可直接用于球形全景浏览。',
      },
      {
        key: 'multi-camera-9',
        label: '多机位九宫格',
        description: '生成多视角机位图',
        execution: 'image-edit',
        prompt: '将参考画面分解为九宫格多机位图，从九个明确不同且符合空间逻辑的摄影机角度呈现同一场景。每格独立构图完整，保持人物、服装、道具、光线和场景布局一致。',
      },
    ],
  },
  {
    key: 'setting',
    label: '设定图',
    presets: [
      {
        key: 'character-face-3view',
        label: '角色脸部三视图',
        description: '基于一张参考图生成脸部细节三视图',
        execution: 'image-edit',
        prompt: '基于参考人物生成角色脸部三视图设定图，包含正脸、左侧脸和右侧脸的同尺度清晰特写。严格锁定身份、五官比例、发型、肤色与妆容，使用中性表情和统一光线，便于后续角色一致性生产。',
      },
      {
        key: 'character-setting',
        label: '角色设定图',
        description: '角色主视觉与设定拆解',
        execution: 'image-edit',
        prompt: '基于参考人物生成完整角色设定图，包含角色主视觉、全身造型、服装与配饰拆解、关键材质和色彩说明。严格保持人物身份与原始设计一致，版面清晰、信息可用于后续制作。',
      },
      {
        key: 'character-3view',
        label: '角色三视图',
        description: '正侧背视图与脸部特写',
        execution: 'image-edit',
        prompt: '基于参考人物生成标准角色三视图设定图，包含正视、侧视、背视全身图与脸部特写。统一站姿、尺度、光线和背景，严格保持五官、体型、发型、服装、配饰及材质一致。',
      },
      {
        key: 'character-fission',
        label: '角色裂变',
        description: '按比例、年龄、体型或造型方向生成角色候选',
        execution: 'character-fission',
        prompt: '',
      },
      {
        key: 'scene-setting',
        label: '场景设定图',
        description: '场景主视觉、空间结构与光影材质拆解',
        execution: 'image-edit',
        prompt: '基于参考画面生成场景设定图，包含场景主视觉、空间结构、关键区域、重要道具、材质、光线与色彩拆解。保持原始世界观和设计语言一致，版面清晰并可直接服务美术制作。',
      },
      {
        key: 'product-setting',
        label: '产品设定图',
        description: '产品多视图、结构细节与材质功能拆解',
        execution: 'image-edit',
        prompt: '基于参考产品生成产品设定图，包含主视觉、正侧背多角度、结构细节、材质、颜色和关键功能拆解。严格保持产品比例、标识和设计语言一致，使用清晰专业的设计展示版式。',
      },
    ],
  },
]

export const LIBTV_IMAGE_PRESETS: readonly LibTvImagePreset[] = LIBTV_IMAGE_PRESET_GROUPS.flatMap(
  (group) => group.presets,
)

/** Liblib 图片节点「九宫格」菜单的公开展示顺序。 */
export const LIBTV_IMAGE_NINE_GRID_PRESET_KEYS: readonly LibTvImagePresetKey[] = [
  'multi-camera-9',
  'plot-4',
  'character-face-3view',
  'character-setting',
  'scene-setting',
  'product-setting',
  'storyboard-25',
  'lighting-correction',
  'character-3view',
  'evolution-3s-after',
  'evolution-5s-before',
]

export function findLibTvImagePreset(key: string | null): LibTvImagePreset | null {
  if (!key) return null
  return LIBTV_IMAGE_PRESETS.find((preset) => preset.key === key) ?? null
}

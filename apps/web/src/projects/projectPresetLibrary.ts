import type { ProjectSetupProfile } from './projectSetupProfile'

export type ProjectArtStylePreset = {
  id: string
  sourceSlug: string
  name: string
  summary: string
  tags: string[]
  styleDirectives: string
}

export type ProjectDirectorManualPreset = {
  id: string
  sourceSlug: string
  name: string
  summary: string
  tags: string[]
  directorManual: string
}

export const PROJECT_ART_STYLE_PRESETS: ProjectArtStylePreset[] = [
  {
    id: 'toonflow-2d-chinese-guofeng',
    sourceSlug: '2D_chinese_guofeng',
    name: '国风二次元新国潮',
    summary: '适合仙侠、古风、宫廷与东方奇幻，强调留白、电影构图和赛璐璐渲染。',
    tags: ['国风', '仙侠', '二次元', '电影感'],
    styleDirectives:
      '统一采用国风二次元新国潮方向，保留东方古韵与现代审美结合的电影质感。角色线条细腻，服饰纹样精致，场景强调留白、云雾、层次化纵深。整体配色以月白、青绿、朱红、金黄和墨黑为主，避免荧光色、写实摄影感与过度现代元素。镜头构图优先中远景意境建立，再用近景强化人物情绪。',
  },
  {
    id: 'toonflow-2d-flat-design',
    sourceSlug: '2D_flat_design',
    name: '扁平插画漫画',
    summary: '适合轻喜、科普、品牌向内容，强调识别度、简洁造型和统一色块。',
    tags: ['扁平', '轻量', '品牌化', '清晰'],
    styleDirectives:
      '统一采用二维扁平插画语言，图形轮廓清晰，结构简化，色块明确，减少复杂纹理和写实光影。角色比例稳定，表情和动作易读，场景信息层级清楚，适合章节节奏快、信息表达明确的漫剧内容。整体避免杂乱细节和过度渲染，保证批量镜头输出的一致性与可控性。',
  },
  {
    id: 'toonflow-2d-90s-japanese-anime',
    sourceSlug: '2D_90s_japanese_anime',
    name: '90年代日漫热血',
    summary: '适合校园、热血、青春成长和动作戏，强调高对比情绪与经典动画分镜。',
    tags: ['日漫', '青春', '热血', '赛璐璐'],
    styleDirectives:
      '统一采用90年代经典日漫赛璐璐气质，人物造型鲜明，轮廓干净，镜头节奏明确。保留较强的情绪色块、高反差人物表情、速度线和经典近景冲击力，适合高能冲突、成长觉醒和团队关系戏。避免过度写实与现代影视滤镜，让画面保持动画感、青春感和叙事爆发力。',
  },
  {
    id: 'toonflow-2d-mature-urban-romance',
    sourceSlug: '2D_mature_urban_romance',
    name: '熟龄都市情感',
    summary: '适合都市言情、职场关系和成人向情绪戏，偏写意但不写实。',
    tags: ['都市', '情感', '职场', '细腻'],
    styleDirectives:
      '统一采用熟龄都市情感漫剧风格，人物比例更接近成人审美，服装与空间设计服务职业身份与关系张力。镜头强调室内外光影、克制配色和情绪化近景，突出眼神、停顿和关系距离。避免夸张卡通化处理，也避免完全写实摄影质感，让都市情感保持高级感与连续性。',
  },
  {
    id: 'toonflow-realpeople-urban-modern',
    sourceSlug: 'realpeople_urban_modern',
    name: '现代都市写实参考',
    summary: '适合短剧、广告感人物戏和现代现实题材，强调真实空间与服化道。',
    tags: ['现代', '现实', '都市', '写实参考'],
    styleDirectives:
      '统一采用现代都市高质感写实参考风格，场景、服装和道具需要贴近真实生活逻辑，但镜头组织仍以漫剧可控性优先。画面突出当代城市空间、材质和人物状态，适合现实题材、短剧化冲突和生活流段落。避免奇幻化处理与夸张卡通比例，强化可信度和代入感。',
  },
  {
    id: 'toonflow-3d-anime-render',
    sourceSlug: '3D_anime_render',
    name: '3D动漫渲染',
    summary: '适合需要稳定角色资产和高复用场景的长线项目。',
    tags: ['3D', '动漫渲染', '稳定资产', '长线连载'],
    styleDirectives:
      '统一采用3D动漫渲染方向，角色、场景和道具需要考虑可重复复用与多镜头一致性。画面保留动漫化面部表现和较干净的材质处理，同时通过灯光、景深和镜头角度获得影视感。适合中长线连载项目的资产沉淀，但应避免写实皮肤、写实材质噪点和重工业CG压迫感。',
  },
]

export const PROJECT_DIRECTOR_MANUAL_PRESETS: ProjectDirectorManualPreset[] = [
  {
    id: 'toonflow-xianxia-fantasy',
    sourceSlug: 'Xianxia_fantasy',
    name: '古风仙侠',
    summary: '强调意境、宿命感与天地人合一，适合仙侠、武侠和东方奇幻。',
    tags: ['仙侠', '意境', '宿命', '留白'],
    directorManual:
      '章节节奏以命运伏笔、劫难递进和悟道顿悟构成主轴。镜头调度优先山水远景、云雾留白和情绪化静止镜头，再在关键对决处切入快推、跟拍和能量爆发。对白克制，允许沉默、环境声和自然景观承担叙事。人物情绪要与天气、光线和空间状态联动，让世界本身参与表演。',
  },
  {
    id: 'toonflow-urban-workplace-drama',
    sourceSlug: 'Urban_workplace_drama',
    name: '都市职场',
    summary: '强调角色关系、信息博弈和现实压迫感，适合办公室、创业与现实冲突。',
    tags: ['都市', '职场', '关系', '节奏'],
    directorManual:
      '章节推进围绕目标、阻碍、关系翻面和职场权力变化展开。镜头以空间站位、会议桌、走廊和办公室玻璃等现代空间元素建立压迫感，重点拍人物反应、打断、停顿和信息差。对白密度可以略高，但必须服务冲突升级。每章结尾保留一个清晰钩子，推动下一章继续生产。',
  },
  {
    id: 'toonflow-coming-of-age',
    sourceSlug: 'Coming_of_age',
    name: '成长青春',
    summary: '强调角色自我认知变化与群像关系，适合校园、友情、青春疼痛或热血成长。',
    tags: ['青春', '成长', '群像', '情绪'],
    directorManual:
      '章节节奏遵循建立天真状态、触发挫折、关系裂变、形成选择和获得成长回响的结构。镜头多使用主观视角、群像并置、奔跑和停顿，保留青春期的不稳定情绪与强烈感受。旁白只能在关键内心转折点出现，避免解释过度。每章都应让主角完成一点点可感知的变化。',
  },
  {
    id: 'toonflow-mystery-thriller',
    sourceSlug: 'Mystery_thriller',
    name: '悬疑惊悚',
    summary: '强调信息遮蔽、节奏反转和线索管理，适合悬疑、惊悚、侦探类项目。',
    tags: ['悬疑', '惊悚', '反转', '线索'],
    directorManual:
      '章节结构以悬念投放、局部揭示、错误判断和尾部反转为核心。镜头优先细节特写、空间异样、信息遮挡和延迟揭示，通过留白控制观众知道的内容。对白必须克制，避免直接解释谜面。每章至少保留一个被重新定义的事实，推动用户继续追看。',
  },
  {
    id: 'toonflow-hot-blooded-action',
    sourceSlug: 'Hot_blooded_action',
    name: '热血动作',
    summary: '强调目标、冲突升级和爆发点，适合战斗、冒险、少年漫画式内容。',
    tags: ['动作', '热血', '目标', '爆发'],
    directorManual:
      '章节推进遵循任务目标明确、对手阻挡升级、情绪蓄力和高光爆发的节奏。镜头组织强调动线清晰、冲击镜头、节奏递进和短促有力的台词。大场面前先给人物动机和牺牲感，再切入高能动作。结尾通常要留下更强的对手、代价或新的任务升级。',
  },
  {
    id: 'toonflow-sweet-romance-novel',
    sourceSlug: 'Sweet_romance_novel',
    name: '甜宠言情',
    summary: '强调关系推进、情绪细节和暧昧反馈，适合恋爱、甜宠与轻喜感内容。',
    tags: ['言情', '甜宠', '关系推进', '轻喜'],
    directorManual:
      '章节节奏围绕试探、误会、靠近、确认反馈和情绪回甘展开。镜头更关注表情、动作细节、身体距离和日常环境中的微小变化，冲突不必都走强对抗，也可以是柔性的暧昧拉扯。对白应该自然、轻巧且具有回看价值。每章都要让关系比上一章更进一步。',
  },
]

export function getArtStylePresetById(id: string | null | undefined): ProjectArtStylePreset | null {
  if (!id) return null
  return PROJECT_ART_STYLE_PRESETS.find((item) => item.id === id) || null
}

export function getDirectorManualPresetById(id: string | null | undefined): ProjectDirectorManualPreset | null {
  if (!id) return null
  return PROJECT_DIRECTOR_MANUAL_PRESETS.find((item) => item.id === id) || null
}

export function applyArtStylePresetToProfile<T extends Pick<ProjectSetupProfile, 'artStyleName' | 'styleDirectives'> & Partial<ProjectSetupProfile>>(
  profile: T,
  preset: ProjectArtStylePreset,
): T & Pick<ProjectSetupProfile, 'artStylePresetId'> {
  return {
    ...profile,
    artStyleName: preset.name,
    styleDirectives: preset.styleDirectives,
    artStylePresetId: preset.id,
  }
}

export function applyDirectorManualPresetToProfile<T extends Pick<ProjectSetupProfile, 'directorManual'> & Partial<ProjectSetupProfile>>(
  profile: T,
  preset: ProjectDirectorManualPreset,
): T & Pick<ProjectSetupProfile, 'directorManualPresetId'> {
  return {
    ...profile,
    directorManual: preset.directorManual,
    directorManualPresetId: preset.id,
  }
}

export type PromptSample = {
  id: string
  scene: string
  commandType: string
  title: string
  nodeKind: 'image' | 'composeVideo' | 'storyboard'
  prompt: string
  description?: string
  inputHint?: string
  outputNote?: string
  keywords: string[]
}

export const PROMPT_SAMPLES: PromptSample[] = [
  {
    id: 'video-realism-golden-hour',
    scene: '视频真实感',
    commandType: '手持城市镜头',
    title: '黄金时刻街头追踪',
    nodeKind: 'composeVideo',
    prompt: `Golden hour handheld tracking shot in a rain-washed Shibuya side street. The protagonist jogs up from the subway, phone buzzing, and follows the alert toward a rooftop cafe sign. Lighting: golden-hour sunlight from the left, 4800K warmth reflecting across wet asphalt and glass, with every shadow aligned to the same direction. Camera handling: subtle handheld jitter around 1% with breathing sway and a 0.3s settle whenever the shot starts or stops. Lens: 35mm prime at f/2.2, performing a two-second focus pull from her determined face to neon signage in the distance. Optics: add a 6% vignette, faint anamorphic flares, slight chromatic aberration and soft film grain for authenticity. Micro motion: fingers tighten on the phone, crossbody bag straps bounce, fabric folds react with a 200ms delay, nearby umbrellas wobble as she brushes past. Materials: textured denim, brushed metal rails catching specular highlights, dusty shop windows blooming with light. Environment: steady wind from the right ripples through her hair, coat, and hanging lanterns, while suspended dust and drizzle sparkle in headlight beams. Camera intent: begin at eye level, push in for 2 seconds, hold as she spots the sign, then exit through a foreground passerby for layered depth. Micro narrative: phone buzz → glance at message → weave through commuters → leap the puddle as a tram whooshes past → dash up the stairwell, retaining motion blur and slight color shift.`,
    description: '涵盖九条真实感原则的完整视频模板，适合都市街头题材。',
    inputHint: '当用户需要城市追踪类镜头、强调手持与真实质感时使用。',
    outputNote: '生成结果具备统一光影、可信手持抖动及完整微剧情链。',
    keywords: ['video realism', 'handheld', 'golden hour', 'micro narrative', 'film grain']
  },
  {
    id: 'video-realism-rain-night-bus',
    scene: '视频真实感',
    commandType: '微剧情模板',
    title: '雨夜公交站戏剧',
    nodeKind: 'composeVideo',
    prompt: `Rainy night micro narrative at a glass-covered bus stop. A soaked dancer shields a sketchbook, waiting for route 23 while neon reflections ripple across puddles. Lighting: cold-blue street lamps mix with warm shop interiors, consistent shadow direction and foggy air scattering highlights. Camera handling: 1% handheld sway that mirrors breathing, with a gentle settle after each pan. Lens: 50mm at f/2.0, performing a two-second rack focus from raindrops on the glass to her face, then to the approaching headlights. Optics: introduce a 5% vignette, occasional lens flare streaks, soft chromatic aberration at the frame edges, and light film grain. Micro motion: wrists micro-adjust around the sketchbook, jacket fabric absorbs the gust then recovers, nearby paper cups tip when splashed. Materials: damp wool coat, cracked leather boots, stainless steel benches, and fogged glass panels collecting droplets. Environment: wind from the left pushes hair → coat → dangling earphones in sequence, plus mist particles shimmering in the backlight. Camera intent: eye-level dolly in, hold as the bus brakes, then swing behind her to reveal the city mirrored on the shelter glass. Micro narrative: notification ping → she checks the time → headlights bloom → she dodges a cyclist → boards the bus while motion blur and slight color shift remain.`,
    description: '雨夜场景模板，突出风雨互动、材质表现与镜头语言。',
    inputHint: '适合夜景、雨景、街头微剧情类视频节点。',
    outputNote: '输出画面带有真实雨夜质感、统一风向以及手持镜头像。',
    keywords: ['rain night', 'bus stop', 'handheld', 'lens imperfection', 'micro motion']
  },
  {
    id: 'img-clean-people',
    scene: '基础图片编辑',
    commandType: '元素消除',
    title: '消除图片中的路人',
    nodeKind: 'image',
    prompt: '精准移除画面中所有路人，仅保留主体与背景环境，保持原有光影与纹理连贯，输出干净整洁的背景。',
    description: '用于街拍、旅行照的路人清除，重点是无痕补全背景材质。',
    inputHint: '上传含有路人干扰的城市/旅行照片。',
    outputNote: '背景平滑、无重复纹理，可直接用于海报或二次创作。',
    keywords: ['元素消除', '路人', '去除', '清除人物', '移除行人']
  },
  {
    id: 'img-replace-subject',
    scene: '基础图片编辑',
    commandType: '元素更改',
    title: '主体替换为苹果',
    nodeKind: 'image',
    prompt: '将图片里的主体替换成质感真实的苹果，保留原场景的材质、光影和细节，使融入自然。',
    description: '用来更换产品主体但保留场景氛围，适合合成类创作。',
    inputHint: '上传包含需替换主体的产品或人物照片。',
    outputNote: '苹果需贴合原主体的体积与光影，不能破坏整体构图。',
    keywords: ['元素更改', '主体替换', '苹果', '保留光影', '保留材质']
  },
  {
    id: 'img-light-beam',
    scene: '基础图片编辑',
    commandType: '光影变化',
    title: '左上角自然光束',
    nodeKind: 'image',
    prompt: '不改变画面主体，在图片左上角打入一束柔和自然光，增强局部体积感与氛围。',
    description: '快速为照片补光，强调方向感和戏剧性。',
    inputHint: '适合光线不足或需要戏剧光效的图片。',
    outputNote: '新增光束需与现有光影方向一致，避免过曝。',
    keywords: ['光影变化', '自然光', '光束', '左上角', '补光']
  },
  {
    id: 'style-ink',
    scene: '风格转换',
    commandType: '风格改写',
    title: '中国水墨画风',
    nodeKind: 'image',
    prompt: '保持背景结构与人物特征不变，将整体风格改成中国水墨画，使用泼墨细节与工笔质感，背景简洁留白。',
    description: '强调东方韵味，适合角色与场景水墨化。',
    inputHint: '原图最好主体清晰，有明确造型。',
    outputNote: '人物五官与比例需保真，只改变笔触风格。',
    keywords: ['风格', '水墨', '泼墨', '国风', '工笔', '留白']
  },
  {
    id: 'text-edit-summer',
    scene: '文字修改',
    commandType: '字体替换',
    title: '初夏 → 夏至',
    nodeKind: 'image',
    prompt: '将画面中文字“初夏”改为“夏至”，英文字“CHU XIA”改为“Summer Solstice”，字体风格与排版保持一致。',
    description: '常用于海报文案修订，需保留原字体质感。',
    inputHint: '上传包含需替换文字的海报或照片。',
    outputNote: '新文案与背景融合自然，不可出现断笔或伪影。',
    keywords: ['文字修改', '夏至', 'Summer Solstice', '文案替换', '字体一致']
  },
  {
    id: 'poster-summer-market',
    scene: '海报图文设计',
    commandType: '设计补全',
    title: '盛夏潮玩市集主视觉',
    nodeKind: 'image',
    prompt: '这是盛夏潮玩市集宣传海报，主标题采用大字中文“盛夏潮玩市集”与英文“SUMMER MARKET”组合，整体呈现欢快夏日市集氛围。',
    description: '快速搭建市集主题海报骨架。',
    inputHint: '可提供草图或参考图以保证排版。',
    outputNote: '中文与英文标题并置清晰，色调符合夏日主题。',
    keywords: ['夏日市集', 'SUMMER MARKET', '设计补全', '潮玩', '海报']
  },
  {
    id: 'poster-product-bg',
    scene: '商品营销',
    commandType: '商品图背景替换',
    title: '匹配商品属性的背景',
    nodeKind: 'image',
    prompt: '根据商品属性替换背景，使环境与产品定位契合，可加入柔和景深与辅助道具，突出主体。',
    description: '适合电商图批量换景。',
    inputHint: '上传透明底或纯色背景的产品照。',
    outputNote: '背景需与商品色彩协调，不能喧宾夺主。',
    keywords: ['商品图', '背景替换', '电商', '产品', '换景']
  },
  {
    id: 'poster-plush',
    scene: '商品营销',
    commandType: '电商促销海报',
    title: '“蒜鸟”毛绒玩具主推',
    nodeKind: 'image',
    prompt: '电商促销海报：清新可爱的毛绒玩具主题。中央是超萌“蒜鸟”黄毛绒玩偶，眼睛像小黑豆，嫩黄色嘴巴和小脚，头顶绿油油蒜苗帽。背景为浅蓝渐变，撒落白绿小方块。上方用黑色粗体写“蒜鸟，都不涌易”，中部黄色字体写“好东西代表：蒜鸟玩偶”与“# 适用人群：脆皮省电人”，整体青春有趣。',
    description: '完整描述促销海报排版、文案与配色。',
    inputHint: '可上传玩偶实拍作为主体参考。',
    outputNote: '需突出玩偶可爱度，文字信息清晰可读。',
    keywords: ['电商促销', '毛绒玩具', '蒜鸟', '浅蓝渐变', 'slogan']
  },
  {
    id: 'poster-slippers',
    scene: '商品营销',
    commandType: '商品图包装',
    title: '粉色拖鞋温馨包装',
    nodeKind: 'image',
    prompt: '制作粉色拖鞋海报：顶部橙色粗体写“居家幸福感拉满！”，带白色描边并有同色系衬底。拖鞋周围点缀星星与小兔子，与拖鞋图案呼应，并给拖鞋添加白色粗描边。画面内写三条文案“踩屎感谁懂！”“懒人必备神器”“少女心爆棚啦”，白字黑描边。背景是模糊的木质地板，色调与粉色拖鞋及米色杯子协调，营造温馨居家感。',
    description: '突出卖点标签与可爱包装感。',
    inputHint: '上传拖鞋产品图，可含兔子元素。',
    outputNote: '整体柔和温暖，同时突出主标题与拖鞋主体。',
    keywords: ['商品包装', '拖鞋', '橙色粗体', '文案布局', '木质背景']
  },
  {
    id: 'style-polaroid',
    scene: '写真风格化',
    commandType: '拍立得风格',
    title: '拍立得相纸质感',
    nodeKind: 'image',
    prompt: '将照片转化为拍立得风格：白色不对称边框、暗朦淡彩、轻微过曝与模糊晕染，保留主体对焦，整体低饱和、胶片颗粒、Y2K 复古质感，捕捉随意抓拍的现场感。',
    description: '适用写真/旅行照复古化。',
    inputHint: '提供原始照片，最好是人物或生活场景。',
    outputNote: '需有明显拍立得外框和颗粒细节。',
    keywords: ['拍立得', 'Polaroid', '复古', '胶片', 'Y2K', '颗粒']
  }
]

type PromptScore = { sample: PromptSample; score: number }

/**
 * 简易关键字匹配，帮助 AI 助手根据用户描述挑选合适的案例提示词
 */
export function matchPromptSamples(query: string | undefined | null, limit = 3): PromptSample[] {
  const haystack = (query || '').trim().toLowerCase()
  if (!haystack) return []

  const scored: PromptScore[] = PROMPT_SAMPLES.map(sample => {
    let score = 0
    const normalizedPrompt = sample.prompt.toLowerCase()
    const normalizedTitle = sample.title.toLowerCase()
    const normalizedScene = sample.scene.toLowerCase()
    const normalizedCommand = sample.commandType.toLowerCase()

    if (haystack.includes(normalizedTitle)) score += 3
    if (haystack.includes(normalizedScene)) score += 1
    if (haystack.includes(normalizedCommand)) score += 2
    if (haystack.includes(normalizedPrompt.slice(0, Math.min(12, normalizedPrompt.length)))) score += 1

    for (const keyword of sample.keywords) {
      if (!keyword) continue
      const normalizedKeyword = keyword.toLowerCase()
      if (normalizedKeyword && haystack.includes(normalizedKeyword)) {
        score += 3
      }
    }

    // 兜底：若描述中出现“风格”“海报”等通用词，适度加权场景
    if (score === 0) {
      const fallbackSignals: Array<[string, number]> = [
        ['海报', sample.scene.includes('海报') ? 1.5 : 0.5],
        ['风格', sample.scene.includes('风格') ? 1.4 : 0.3],
        ['商品', sample.scene.includes('商品') ? 1.2 : 0],
        ['文字', sample.scene.includes('文字') ? 1.2 : 0],
      ]
      fallbackSignals.forEach(([token, weight]) => {
        if (!weight) return
        if (haystack.includes(token)) {
          score += weight
        }
      })
    }

    return { sample, score }
  }).filter(entry => entry.score > 0)

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.sample)
}

export function formatPromptSample(sample: PromptSample): string {
  const lines = [
    `【${sample.scene}｜${sample.commandType}】${sample.title}`,
    `节点：${sample.nodeKind}`,
    `Prompt：${sample.prompt}`
  ]
  if (sample.outputNote) {
    lines.push(`效果：${sample.outputNote}`)
  }
  if (sample.inputHint) {
    lines.push(`输入建议：${sample.inputHint}`)
  }
  return lines.join('\n')
}

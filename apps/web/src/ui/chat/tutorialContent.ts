export type AiChatTutorialStep = {
  id: string
  difficulty: '入门' | '进阶' | '高阶' | '实战'
  title: string
  caseTitle: string
  summary: string
  sceneType: string
  sceneDescription: string
  coreAction: string
  whyThisStep: string
  statesToCheck: string[]
  promptStarter: string
  successSignals: string[]
  nextStep: string
}

export type AiChatTutorialContent = {
  sourceTitle: string
  sourceSummary: string
  methodology: string[]
  steps: AiChatTutorialStep[]
}

const WORKFLOW_STATE_FIELDS = [
  'reference_assets_ready',
  'character_identity_locked',
  'environment_anchor_locked',
  'camera_change_scope_single',
  'video_keyframe_confirmed',
  'continuity_risk_detected',
] as const

const WORKFLOW_ACTION_GUIDANCE = [
  'create_base_frame: 先建立一张权威基底帧，锁定角色、环境、色调与关键道具。',
  'change_camera_angle: 在不改主体设定的前提下，只改变一个镜头角度。',
  'switch_to_pov: 切换到 POV 镜头，并明确 POV 属于谁。',
  'review_continuity: 先诊断连续性问题属于角色、环境还是背景噪声。',
  'prepare_video_keyframe: 确认当前图像已经足够稳定，适合作为视频关键帧。',
  'generate_video_motion: 基于关键帧只增加被批准的动作与镜头运动。',
] as const

const tutorialSteps: AiChatTutorialStep[] = [
  {
    id: 'stable-base-frame',
    difficulty: '入门',
    title: '1. 建立权威基底帧',
    caseTitle: '稳定世界观起手式',
    summary: '先把角色身份、环境锚点、道具和整体氛围锁死，再进入镜头扩展。',
    sceneType: 'start_new_scene',
    sceneDescription: '从零开始创建一个新的可复用场景参考。',
    coreAction: 'create_base_frame',
    whyThisStep: '没有稳定基底帧时，后续扩镜、POV 和视频都会把多个变量混在一起，连续性会先天不稳。',
    statesToCheck: ['reference_assets_ready', 'character_identity_locked', 'environment_anchor_locked'],
    promptStarter: '先帮我建立一张权威基底帧：明确场景地点、主体身份、关键道具、整体色调与材质，不要加入复杂动作，也不要改镜头逻辑。',
    successSignals: ['主体身份稳定', '环境锚点明确', '色调与材质统一'],
    nextStep: 'change_camera_angle',
  },
  {
    id: 'single-variable-camera',
    difficulty: '进阶',
    title: '2. 单变量扩展镜头',
    caseTitle: '稳定图扩镜',
    summary: '已有稳定参考图后，扩镜时只改变机位，不要同时改主体、环境和动作。',
    sceneType: 'expand_stable_image_to_shots',
    sceneDescription: '基于稳定图片扩展新的镜头视角。',
    coreAction: 'change_camera_angle',
    whyThisStep: '镜头变化本质上是单变量编辑。把其他约束写死，才能避免“换机位时顺手换了角色和环境”。',
    statesToCheck: ['character_identity_locked', 'environment_anchor_locked', 'camera_change_scope_single'],
    promptStarter: '基于当前稳定参考图，帮我扩展一个新机位。保持角色身份、环境锚点、空间关系和色调不变，只改变镜头角度与景别。',
    successSignals: ['主体没有漂移', '环境结构保持一致', '机位变化清晰且单一'],
    nextStep: 'switch_to_pov',
  },
  {
    id: 'continuity-review-before-video',
    difficulty: '高阶',
    title: '3. 进视频前先做连续性审查',
    caseTitle: '图像连续性收口',
    summary: '视频节点不负责修图。进入视频阶段前，先确认角色、场景与构图都已经稳定。',
    sceneType: 'repair_continuity',
    sceneDescription: '在 image space 中先处理连续性问题，再决定是否进入 video。',
    coreAction: 'review_continuity',
    whyThisStep: '连续性问题一旦带进视频，会被时间维度放大，修复成本远高于在静帧阶段处理。',
    statesToCheck: ['continuity_risk_detected', 'character_identity_locked', 'environment_anchor_locked'],
    promptStarter: '请先判断当前是否存在角色漂移、环境漂移或背景噪声问题。如果有，只选择一个最关键的问题修复，不要同时动多个变量。',
    successSignals: ['漂移原因被明确指出', '本轮只修一个问题', '修复后仍保持原场景设定'],
    nextStep: 'prepare_video_keyframe',
  },
  {
    id: 'video-from-approved-keyframe',
    difficulty: '实战',
    title: '4. 用确认后的关键帧生成视频',
    caseTitle: '关键帧到视频',
    summary: '视频只负责时间上的运动表达，不负责重写角色、世界观和镜头语言。',
    sceneType: 'convert_keyframe_to_video',
    sceneDescription: '把已确认的关键帧转换为短视频镜头。',
    coreAction: 'generate_video_motion',
    whyThisStep: '先图后动可以把静态设定和动态设定拆开，避免模型在同一步里既重画内容又发明运动。',
    statesToCheck: ['video_keyframe_confirmed', 'character_identity_locked', 'environment_anchor_locked'],
    promptStarter: '基于已确认的关键帧生成短视频。只允许发生被批准的动作与镜头运动，禁止新增人物动作、场景漂移、额外角色或未声明的道具。',
    successSignals: ['动作边界清楚', '镜头运动可控', '角色与场景保持稳定'],
    nextStep: 'review_continuity',
  },
]

export const AI_CHAT_TUTORIAL_CONTENT: AiChatTutorialContent = {
  sourceTitle: 'TapCanvas Workflow Tutorial',
  sourceSummary: '这里保留一组固定教程，概括 TapCanvas 在图像到视频工作流中的核心编排原则，不再依赖 ai-metadata 生成。',
  methodology: [
    '先锁世界，再做镜头。先拿到一张权威基底帧，再继续扩镜与视频化。',
    '每次只改一个变量。机位、POV、道具状态和动作边界要拆步处理。',
    '把不变项写出来。角色身份、环境锚点、空间关系和色调都要显式冻结。',
    '先图后动。视频阶段只负责运动，不负责重定义角色、环境和镜头逻辑。',
  ],
  steps: tutorialSteps,
}

export const AI_CHAT_WORKFLOW_SYSTEM_PROMPT = [
  '【TapCanvas Workflow Orchestrator 能力】',
  '你默认掌握 TapCanvas 的通用创作编排方法，不依赖外部 ai-metadata。',
  '处理 AI 创作、分镜、连续性、多镜头扩展、图转视频时，必须优先按下面的步骤思考：',
  '1. 先识别 scene type：start_new_scene / expand_stable_image_to_shots / repair_continuity / convert_keyframe_to_video / repair_video_drift。',
  `2. 再检查状态字段：${WORKFLOW_STATE_FIELDS.join(', ')}。`,
  '3. 每一步只选择一个核心动作，不要混合多个动作同时推进。',
  '4. 输出时优先说明：当前场景类型、状态判断、本步动作、为什么是它、下一步候选动作。',
  '5. 遇到连续性问题时，先在 image space 修复，再决定是否进入 video。禁止静默降级。',
  '6. 默认遵守：先锁世界，再做镜头；每次只改一个变量；把不变项写出来；先图后动。',
  '7. 处理长镜头视频时，优先保留“文本节点 -> 视频节点”的中间层：把逐镜头文本拆成多个文本节点，再连接到视频节点。这样同一组镜头文本既能合并为 12 秒，也能拆成多个 5 秒短视频。',
  '动作目录：',
  ...WORKFLOW_ACTION_GUIDANCE.map((item) => `- ${item}`),
].join('\n\n')

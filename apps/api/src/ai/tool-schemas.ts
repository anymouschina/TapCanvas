import { z } from 'zod'

/**
 * Canvas 工具的共用协议定义（后端用）
 * - 用于构建 LLM tools schema（function calling）
 * - 描述的是前端真实可执行的能力，但文件仅在后端使用，避免前端编译依赖 zod
 */

export const canvasToolSchemas = {
  getNodes: {
    description:
      '获取当前画布节点列表（前端实际读取节点列表，用于让 AI 感知当前画布状态）。' +
      '对于 image 节点，返回的数据中会包含其绑定的图像模型配置，例如 Nano Banana（Gemini 2.5 Flash Image）与 Nano Banana Pro（Gemini 3 Pro Image）等：' +
      'Nano Banana 更偏向“快速模式”，适合日常图像生成与编辑、社交媒体与草稿场景，强调低延迟和高吞吐；' +
      'Nano Banana Pro 面向专业级输出，支持更高分辨率（2K/4K）、更复杂控制与多图合成、文字渲染与信息图生成，更适合广告、品牌、印刷与需要高规格输出的场景。',
    inputSchema: z.object({})
  },
  createNode: {
    description:
      '创建新节点。type 是“逻辑节点类型”，会在前端映射为 taskNode + 对应 kind 并挂上默认/已配置模型；与视频相关的新内容统一使用 composeVideo，storyboard 仅保留兼容，禁止新建。text 类型已下线，请不要再使用 type=text 创建节点。\n' +
      '常见取值含义：\n' +
      '- image：图像生成/强化节点，适合同一角色/场景的定妆照、设定图，以及从长篇剧情拆出的 storyboard stills 供视频节点引用（支持文生图与图生图）；推荐模型包括 Nano Banana（Gemini 2.5 Flash Image）、Nano Banana Pro（Gemini 3 Pro Image）、Qwen Image Plus、DALL·E 3、Stable Diffusion XL 等。' +
      '其中 Nano Banana 强调“快速/Flash”，适合日常创意、社交媒体、小型设计和大量草稿生成；Nano Banana Pro 面向专业级输出，支持更高分辨率（2K/4K）、更精细的文字渲染与信息图/图表生成、更强的多图合成与角色一致性控制，适合作为广告、品牌资产、印刷等高要求场景的最终稿模型。\n' +
      '- composeVideo：视频镜头节点，封装 Sora 2 / Veo 3.1 等模型，负责短片分镜（单节点默认 ≤10 秒）以及基于参考帧/上一段视频的续写与 Remix，新视频内容一律使用 composeVideo；擅长基于 image 节点的参考帧做文生/图生视频，并保持角色/物理细节连贯。针对 Sora2，prompt 中应显式描述：\n' +
      '  - 镜头运动：如 camera: dolly-in close-up, slow tracking shot, crane up/down, steadycam, cinematic zoom 等，否则可能出现“镜头僵硬/乱动”。\n' +
      '  - 物理模拟：如 realistic physics: gravity, inertia, air resistance, cloth/fluid simulation; environment interaction: dust, water ripples, wind response，用于强化斗篷、烟雾、血浆、脚步水渍等细节。\n' +
      '  - 角色稳定：例如 consistent character identity: char_xxx; do not change face shape, hairstyle, clothing, proportions; use all references to lock character identity，避免脸型/服装在多帧中漂移。\n' +
      '  - 时序连贯：例如 temporal consistency: strong, no morphing, no sudden changes, no visual drift, stable lighting and proportions，减少溶图与跳帧。\n' +
      '  - 动作分解与构图：在 action phases 中分解 anticipiation / attack / impact / follow-through，并结合 composition: rule of thirds, leading lines, dramatic contrast; lighting: rim light, volumetric fog 等摄影语言，让画面更具电影感。\n' +
      '- audio：音频节点，用于生成旁白/配音/环境声草稿，可根据 text/composeVideo 节点的脚本或场景描述生成英文 TTS 提示词；底层依赖已配置的 TTS 模型，适合快速预览配音与氛围声。\n' +
      '- subtitle：字幕/时间轴节点，从 text/composeVideo 节点的对话与解说中提取字幕行和时间信息，方便导出字幕文件；通常由 Gemini/DeepSeek/Claude 等文本模型驱动，擅长分句与节奏控制。\n' +
      '- character：角色卡节点，集中管理角色 @username、外观描述、性格标签、口头禅等，供文本/图像/视频节点在 prompt 中引用以保持角色一致性；推荐使用 Gemini / Claude / GPT-4o 生成或优化人设文案。\n' +
      '- textToImage：显式指定图像生成 kind 的形式，等价于 image 节点的图像生成能力（文生图/图生图），同样适配 Nano Banana / Qwen Image Plus 等视觉模型。\n' +
      '- storyboard：历史兼容类型，当前禁止创建新的 storyboard 节点，如需分镜请使用多个 composeVideo 节点按镜头拆分。',
    inputSchema: z.object({
      type: z.string().describe('逻辑节点类型，例如 image/composeVideo/character/textToImage 等'),
      label: z.string().optional().describe('节点显示名称，可选'),
      config: z
        .record(z.any())
        .optional()
        .describe('节点配置（包含 prompt、negativePrompt、keywords 等业务字段）'),
      remixFromNodeId: z
        .string()
        .optional()
        .describe('Remix 来源节点 ID，仅允许引用已成功的 composeVideo/video/storyboard 节点'),
      position: z
        .object({ x: z.number(), y: z.number() })
        .optional()
        .describe('期望的初始坐标，由前端最终裁决')
    })
  },
  connectNodes: {
    description: '连接两个节点（sourceNodeId → targetNodeId），前端负责校验连线合法性并实际创建 Edge。',
    inputSchema: z.object({
      sourceNodeId: z.string().describe('源节点 ID'),
      targetNodeId: z.string().describe('目标节点 ID')
    })
  },
  runDag: {
    description: '执行当前画布工作流（DAG）。应谨慎使用，只在用户明确要求“全图执行”时调用。',
    inputSchema: z.object({
      concurrency: z
        .number()
        .optional()
        .describe('可选并发度，具体策略由前端/执行层决定')
    })
  },
  runNode: {
    description: '执行单个节点，避免整图执行；适合“只跑这个镜头/这个图像节点”的场景。',
    inputSchema: z.object({
      nodeId: z.string().describe('要执行的节点 ID')
    })
  },
  formatAll: {
    description: '对当前所有节点做自动布局（智能排版），通常在用户抱怨“画布太乱”或大规模编辑后调用。',
    inputSchema: z.object({})
  },
  findNodes: {
    description:
      '按标签或类型查找节点，用于“先看一眼画布里有什么节点/角色/镜头”再决定后续操作，避免凭空假设。type 对应节点的 kind 字段（例如 image/composeVideo/textToImage/character）。',
    inputSchema: z.object({
      label: z.string().optional().describe('模糊匹配的标签关键字'),
      type: z.string().optional().describe('逻辑类型，例如 image/composeVideo/character/textToImage')
    })
  },
  deleteNode: {
    description:
      '删除指定节点。应在回复中提醒用户删除的影响（下游连线/依赖会被一并移除），避免误删关键节点。',
    inputSchema: z.object({
      nodeId: z.string().describe('要删除的节点 ID')
    })
  },
  updateNode: {
    description:
      '更新节点配置/标题。常用于“为节点写入 prompt/negativePrompt/keywords”等操作，前端会负责日志记录与字段归一化。',
    inputSchema: z.object({
      nodeId: z.string().describe('目标节点 ID'),
      label: z.string().optional().describe('新的节点标题，可选'),
      config: z
        .record(z.any())
        .optional()
        .describe('要写入的配置字段，例如 prompt、negativePrompt、keywords 等')
    })
  },
  disconnectNodes: {
    description:
      '断开一条连线。适用于“拆开这两个节点”“打断当前数据流”等场景，前端会根据 edgeId 删除具体的 Edge。',
    inputSchema: z.object({
      edgeId: z.string().describe('需要断开的 Edge ID')
    })
  },
  autoLayout: {
    description:
      '对节点进行自动布局排列，通常在用户觉得“画布太乱”或批量创建/删除节点后使用；layoutType 决定网格/水平/层次等布局策略。',
    inputSchema: z.object({
      layoutType: z
        .string()
        .describe('布局类型，例如 grid（网格）、horizontal（水平）、hierarchical（层次）')
    })
  }
} as const

export type CanvasToolName = keyof typeof canvasToolSchemas

export type CanvasToolInput<TName extends CanvasToolName> =
  (typeof canvasToolSchemas)[TName] extends { inputSchema: infer TSchema }
    ? TSchema extends z.ZodTypeAny
      ? z.infer<TSchema>
      : never
    : never

/**
 * 节点类型与模型特性的共用说明（后端用，仅作元数据）
 */
export const canvasNodeSpecs = {
  text: {
    kind: 'text',
    role: 'prompt_and_script',
    description:
      '（历史兼容）文本/脚本/分镜描述节点，用于剧情构思、台词、旁白、提示词打磨和长文拆解。当前不再支持通过 createNode 创建新的 text 节点，仅保留读取/展示已有数据的兼容能力。',
    recommendedModels: ['Gemini 2.5 Flash', 'Gemini 2.5 Pro', 'Claude 3.5 Sonnet', 'GPT-4o', 'DeepSeek V3'],
    capabilities: [
      '长文剧情解析与分镜草稿',
      '英文 prompt 生成与润色（不含中文）',
      '角色小传、设定表、世界观文档',
      '字幕草稿/旁白脚本输出'
    ],
    notes:
      '写入节点 config.prompt 时必须使用自然英文；中文说明只放在聊天回复里，不写入节点字段。'
  },
  image: {
    kind: 'image',
    role: 'still_frame_and_reference',
    description:
      '图像生成/强化节点，用于角色定妆照、场景设定图以及从长篇剧情中抽取分镜垫图（storyboard stills）。',
    recommendedModels: ['Nano Banana Pro', 'Nano Banana Fast', 'Qwen Image Plus', 'DALL·E 3', 'Stable Diffusion XL'],
    capabilities: [
      '文生图：根据英文 prompt 直接生成关键帧画面',
      '图生图：基于上游图片或视频帧做风格/细节强化',
      '从长剧情拆解出若干关键 stills 供视频节点引用'
    ],
    notes:
      '单个 image 节点设计为承载有限数量的高价值垫图；需要大量 stills 时应拆分为多个 image 节点，并用连线表达顺序或依赖。'
  },
  composeVideo: {
    kind: 'composeVideo',
    role: 'video_shot',
    description:
      '统一的视频镜头节点，封装 Sora 2 / 自建 Sora2API / Veo 3.1 等模型，负责短片分镜（单节点默认 ≤10 秒）与续写、Remix。',
    recommendedModels: ['Sora 2', 'Sora2API (self-hosted)', 'Veo 3.1 Pro', 'Veo 3.1 Fast', 'Runway Gen-3'],
    capabilities: [
      '文本 → 视频（单镜头）',
      '图像/帧 → 视频续写（img2vid）',
      '基于上一段视频 Remux/继续拍摄',
      '基于 image 节点提供的参考帧锁定角色/构图'
    ],
    notes:
      '新视频内容一律使用 composeVideo；storyboard 仅保留兼容，不得作为新建类型。单节点默认最长 10 秒，长剧情必须拆成多个 composeVideo 节点按镜头执行。' +
      '当画布绑定了自建的 Sora2API 厂商（vendor=sora2api）时，composeVideo 节点可通过统一任务通道直接调用本地 Sora2API 的 /v1/chat/completions 接口完成文生视频。'
  },
  audio: {
    kind: 'audio',
    role: 'voice_and_sfx',
    description: '音频生成节点，用于旁白、角色对白试音、环境声与音效草稿。',
    recommendedModels: ['TTS 模型（依实际配置而定）'],
    capabilities: [
      '根据脚本生成多角色对白',
      '根据场景描述生成环境音/氛围声',
      '简单音效预览（脚步、开门、风雨等）'
    ],
    notes:
      'prompt 中需用英文明确语气、性别、情绪和环境；复杂配音/混音流程仍由外部 DAW 处理，这里只负责草稿级别。'
  },
  subtitle: {
    kind: 'subtitle',
    role: 'text_timeline',
    description: '字幕/时间轴节点，用于从脚本或视频内容中提取字幕行并附带时间信息。',
    recommendedModels: ['Gemini 2.5 Flash', 'DeepSeek V3', 'Claude 3.5 Sonnet'],
    capabilities: [
      '将对话脚本拆分为字幕行',
      '生成简单的时间轴建议（起止时间）',
      '支持多语言字幕草稿'
    ],
    notes:
      '适合作为下游字幕文件导出的中间节点，最终打包/烧录字幕可在外部工具完成。'
  },
  character: {
    kind: 'character',
    role: 'persona_card',
    description:
      '角色卡节点，用于集中管理角色 @username、外观描述、性格标签、口头禅等，供文本/图像/视频节点引用。',
    recommendedModels: ['Gemini 2.5 Flash', 'Claude 3.5 Sonnet', 'GPT-4o'],
    capabilities: [
      '为剧情中的角色生成统一的人设与外观描述',
      '作为 prompt 中的 @username 引用源，保证多镜头角色一致性',
      '支撑多角色 ensemble cast 的分配与调度'
    ],
    notes:
      '当画布存在 character 节点时，下游 composeVideo/text/image 节点应优先引用对应 @username，而不是在 prompt 中重新发明角色名字。'
  }
} as const

export type CanvasNodeKind = keyof typeof canvasNodeSpecs

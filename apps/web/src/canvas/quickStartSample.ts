import type { Edge, Node } from '@xyflow/react'

type QuickStartFlow = {
  nodes: Node[]
  edges: Edge[]
}

export type QuickStartStarterKey =
  | 'scene-image'
  | 'image-to-video'
  | 'storyboard-sequence'
  | 'project-text-scene'

export type QuickStartStarterDefinition = {
  key: QuickStartStarterKey
  title: string
  description: string
  outcome: string
  cta: string
  action: 'flow' | 'open_nano_comic_workbench'
}

const baseTextNode = (id: string, x: number, y: number, label: string, prompt: string): Node => ({
  id,
  type: 'taskNode',
  position: { x, y },
  data: {
    label,
    kind: 'text',
    prompt,
    nodeWidth: 360,
  },
})

const baseImageNode = (
  id: string,
  x: number,
  y: number,
  label: string,
  prompt: string,
  extraData?: Record<string, unknown>,
): Node => ({
  id,
  type: 'taskNode',
  position: { x, y },
  data: {
    label,
    kind: 'image',
    prompt,
    aspectRatio: '16:9',
    nodeWidth: 320,
    ...extraData,
  },
})

const baseVideoNode = (id: string, x: number, y: number, label: string, prompt: string): Node => ({
  id,
  type: 'taskNode',
  position: { x, y },
  data: {
    label,
    kind: 'video',
    prompt,
    videoDurationSeconds: 5,
    videoOrientation: 'landscape',
    nodeWidth: 320,
  },
})

const baseStoryboardNode = (id: string, x: number, y: number, label: string, prompt: string): Node => ({
  id,
  type: 'taskNode',
  position: { x, y },
  data: {
    label,
    kind: 'storyboard',
    prompt,
    videoDurationSeconds: 5,
    videoOrientation: 'landscape',
    nodeWidth: 340,
  },
})

const edge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  type: 'typed',
  animated: true,
})

const QUICK_START_STARTERS: ReadonlyArray<QuickStartStarterDefinition> = [
  {
    key: 'scene-image',
    title: '一句话出图',
    description: '从一句场景描述直接生成第一张参考图，适合第一次体验画布与图片能力。',
    outcome: '得到一个“文案 -> 图片”的最小工作流',
    cta: '创建图片 Starter',
    action: 'flow',
  },
  {
    key: 'image-to-video',
    title: '首帧转视频',
    description: '先生成一张关键帧，再把它接到视频节点，适合快速理解多节点协作。',
    outcome: '得到一个“关键帧 -> 视频”的起步流程',
    cta: '创建视频 Starter',
    action: 'flow',
  },
  {
    key: 'storyboard-sequence',
    title: '分镜草案',
    description: '从简短脚本进入分镜节点，适合新手理解脚本如何变成镜头设计。',
    outcome: '得到一个“脚本 -> 分镜”的分镜 Starter',
    cta: '创建分镜 Starter',
    action: 'flow',
  },
  {
    key: 'project-text-scene',
    title: '从上传文本开场景',
    description: '这是 TapCanvas 更有辨识度的路径。直接进入漫剧工作台，在那里上传项目文本并继续推进场景创作。',
    outcome: '进入工作台，先上传文本，再直接从章节推进场景工作流',
    cta: '进入工作台',
    action: 'open_nano_comic_workbench',
  },
]

const quickStartFlows: Record<QuickStartStarterKey, QuickStartFlow> = {
  'scene-image': {
    nodes: [
      baseTextNode(
        'starter-scene-brief',
        120,
        150,
        '场景一句话',
        '黄昏海边木栈道，一位穿风衣的女生独自站在路灯下，海风吹起衣摆，电影感，柔和逆光，适合做第一张世界观定帧。',
      ),
      baseImageNode(
        'starter-scene-image',
        540,
        130,
        '首张参考图',
        '基于输入场景做一张稳定的首张参考图。先锁定人物、环境和整体光线，不要加入复杂动作。',
      ),
    ],
    edges: [edge('starter-edge-scene-image', 'starter-scene-brief', 'starter-scene-image')],
  },
  'image-to-video': {
    nodes: [
      baseImageNode(
        'starter-video-keyframe',
        120,
        132,
        '关键帧',
        '未来感城市天桥夜景，主角站在霓虹灯牌前，雨后地面有反射，构图稳定，适合作为短视频首帧。',
      ),
      baseVideoNode(
        'starter-video-compose',
        556,
        124,
        '5 秒短视频',
        '基于输入关键帧制作一个 5 秒镜头。只允许轻微推镜、角色呼吸和衣摆摆动，禁止生成新角色或改动场景结构。',
      ),
    ],
    edges: [edge('starter-edge-image-video', 'starter-video-keyframe', 'starter-video-compose')],
  },
  'storyboard-sequence': {
    nodes: [
      baseTextNode(
        'starter-story-script',
        104,
        128,
        '三句脚本',
        '镜头 1：主角推开便利店门，夜雨未停。\n镜头 2：她停在饮料柜前，看到玻璃上自己的倒影。\n镜头 3：手机震动，她回头看向门外一辆突然停下的黑车。',
      ),
      baseStoryboardNode(
        'starter-storyboard',
        564,
        118,
        '分镜草案',
        '基于输入脚本先输出连续的 3 个镜头分镜。每个镜头说明景别、机位、动作重点和情绪变化，保持同一人物与同一场景连续性。',
      ),
    ],
    edges: [edge('starter-edge-storyboard', 'starter-story-script', 'starter-storyboard')],
  },
  'project-text-scene': {
    nodes: [],
    edges: [],
  },
}

const cloneFlow = (flow: QuickStartFlow): QuickStartFlow => JSON.parse(JSON.stringify(flow)) as QuickStartFlow

export function listQuickStartStarterDefinitions(): QuickStartStarterDefinition[] {
  return QUICK_START_STARTERS.map((item) => ({ ...item }))
}

export function getQuickStartSampleFlow(key: QuickStartStarterKey = 'scene-image'): QuickStartFlow {
  return cloneFlow(quickStartFlows[key])
}

import type { ChapterFilmSpec } from './nodes/taskNode/ChapterFilmSpecModal'

export const CHAPTER_FILM_EXECUTION_TOOL_NAMES = [
  'record_user_intent',
  'Skill',
  'tapcanvas_book_chapter_get',
  'tapcanvas_image_refs_get',
  'tapcanvas_material_assets_list',
	'tapcanvas_equipped_workflow_run',
] as const

export const CHAPTER_FILM_CHAT_DISPLAY_TEXT = '生成当前章节整片'
export const TEXT_NODE_FILM_CHAT_DISPLAY_TEXT = '将当前文本节点制作成视频'
export const CANVAS_NODE_FILM_CHAT_DISPLAY_TEXT = '生成当前节点整片'

export function buildChapterFilmExecutionToolPolicy(): {
  mode: 'restricted'
  allowedTools: string[]
} {
  return {
    mode: 'restricted',
    allowedTools: [...CHAPTER_FILM_EXECUTION_TOOL_NAMES],
  }
}

// Only carry the user's goal and explicit scope. The agents runtime and loaded
// workflow skill own evidence planning, tool selection, and production steps.
export const CHAPTER_FILM_CHAT_TEXT =
  '完成用户刚刚发起的当前章节一键成片任务。用户在这个入口明确要求的交付范围只有：使用当前已装备的一键成片工作流生成最终版完整成片（executionScope=media_delivery，executionVariant=full_video），并把真实成片写回当前章节画布；首视频、中间片段、提示词包或文字说明都不是最终交付。媒体模型、画幅、分辨率、总时长、Clip 数量和逐段时长只允许来自本轮用户明确确认的章级交付字段或已装备 Workflow IR 的权威配置；这个前端入口不得用账号偏好、历史 run、旧成片或本地默认值替用户补写按次覆盖。状态与完成声明只依据真实执行、供应商任务、资产 URL 和最终真实成片 URL。'

export function buildChapterFilmSpecDirective(spec: ChapterFilmSpec): string {
  const adaptationInstruction = spec.adaptationMode === 'creative'
    ? '创意改编：原文是创作底稿而非逐字剧本；保留核心人物身份与关系、世界规则、主线因果、关键结果和可追溯原文台词账本，同时主动设计新增桥段、冲突升级、反转预埋/揭晓、角色选择、视觉奇观、互动/广告/付费等适合成片的表达。新增内容必须服务主线并在同链记录来源锚点、创作理由和新增人声，不要另起平行故事。'
    : '忠实原文：完整保留原文事实、因果与逐字台词，只把内容镜头化并补足可拍的动作承接。'
  return `\n用户已确认的章级交付范围（结构化事实，必须逐项遵守；改编模式是创作合同的一部分）：${JSON.stringify({
    ...spec,
    executionScope: 'media_delivery',
    executionVariant: 'full_video',
  })}\n${adaptationInstruction}`
}

export function buildCanvasNodeFilmChatText(nodeId: string): string {
  return (
    '完成用户刚刚发起的指定文本节点一键成片任务。固定忠实输入文本：完整保留输入事实和逐字台词；动作、神态与画面描述只作为视觉指令，禁止改成旁白。读取该节点、当前项目状态和真实资产，依据已加载 Skill 自主判断证据计划和执行步骤；不得采用本地默认模型、创作路线或工具顺序。只有真实成片 URL 构成交付证据，失败必须显式报告。\n' +
    `事实作用域：${JSON.stringify({ nodeId })}`
  )
}

export function buildPlainTextFilmChatText(nodeId: string, text: string): string {
  return (
    '完成用户刚刚发起的文本节点一键成片任务。固定忠实输入文本：完整保留输入事实和逐字台词；动作、神态与画面描述只作为视觉指令，禁止改成旁白。使用当前项目真实上下文与资产，依据已加载 Skill 自主判断内容领域、证据计划和执行步骤；不得采用本地默认模型、创作路线或工具顺序。只有真实成片 URL 构成交付证据，失败必须显式报告。\n' +
    `事实作用域：${JSON.stringify({ nodeId, text })}`
  )
}

export type VideoClipAgentAction = 'revise_clip' | 'repair_clip' | 'resume_clip'

/**
 * 已进入 canonical video run 的镜头不能由前端直接改 prompt 或直连供应商。
 * 画布只发送用户明确点击的动作建议，agents 仍负责读取事实并选择合法的恢复/修订路径。
 */
export function buildVideoClipAgentActionText(
  nodeId: string,
  action: VideoClipAgentAction,
  runId: string | null,
  clipIndex: number | null,
): string {
  return [
    `处理用户刚刚对画布视频镜头 ${nodeId} 发起的 ${action} 请求。`,
    '这是一个明确的镜头级动作建议，不是本地工具路由；请读取当前节点、所属 run、资产引用职责、连续性事实和真实任务状态，自主判断是否应该修订、恢复、修复或显式失败。',
    JSON.stringify({ nodeId, action, runId, clipIndex }),
    '不得直接覆盖旧 prompt、旧任务或已生成媒体；需要新版本时保留完整 lineage 与交付证据。',
  ].join('\n')
}

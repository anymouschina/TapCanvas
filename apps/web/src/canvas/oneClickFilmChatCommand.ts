export type OneClickFilmFacts = {
  groupId: string
  projectId: string | null
  flowId: string | null
  chapterId: string | null
  recipeId: string
  targetDurationSeconds: number
  videoAspect: string
  requestedVideoModel: string | null
  videoProfileId: string | null
  userBrief: string | null
  referenceImageNodeIds: string[]
}

export const ONE_CLICK_FILM_CHAT_DISPLAY_TEXT = '生成当前画布整片'
export const GROUP_FILM_CHAT_DISPLAY_TEXT = '生成当前组整片'

export function buildOneClickFilmChatText(facts: OneClickFilmFacts): string {
  return [
    '完成用户刚刚在当前画布发起的一键成片任务。',
    '以下只是真实入口事实，不是创作路线或工具顺序；若本轮入口已携带 adaptationMode，则以它为唯一改编合同：faithful 只镜头化来源，creative 在核心人物关系、世界规则、主线因果与关键结果不偏离的前提下允许扩写桥段、对白、冲突、反转、视觉包装和商业化表达；若未携带则按 faithful 兼容旧入口。请读取当前画布与已加载 Skill，自主判断内容领域、证据计划和执行步骤。语义证据不足时显式说明，不得采用本地默认工作流。',
    JSON.stringify(facts),
    '目标是把本组真实内容生产为完整可交付成片，并保留全部真实执行、资产和学习 provenance。生成完成后的复盘只能追加证据，禁止自动返工、覆盖、删除或丢弃资产。',
  ].join('\n')
}

export type GroupFilmFacts = {
  groupId: string
  sourceRecipeId: string | null
  targetDurationSeconds: number | null
  videoAspect: string | null
  videoModel: string | null
  videoProfileId: string | null
}

/**
 * 组节点播放按钮的唯一入口文本。
 * 这里只携带组的结构化事实；画布正文、资产引用和当前 run 由 AiChatDialog 的
 * canonical canvas context 装配，避免在 Web 端复制一条本地视频生产链。
 */
export function buildGroupFilmChatText(facts: GroupFilmFacts): string {
  return [
    '完成用户刚刚在当前画布组节点发起的一键成片任务。',
    '以下只是真实组作用域事实，不是创作路线、工具顺序或本地路由；若用户本轮明确选择 adaptationMode=creative，则在核心人物关系、世界规则、主线因果与关键结果不偏离的前提下允许扩写桥段、对白、冲突、反转、视觉包装和商业化表达；未明确选择时按 faithful 兼容。请读取当前画布与已加载 Skill，自主决定完整 BeatSheet、连续性、资产职责和执行动作。',
    JSON.stringify(facts),
    '必须保留全部已生成资产、任务和交付证据；已受理或已产出媒体不得被覆盖、回滚或丢弃。',
  ].join('\n')
}

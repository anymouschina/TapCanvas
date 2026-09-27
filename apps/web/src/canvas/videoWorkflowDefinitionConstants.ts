import {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
} from '@tapcanvas/video-orchestrator-protocol'
import {
  WORKFLOW_ICON_NODE_COLUMN_STRIDE,
  WORKFLOW_ICON_NODE_ROW_STRIDE,
  WORKFLOW_ICON_NODE_SIZE,
} from './workflowNodeDimensions'

export const NODE_WIDTH = WORKFLOW_ICON_NODE_SIZE
export const NODE_HEIGHT = WORKFLOW_ICON_NODE_SIZE
export const COLUMN_GAP = WORKFLOW_ICON_NODE_COLUMN_STRIDE - WORKFLOW_ICON_NODE_SIZE
export const ROW_GAP = WORKFLOW_ICON_NODE_ROW_STRIDE - WORKFLOW_ICON_NODE_SIZE
export const COLUMN_COUNT = 5
export {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
}
export const VIDEO_WORKFLOW_EXECUTION_CONCURRENCY = 16 as const
/**
 * 结构化 Agent 节点的单次输出额度。
 *
 * 章级 BeatSheet 合同要求在一次终端提交里交付整章 beats + blockingPlans +
 * sequenceControlPlan；一章实测约 3.0–4.3 万 token（含中文 JSON），高于旧的
 * 32768。额度不足时供应商会在到达终端提交前按 length 截断，节点只能重试，
 * 而重试是否成功完全取决于当次是否恰好没有溢出——同一份输入实测要 10 次物理
 * 重试才偶然成功一次，把到视频生成的时间从分钟级推到小时级。
 * 这里取协议上限，让合同产物一次装得下，不依赖重试概率。
 */
export const VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS = 65_536 as const
export const VIDEO_WORKFLOW_MAX_CLIPS_MIN = 1 as const
export const VIDEO_WORKFLOW_MAX_CLIPS_MAX = 1_000 as const
/**
 * 整章一键成片的默认物理片段上限。
 *
 * 上限是每轮生产的成本/规模上界，不是创作目标：实际片段数由作者按章节内容决定，
 * 这里只保证它够用。单 clip 受供应商窗口限制（当前 4–15 秒），一章"完整沉浸版"
 * 成片约 20 分钟即约 80 个片段；默认值低于这个量级会把作者合法的整章计划截断成
 * 半部成片，并让作者在"计划必须覆盖全章"与"只生产前 N 个片段"之间无解。
 */
export const VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS = 80 as const
export const VIDEO_WORKFLOW_CAPABILITY_DESCRIPTION = '读取完整冻结来源，规划一 Clip 一视频节点；章级并行冻结共享资产身份与逐段事件、对白边界，逐 Clip 并行创作视频提示词和图像资产意图，使用视频提示词 Skill 和同媒体知识案例。全章按精确资产身份去重并先持久化共享图片节点、视频节点及依赖边。完整成片模式随后逐 Clip 补齐所需真实图片 URL、提交视频并按来源顺序合片；只生成视频节点模式在节点回读后交付。Agent 失败保留证据并直接暴露，不自动重试或自纠。媒体模型从用户本轮选择或账号偏好和实时目录继承。'


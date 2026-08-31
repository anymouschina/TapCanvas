import React from 'react'
import { toast } from '../toast'
import { useChatCommandStore } from './chatCommandStore'

export const PENDING_SKILL_LAUNCH_STORAGE_KEY = 'tapcanvas.pendingSkillLaunch'

const SKILL_LAUNCH_TIMEOUT_MS = 30_000

export type PendingSkillLaunch = {
  projectId: string
  skillKey: string
  skillName: string
  skillDescription: string
}

type PendingSkillLaunchConsumerProps = {
  currentProjectId: string | null
  projectReady: boolean
}

function readRequiredString(record: Record<string, unknown>, key: keyof PendingSkillLaunch): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parsePendingSkillLaunch(raw: string): PendingSkillLaunch {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Skill 启动上下文不是有效 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Skill 启动上下文必须是对象')
  }
  const record = parsed as Record<string, unknown>
  const projectId = readRequiredString(record, 'projectId')
  const skillKey = readRequiredString(record, 'skillKey')
  const skillName = readRequiredString(record, 'skillName')
  const skillDescription = readRequiredString(record, 'skillDescription')
  if (!projectId || !skillKey || !skillName || !skillDescription) {
    throw new Error('Skill 启动上下文缺少 projectId、skillKey、skillName 或 skillDescription')
  }
  return { projectId, skillKey, skillName, skillDescription }
}

export function buildPendingSkillLaunchPrompt(input: PendingSkillLaunch): string {
  return [
    `请在当前新项目中启动“${input.skillName}”创作。`,
    `该公开 Skill 的已知能力描述：${input.skillDescription}`,
    '请先读取当前真实项目和画布状态；空画布是正常的创作冷启动状态，不是章节成片或资产生成失败。',
    '请由 agents 自主从当前运行时可用的 Skills 中选择能力，并在项目画布中创建本轮可验证的启动工件或提交真实异步任务；不要把公开目录名称当作已安装 Skill，也不要套用章节成片的 BeatSheet、时长、画风锚或最终视频验收条件。',
    '若本轮交付包含用户或 agents 已明确的总视频时长，必须把它作为可核验的交付合同，而不是只写进生成提示词：单段时长、accepted_async、queued/running 或单段 videoUrl 都不表示总时长已满足。若目标超过所选模型的单段动态时长能力，agents 应根据运行时可用工具自主规划多个合法片段及其合成，并只在最终真实媒体的时长满足合同后报告完成。',
    '如果下一步确实依赖用户的创作偏好、素材或授权，请调用 request_user_input 提供 2–3 个可选方向，并保留自由输入选项；用户的选择或输入会在同一项目、同一会话中继续本次创作。不要用“输入不足”作终止性报告，除非已基于真实项目事实无法创建任何启动工件。',
    '禁止编造用户输入、伪造资产、默认填充故事或把异步任务报成已完成。',
  ].join('\n')
}

export function PendingSkillLaunchConsumer(props: PendingSkillLaunchConsumerProps): null {
  const { currentProjectId, projectReady } = props
  const launchRef = React.useRef<PendingSkillLaunch | null>(null)
  const invalidRef = React.useRef(false)

  React.useEffect(() => {
    const raw = window.sessionStorage.getItem(PENDING_SKILL_LAUNCH_STORAGE_KEY)
    if (!raw) return
    try {
      launchRef.current = parsePendingSkillLaunch(raw)
    } catch (error: unknown) {
      invalidRef.current = true
      window.sessionStorage.removeItem(PENDING_SKILL_LAUNCH_STORAGE_KEY)
      toast(error instanceof Error ? error.message : 'Skill 启动上下文无效', 'error')
    }
  }, [])

  React.useEffect(() => {
    const launch = launchRef.current
    if (!launch || invalidRef.current) return
    if (!projectReady || currentProjectId !== launch.projectId) return

    useChatCommandStore.getState().dispatchSend({
      text: buildPendingSkillLaunchPrompt(launch),
      displayText: `启动“${launch.skillName}”`,
      attachCanvasContext: true,
    })
    window.sessionStorage.removeItem(PENDING_SKILL_LAUNCH_STORAGE_KEY)
    launchRef.current = null
    toast(`已在新项目中启动“${launch.skillName}”`, 'success')
  }, [currentProjectId, projectReady])

  React.useEffect(() => {
    if (!launchRef.current || invalidRef.current) return
    const timer = window.setTimeout(() => {
      const launch = launchRef.current
      if (!launch) return
      window.sessionStorage.removeItem(PENDING_SKILL_LAUNCH_STORAGE_KEY)
      launchRef.current = null
      const mismatch = Boolean(currentProjectId && currentProjectId !== launch.projectId)
      toast(mismatch ? 'Skill 启动失败：当前项目与目标项目不一致' : 'Skill 启动失败：目标项目画布未在限定时间内加载完成', 'error')
    }, SKILL_LAUNCH_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [currentProjectId])

  return null
}

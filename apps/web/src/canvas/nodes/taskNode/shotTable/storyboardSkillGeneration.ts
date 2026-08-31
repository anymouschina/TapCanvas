import type { ShotTableColumn, ShotTableData } from '@tapcanvas/shot-table-protocol'
import {
  buildShotTableOutputContract,
  buildShotTableTextReviewContract,
  parseShotTableText,
  STORYBOARD_EXPERT_SKILL_KEY as SHARED_STORYBOARD_EXPERT_SKILL_KEY,
} from '@tapcanvas/shot-table-protocol'
import {
  agentsChat,
  listPublicAgentSkills,
  type AgentSkillDto,
  type AgentsChatRequestDto,
  type AgentsChatResponseDto,
} from '../../../../api/server'
import {
  toAgentsChatModelPayload,
  type SelectedChatModelRequest,
} from '../../../../ui/chat/chatModelSelection'

export const STORYBOARD_EXPERT_SKILL_KEY = SHARED_STORYBOARD_EXPERT_SKILL_KEY

const STORYBOARD_SKILL_EXECUTION_TOOLS = [
  'read_file',
  'read_file_range',
  'tapcanvas_shot_table_critic',
] as const

export type StoryboardExpertSkill = Pick<AgentSkillDto, 'id' | 'key' | 'name'>

export type StoryboardSkillSource =
  | {
      kind: 'script'
      text: string
    }
  | {
      kind: 'video_evidence'
      text: string
      userFocus: string
    }

export type StoryboardSkillGenerationInput = {
  nodeId: string
  columns: readonly ShotTableColumn[]
  source: StoryboardSkillSource
  languageModel: SelectedChatModelRequest
  preflightSkill?: StoryboardExpertSkill
}

export type StoryboardSkillGenerationResult = {
  table: ShotTableData
  rawText: string
  model: string
  skillKey: string
  skillName: string
}

type StoryboardSkillGenerationDependencies = {
  listSkills: () => Promise<AgentSkillDto[]>
  runAgents: (payload: AgentsChatRequestDto) => Promise<AgentsChatResponseDto>
  createRunId: () => string
}

const defaultDependencies: StoryboardSkillGenerationDependencies = {
  listSkills: listPublicAgentSkills,
  runAgents: agentsChat,
  createRunId: () => {
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
      throw new Error('当前浏览器不支持安全 UUID，无法创建隔离的分镜 Skill 会话。')
    }
    return crypto.randomUUID()
  },
}

const readFailureReasons = (response: AgentsChatResponseDto): string => {
  const reasons = response.trace?.turnVerdict?.reasons ?? []
  const diagnostics = (response.trace?.diagnosticFlags ?? []).map((flag) => {
    const detail = flag.detail.trim()
    return detail ? `${flag.code}：${detail}` : flag.code
  })
  const toolStatus = response.trace?.toolStatusSummary
  const toolFailureSummary = toolStatus && (
    toolStatus.failedToolCalls > 0
    || toolStatus.deniedToolCalls > 0
    || toolStatus.blockedToolCalls > 0
  )
    ? `工具状态 failed=${toolStatus.failedToolCalls}, denied=${toolStatus.deniedToolCalls}, blocked=${toolStatus.blockedToolCalls}`
    : ''
  return [...reasons, ...diagnostics, toolFailureSummary]
    .map((reason) => reason.trim())
    .filter(Boolean)
    .filter((reason, index, values) => values.indexOf(reason) === index)
    .join('；')
}

export const resolveStoryboardExpertSkill = (skills: readonly AgentSkillDto[]): StoryboardExpertSkill => {
  const matches = skills.filter((skill) => skill.key === STORYBOARD_EXPERT_SKILL_KEY)
  if (matches.length === 0) {
    throw new Error(`未安装必需的官方 Skill：${STORYBOARD_EXPERT_SKILL_KEY}。`)
  }
  if (matches.length > 1) {
    throw new Error(`官方 Skill 目录存在重复 key：${STORYBOARD_EXPERT_SKILL_KEY}。`)
  }
  const skill = matches[0]
  if (!skill) throw new Error(`无法解析官方 Skill：${STORYBOARD_EXPERT_SKILL_KEY}。`)
  if (!skill.enabled || !skill.visible) {
    throw new Error(`必需的官方 Skill 当前不可执行：${STORYBOARD_EXPERT_SKILL_KEY}。`)
  }
  return { id: skill.id, key: skill.key, name: skill.name }
}

export const loadStoryboardExpertSkill = async (
  listSkills: () => Promise<AgentSkillDto[]> = listPublicAgentSkills,
): Promise<StoryboardExpertSkill> => resolveStoryboardExpertSkill(await listSkills())

export const buildStoryboardSkillPrompt = (
  source: StoryboardSkillSource,
  columns: readonly ShotTableColumn[],
): string => {
  const sourceText = source.text.trim()
  if (!sourceText) {
    throw new Error(source.kind === 'script' ? '剧本原文为空，无法生成分镜。' : '视频事实提取结果为空，无法生成分镜。')
  }
  const outputContract = buildShotTableOutputContract(columns)
  const reviewContract = buildShotTableTextReviewContract(source.kind, columns)
  const sourceContract = source.kind === 'script'
    ? '输入是剧本来源。由 Skill 根据来源本身判断是否已经存在锁定的镜头边界，并执行对应的忠实合同；宿主不替代该语义判断。'
    : '输入是对一条既有视频的结构化事实提取结果。锁定已观察到的镜头边界、时间码、时长、台词及可见可听事实；导演性补充不得伪装成原视频事实。'
  const sourceLabel = source.kind === 'script' ? '剧本原文' : '视频事实提取结果'
  const focusSection = source.kind === 'video_evidence' && source.userFocus.trim()
    ? `【用户补充关注点】\n${source.userFocus.trim()}`
    : ''
  return [
    `必须使用已加载的 ${STORYBOARD_EXPERT_SKILL_KEY}，按其中“忠实快节奏分镜”合同完成本次任务。创作与审查判断由 Skill 负责，禁止用宿主模板替代。`,
    '必须先读取该 Skill 为忠实快节奏分支指定的 reference。完成初稿后，只调用一次 tapcanvas_shot_table_critic：reviewMode 必须为 text_storyboard，shotTable 必须是准备交付的完整初稿，sourceMaterial 必须是下方完整来源，reviewContract 必须原样复制下方 JSON。收到结果后应用 topFixes 修订一轮，禁止第二次送审；最终只输出修订后的表格协议正文。',
    `【文本分镜独立审查合同】\n${JSON.stringify(reviewContract)}`,
    sourceContract,
    '最终只交付当前分镜表协议文本；表结构是宿主交付合同，字段内的语义质量必须由 Skill 完整负责。',
    outputContract,
    focusSection,
    `【${sourceLabel}】`,
    sourceText,
  ].filter(Boolean).join('\n\n')
}

const assertStoryboardSkillExecution = (
  response: AgentsChatResponseDto,
  skill: StoryboardExpertSkill,
): void => {
  const runtime = response.trace?.runtime
  if (!runtime) throw new Error('Agents 返回结果缺少运行时 Skill 追踪，无法证明分镜 Skill 已执行。')
  if (!runtime.requiredSkills.includes(skill.key)) {
    throw new Error(`Agents 运行时未声明必需 Skill：${skill.key}。`)
  }
  if (!runtime.loadedSkills.includes(skill.key)) {
    throw new Error(`Agents 运行时没有加载必需 Skill：${skill.key}。`)
  }
  const logicalTaskState = response.trace?.logicalTaskState
  if (!logicalTaskState) throw new Error('Agents 返回结果缺少逻辑任务状态，禁止把未验收结果写入分镜表。')
  if (logicalTaskState.status !== 'succeeded') {
    const reasons = readFailureReasons(response)
    throw new Error(`分镜 Skill 未成功收口：${reasons || logicalTaskState.reasonCode}`)
  }
  const verdict = response.trace?.turnVerdict
  if (!verdict) throw new Error('Agents 返回结果缺少交付验收结论，禁止把未验收结果写入分镜表。')
  if (verdict.status !== 'satisfied') {
    throw new Error(`分镜 Skill 交付未通过：${readFailureReasons(response) || verdict.status}`)
  }
}

export const generateShotTableWithStoryboardSkill = async (
  input: StoryboardSkillGenerationInput,
  dependencies: StoryboardSkillGenerationDependencies = defaultDependencies,
): Promise<StoryboardSkillGenerationResult> => {
  const skill = input.preflightSkill ?? await loadStoryboardExpertSkill(dependencies.listSkills)
  if (skill.key !== STORYBOARD_EXPERT_SKILL_KEY) {
    throw new Error(`分镜生成拒绝执行非指定 Skill：${skill.key}。`)
  }
  const prompt = buildStoryboardSkillPrompt(input.source, input.columns)
  const response = await dependencies.runAgents({
    ...toAgentsChatModelPayload(input.languageModel),
    prompt,
    displayPrompt: input.source.kind === 'script'
      ? `使用 ${skill.name} 将导入剧本转换为分镜表`
      : `使用 ${skill.name} 将视频事实提取结果整理为分镜表`,
    sessionKey: `storyboard-skill:${input.source.kind}:${input.nodeId}:${dependencies.createRunId()}`,
    mode: 'chat',
    requiredSkills: [skill.key],
    executionToolPolicy: {
      mode: 'restricted',
      allowedTools: [...STORYBOARD_SKILL_EXECUTION_TOOLS],
    },
    chatContext: {
      selectedNodeLabel: input.source.kind === 'script' ? '分镜表' : '视频分析',
      selectedNodeKind: input.source.kind === 'script' ? 'shotTable' : 'videoAnalysis',
    },
  })
  assertStoryboardSkillExecution(response, skill)
  const parsed = parseShotTableText(response.text, { expectedColumns: input.columns })
  if (!parsed.ok) throw new Error(`Agents 返回内容不符合分镜表契约：${parsed.issues.join('；')}`)
  const executionModel = response.modelKey?.trim() || response.modelAlias?.trim() || ''
  if (!executionModel) throw new Error('Agents 返回结果缺少实际执行模型，无法记录可追溯版本。')
  return {
    table: parsed.table,
    rawText: response.text.trim(),
    model: executionModel,
    skillKey: skill.key,
    skillName: skill.name,
  }
}

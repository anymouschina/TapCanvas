import { describe, expect, it, vi } from 'vitest'
import { createEmptyShotTable, serializeShotTable } from '@tapcanvas/shot-table-protocol'
import type {
  AgentSkillDto,
  AgentsChatRequestDto,
  AgentsChatResponseDto,
} from '../../../../api/server'
import {
  buildStoryboardSkillPrompt,
  generateShotTableWithStoryboardSkill,
  resolveStoryboardExpertSkill,
  STORYBOARD_EXPERT_SKILL_KEY,
} from './storyboardSkillGeneration'

const skill = (overrides: Partial<AgentSkillDto> = {}): AgentSkillDto => ({
  id: 'skill-storyboard',
  key: STORYBOARD_EXPERT_SKILL_KEY,
  name: 'TapCanvas 分镜专家',
  description: '分镜生成',
  logoUrl: null,
  category: 'storyboard',
  enabled: true,
  visible: true,
  sortOrder: 1,
  createdAt: '2026-08-02T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  ...overrides,
})

const successfulResponse = (text: string): AgentsChatResponseDto => ({
  id: 'agents-result-1',
  vendor: 'agents',
  modelKey: 'gpt-storyboard',
  text,
  trace: {
    runtime: {
      profile: 'general',
      registeredToolNames: [],
      registeredTeamToolNames: [],
      requiredSkills: [STORYBOARD_EXPERT_SKILL_KEY],
      loadedSkills: [STORYBOARD_EXPERT_SKILL_KEY],
      allowedSubagentTypes: [],
      requireAgentsTeamExecution: false,
    },
    turnVerdict: { status: 'satisfied', reasons: ['text_delivery_verified'] },
    requestTerminal: { version: 1, terminal: true, status: 'succeeded', reason: 'text_delivery_verified' },
    logicalTaskState: {
      version: 1,
      logicalTaskId: 'agents-result-1',
      status: 'succeeded',
      reasonCode: 'text_delivery_verified',
      physicalRunStatus: 'completed',
      deliveryStatus: 'satisfied',
      taskNodeId: 'root',
      taskRevision: 1,
      updatedAt: '2026-08-30T04:00:00.000Z',
      continuationTicket: null,
    },
  },
})

describe('storyboard Skill generation', () => {
  it('only resolves the enabled and visible official storyboard expert', () => {
    expect(resolveStoryboardExpertSkill([skill()])).toMatchObject({
      key: STORYBOARD_EXPERT_SKILL_KEY,
      name: 'TapCanvas 分镜专家',
    })
    expect(() => resolveStoryboardExpertSkill([])).toThrow(`未安装必需的官方 Skill：${STORYBOARD_EXPERT_SKILL_KEY}`)
    expect(() => resolveStoryboardExpertSkill([skill({ enabled: false })])).toThrow('当前不可执行')
    expect(() => resolveStoryboardExpertSkill([skill(), skill({ id: 'duplicate' })])).toThrow('存在重复 key')
  })

  it('builds source-specific contracts without moving semantic decisions into the host', () => {
    const columns = createEmptyShotTable().columns
    const scriptPrompt = buildStoryboardSkillPrompt({ kind: 'script', text: '第一场。' }, columns)
    const videoPrompt = buildStoryboardSkillPrompt({
      kind: 'video_evidence',
      text: '【镜头总览】\n素材总时长：15s',
      userFocus: '关注人物反应',
    }, columns)

    expect(scriptPrompt).toContain('“忠实快节奏分镜”合同')
    expect(scriptPrompt).toContain('由 Skill 根据来源本身判断')
    expect(scriptPrompt).toContain('【剧本原文】')
    expect(videoPrompt).toContain('锁定已观察到的镜头边界、时间码、时长、台词及可见可听事实')
    expect(videoPrompt).toContain('reviewMode 必须为 text_storyboard')
    expect(videoPrompt).toContain('【文本分镜独立审查合同】')
    expect(videoPrompt).toContain('"observedVideoCutsAndTiming":"locked"')
    expect(videoPrompt).toContain('【用户补充关注点】\n关注人物反应')
    expect(videoPrompt).toContain('【视频事实提取结果】')
  })

  it('forces requiredSkills, verifies runtime loading, and parses the current table contract', async () => {
    const table = createEmptyShotTable()
    const listSkills = vi.fn(async (): Promise<AgentSkillDto[]> => [skill()])
    const runAgents = vi.fn(async (payload: AgentsChatRequestDto): Promise<AgentsChatResponseDto> => {
      void payload
      return successfulResponse(serializeShotTable(table))
    })

    const result = await generateShotTableWithStoryboardSkill({
      nodeId: 'shot-table-node',
      columns: table.columns,
      source: { kind: 'script', text: '原始剧本。' },
      languageModel: { field: 'modelKey', model: 'gpt-5.6-terra' },
    }, {
      listSkills,
      runAgents,
      createRunId: () => 'run-1',
    })

    expect(listSkills).toHaveBeenCalledOnce()
    const firstCall = runAgents.mock.calls[0]
    if (!firstCall) throw new Error('Agents 测试替身没有收到请求。')
    const capturedPayload = firstCall[0]
    expect(capturedPayload.requiredSkills).toEqual([STORYBOARD_EXPERT_SKILL_KEY])
    expect(capturedPayload.executionToolPolicy).toEqual({
      mode: 'restricted',
      allowedTools: ['read_file', 'read_file_range', 'tapcanvas_shot_table_critic'],
    })
    expect(capturedPayload.canvasProjectId).toBeUndefined()
    expect(capturedPayload.canvasFlowId).toBeUndefined()
    expect(capturedPayload.canvasNodeId).toBeUndefined()
    expect(capturedPayload.modelKey).toBe('gpt-5.6-terra')
    expect(capturedPayload.modelAlias).toBeUndefined()
    expect(capturedPayload.chatContext).toEqual({
      selectedNodeLabel: '分镜表',
      selectedNodeKind: 'shotTable',
    })
    expect(capturedPayload.sessionKey).toBe('storyboard-skill:script:shot-table-node:run-1')
    expect(result.table.columns).toEqual(table.columns)
    expect(result.skillKey).toBe(STORYBOARD_EXPERT_SKILL_KEY)
    expect(result.model).toBe('gpt-storyboard')
  })

  it('fails explicitly when runtime evidence does not show the required Skill', async () => {
    const table = createEmptyShotTable()
    const response = successfulResponse(serializeShotTable(table))
    if (!response.trace?.runtime) throw new Error('测试数据缺少 runtime。')
    response.trace.runtime.loadedSkills = []

    await expect(generateShotTableWithStoryboardSkill({
      nodeId: 'video-analysis-node',
      columns: table.columns,
      source: { kind: 'video_evidence', text: serializeShotTable(table), userFocus: '' },
      languageModel: { field: 'modelAlias', model: 'claude-sonnet-4-6' },
      preflightSkill: resolveStoryboardExpertSkill([skill()]),
    }, {
      listSkills: async () => { throw new Error('不应重新读取目录') },
      runAgents: async () => response,
      createRunId: () => 'run-2',
    })).rejects.toThrow(`没有加载必需 Skill：${STORYBOARD_EXPERT_SKILL_KEY}`)
  })
})

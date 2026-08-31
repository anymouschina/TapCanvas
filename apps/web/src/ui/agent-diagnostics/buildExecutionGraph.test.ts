import { describe, expect, it } from 'vitest'
import type { AgentDiagnosticsTraceDto, AgentExecutionProvenanceDto } from '../../api/server'
import type { LiveChatRunRecord } from '../chat/liveChatRunStore'
import { buildLiveExecutionGraph, buildTraceExecutionGraph, readTraceExecutionProvenance } from './buildExecutionGraph'
import {
  VIDEO_PRODUCTION_WORKFLOW_DEFINITION,
  VIDEO_PRODUCTION_WORKFLOW_NODE_IDS,
} from '@tapcanvas/video-orchestrator-protocol'

const KNOWLEDGE_HASH = `sha256:${'a'.repeat(64)}`
const SKILL_HASH = `sha256:${'b'.repeat(64)}`

const provenance: AgentExecutionProvenanceDto = {
  version: 1,
  executionId: 'exec-1',
  agentId: 'root-agent',
  depth: 0,
  model: 'gpt-5.6',
  apiStyle: 'responses',
  requiredSkills: ['tapcanvas-video-workflow'],
  loadedSkills: ['tapcanvas-video-workflow', 'seedance-camera'],
  loadedSkillResources: [{
    skill: 'tapcanvas-video-workflow',
    resource: 'references/video-prompt-contract.md',
    contentHash: KNOWLEDGE_HASH,
    contentChars: 1024,
  }],
  loadedSkillSources: [{
    skill: 'tapcanvas-video-workflow',
    sourceKind: 'skill',
    source: 'SKILL.md',
    contentHash: SKILL_HASH,
    contentChars: 4096,
  }, {
    skill: 'tapcanvas-video-workflow',
    sourceKind: 'resource',
    source: 'references/video-prompt-contract.md',
    contentHash: KNOWLEDGE_HASH,
    contentChars: 1024,
  }],
  startedAt: '2026-07-23T08:00:00.000Z',
}

function traceWithProvenance(): AgentDiagnosticsTraceDto {
  return {
    id: 'trace-1',
    scopeType: 'project',
    scopeId: 'project-1',
    taskId: 'task-1',
    requestKind: 'agents_bridge:text_to_video',
    inputSummary: 'project=project-1',
    decisionLog: [],
    toolCalls: [{
      toolCallId: 'tool-call-1',
      seq: 1,
      durationMs: 320,
      name: 'tapcanvas_video_orchestrate',
      status: 'succeeded',
      outputPreview: 'scheduled',
      requestedAgentType: 'video_prompt_specialist',
    }],
    meta: {
      executionProvenance: provenance,
      semanticExecutionIntent: {
        detected: true,
        taskKind: 'video_generation',
        requiresExecutionDelivery: true,
      },
      expectedDelivery: { active: true, kind: 'video', reason: 'semantic_execution' },
      deliveryVerification: { applicable: true, status: 'satisfied', code: null, summary: 'video accepted' },
      turnVerdict: { status: 'satisfied', reasons: ['delivery_verified'] },
      requestTerminal: { version: 1, terminal: true, status: 'succeeded', reason: 'delivery_verified' },
    },
    resultSummary: 'completed',
    errorCode: null,
    errorDetail: null,
    createdAt: '2026-07-23T08:00:05.000Z',
    status: 'succeeded',
    sessionKey: 'project:project-1',
    workflowKey: 'public_agents_chat',
    logicalTaskId: 'logical-1',
    rootTraceId: 'trace-1',
    parentTraceId: null,
    physicalRunId: 'run-1',
    workflowRunId: 'workflow-1',
    startedAt: '2026-07-23T08:00:00.000Z',
    updatedAt: '2026-07-23T08:00:05.000Z',
    finishedAt: '2026-07-23T08:00:05.000Z',
    nextEventSeq: 3,
  }
}

function liveRunWithLogs(logCount: number): LiveChatRunRecord {
  return {
    runId: 'run-live-1',
    status: 'active',
    requestText: '生成当前章节视频',
    displayText: '生成当前章节视频',
    projectId: 'project-1',
    projectName: 'Project',
    flowId: 'flow-1',
    sessionKey: 'session-key',
    skillName: '',
    requestId: 'request-1',
    sessionId: 'session-1',
    userMessageId: 'message-1',
    startedAt: 1,
    updatedAt: 2,
    finishedAt: null,
    errorMessage: '',
    doneReason: '',
    assistantPreview: '',
    assetCount: 0,
    todoItems: [],
  executionProvenance: null,
  attentionProjection: null,
    logs: Array.from({ length: logCount }, (_, index) => ({
      id: `tool-log-${index}`,
      event: 'tool',
      title: `tool-${index} started`,
      detail: 'started',
      at: index + 1,
      toolActivity: {
        toolCallId: `tool-call-${index}`,
        toolName: `tool-${index}`,
        phase: 'started' as const,
        status: undefined,
        severity: undefined,
        startedAt: new Date(index + 1).toISOString(),
      },
    })),
  }
}

describe('AI execution graph', () => {
  it('projects historical traces into seven bounded stages and keeps provenance in context details', () => {
    const trace = traceWithProvenance()
    const graph = buildTraceExecutionGraph(trace)

    expect(readTraceExecutionProvenance(trace)).toEqual(provenance)
    expect(graph.layout).toBe('bounded_workflow')
    expect(graph.nodes).toHaveLength(7)
    expect(graph.edges).toHaveLength(6)
    expect(graph.activePathNodeCount).toBeLessThanOrEqual(7)
    expect(graph.provenanceState).toBe('complete')
    expect(graph.knowledgeSourceCount).toBe(3)
    expect(graph.skillCount).toBe(2)
    expect(graph.nodes.find((node) => node.id === 'history-context')).toMatchObject({
      title: '真实上下文',
      primaryItems: ['skills 2', 'references 1'],
      details: expect.arrayContaining([
        expect.objectContaining({ label: 'executionProvenance', value: expect.stringContaining('video-prompt-contract.md') }),
      ]),
    })
  })

  it('aggregates every tool and delegated role into the action-stage payload', () => {
    const trace = traceWithProvenance()
    trace.toolCalls = Array.from({ length: 124 }, (_, index) => ({
      toolCallId: `tool-${index}`,
      seq: index + 1,
      name: index % 2 === 0 ? 'tapcanvas_video_orchestrate' : 'knowledge_search',
      status: index === 80 ? 'failed' : 'succeeded',
      requestedAgentType: index % 3 === 0 ? 'video_prompt_specialist' : undefined,
      input: { query: `query-${index}` },
    }))

    const graph = buildTraceExecutionGraph(trace)
    const execution = graph.nodes.find((node) => node.id === 'history-execution')

    expect(graph.nodes).toHaveLength(7)
    expect(execution).toMatchObject({
      status: 'failed',
      summary: '124 次工具调用 · 1 类委派',
      badges: ['tools 124', 'failed 1'],
      details: expect.arrayContaining([
        expect.objectContaining({ label: 'toolCalls', value: expect.stringContaining('tool-123') }),
        expect.objectContaining({ label: 'requestedAgentTypes', value: 'video_prompt_specialist' }),
      ]),
    })
  })

  it('aggregates persisted async runs and assets into factual evidence without fan-out nodes', () => {
    const trace = traceWithProvenance()
    trace.meta = {
      ...trace.meta,
      asyncExecutionRuns: [{
        runId: 'video-run-1',
        state: 'video_running',
        authoringState: 'authoring_done',
        totalClips: 12,
        clipsDone: 5,
        artifacts: Array.from({ length: 12 }, (_, index) => ({ artifactKey: `clip:${index}`, status: 'ready' })),
      }],
    }

    const graph = buildTraceExecutionGraph(trace)

    expect(graph.nodes).toHaveLength(7)
    expect(graph.nodes.find((node) => node.id === 'history-evidence')).toMatchObject({
      status: 'warning',
      summary: '1 个异步 run · 12 项资产事实',
      badges: ['runs 1', 'artifacts 12'],
      details: expect.arrayContaining([
        expect.objectContaining({ label: 'asyncExecutionRuns', value: expect.stringContaining('clip:11') }),
      ]),
    })
    expect(graph.nodes.find((node) => node.id === 'history-result')).toMatchObject({ status: 'warning' })
  })

  it('uses the persisted one-click workflow projection when structured workflow facts exist', () => {
    const trace = traceWithProvenance()
    trace.meta = {
      ...trace.meta,
      asyncExecutionRuns: [{
        runId: 'video-run-bounded',
        state: 'concatenated',
        authoringState: 'authoring_done',
        totalClips: 100,
        clipsDone: 100,
        artifacts: [{
          artifactKey: 'clip:0',
          status: 'ready',
          promptAssembly: {
            version: 2,
            artifactKey: 'clip:0',
            clipIndex: 0,
            state: 'complete',
            assemblySummary: '合同 → 事实 → Skill → shots → 编译器 → 资产',
            steps: [{
              id: 'lock-contracts',
              order: 1,
              title: '锁定合同',
              explanation: '先锁定用户和供应商合同。',
              sourceIds: ['user-intent'],
            }],
            sources: [{
              id: 'user-intent',
              label: '用户意图合同',
              kind: 'user_contract',
              ref: 'BeatSheet.meta.userIntentContract',
              status: 'applied',
              summary: '已验签。',
            }],
            contractSnapshot: {
              sourceSpanText: '原文跨度',
              dialogueScriptJson: '[]',
              temporalContextJson: null,
              sceneStateJson: null,
              characterStatesJson: null,
              characterStateVersionsJson: null,
              startKeyframe: null,
              endKeyframe: null,
              previousExitState: null,
              exitState: null,
              writerOutputJson: '{}',
            },
            finalPrompt: {
              label: '执行提示词投影',
              characterCount: 12,
              text: '镜1：角色转身。',
              hash: 'sha256:prompt',
            },
          },
        }],
        workflow: {
          workflowKey: 'one-click-production/v1',
          definitionVersion: 1,
          workflowRunId: 'video-run-bounded',
          latestEventSeq: 10_000,
          nodes: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.nodes.map((definition) => ({
            workflowRunId: 'video-run-bounded',
            workflowNodeId: definition.nodeId,
            status: 'succeeded',
            completedUnits: definition.nodeId === 'clip-contracts' || definition.nodeId === 'media-production' ? 100 : 1,
            totalUnits: definition.nodeId === 'clip-contracts' || definition.nodeId === 'media-production' ? 100 : 1,
            inputArtifactIds: [],
            outputArtifactIds: definition.nodeId === 'media-production'
              ? Array.from({ length: 100 }, (_, index) => `video-result:${index}`)
              : [`${definition.nodeId}:output`],
            effectIds: definition.nodeId === 'media-production'
              ? Array.from({ length: 100 }, (_, index) => `effect:${index}`)
              : [],
            errorCount: 0,
            timing: {
              startedAt: '2026-08-10T11:59:00.000Z',
              updatedAt: '2026-08-10T12:00:00.000Z',
              finishedAt: '2026-08-10T12:00:00.000Z',
              durationMs: 60_000,
            },
            latestEventSeq: 10_000,
          })),
        },
      }],
    }

    const graph = buildTraceExecutionGraph(trace)

    expect(graph.layout).toBe('bounded_workflow')
    expect(graph.nodes).toHaveLength(7)
    expect(graph.nodes.map((node) => node.id)).toEqual(VIDEO_PRODUCTION_WORKFLOW_NODE_IDS)
    expect(graph.nodes.find((node) => node.id === 'media-production')).toMatchObject({
      summary: '100/100 项事实已完成',
      primaryItems: ['产物 100', '副作用 100', '错误 0'],
      timing: {
        elapsedMs: 60_000,
        live: false,
      },
    })
    expect(graph.nodes.find((node) => node.id === 'clip-contracts')).toMatchObject({
      primaryItems: ['产物 1', '副作用 0', '错误 0', '提示词 1'],
      promptAssemblies: [expect.objectContaining({
        artifactKey: 'clip:0',
        state: 'complete',
        finalPrompt: expect.objectContaining({ hash: 'sha256:prompt' }),
      })],
    })
  })

  it('marks legacy history unavailable while retaining factual historical Skill calls', () => {
    const trace = traceWithProvenance()
    trace.meta = {
      agentsRuntime: { loadedSkills: ['tapcanvas-video-workflow', 'tapcanvas-api'] },
      requestTerminal: { version: 1, terminal: true, status: 'succeeded', reason: 'validated_result' },
    }
    trace.toolCalls = [{ name: 'Skill', status: 'succeeded', input: { skill: 'tapcanvas-dramatic-adapter' } }]

    const graph = buildTraceExecutionGraph(trace)

    expect(graph.provenanceState).toBe('partial')
    expect(graph.skillCount).toBe(3)
    expect(graph.knowledgeSourceCount).toBe(0)
    expect(graph.nodes.find((node) => node.id === 'history-context')).toMatchObject({
      status: 'unavailable',
      summary: '仅保留历史 Skill 事实',
      details: expect.arrayContaining([
        expect.objectContaining({ label: 'historicalSkills', value: expect.stringContaining('tapcanvas-dramatic-adapter') }),
      ]),
    })
  })

  it('rejects malformed nested provenance without crashing the bounded graph', () => {
    const trace = traceWithProvenance()
    trace.meta = { executionProvenance: { ...provenance, loadedSkillResources: [{ skill: 'tapcanvas-video-workflow' }] } }

    expect(readTraceExecutionProvenance(trace)).toBeNull()
    expect(buildTraceExecutionGraph(trace)).toMatchObject({
      provenanceState: 'legacy_unavailable',
      layout: 'bounded_workflow',
      nodes: expect.any(Array),
    })
    expect(buildTraceExecutionGraph(trace).nodes).toHaveLength(7)
  })

  it('keeps any number of live events inside the same seven-stage envelope', () => {
    const run = liveRunWithLogs(124)
    const graph = buildLiveExecutionGraph(run, 125_000)

    expect(graph.layout).toBe('bounded_workflow')
    expect(graph.nodes).toHaveLength(7)
    expect(graph.edges).toHaveLength(6)
    expect(graph.activePathNodeCount).toBeLessThanOrEqual(7)
    expect(graph.timing).toMatchObject({ elapsedMs: 124_999, live: true })
    expect(graph.nodes.find((node) => node.id === 'live-execution')).toMatchObject({
      summary: '124 次调用 · 0 次局部失败 · 124 次执行中',
      badges: ['调用 124', '失败 0', '委派 0'],
      timing: {
        elapsedMs: 124_999,
        live: true,
      },
    })
  })

  it('keeps the action-stage clock running between completed tool calls', () => {
    const run = liveRunWithLogs(1)
    run.logs.push({
      id: 'tool-log-completed',
      event: 'tool',
      title: 'tool-0 completed',
      detail: 'completed',
      at: 2_000,
      toolActivity: {
        toolCallId: 'tool-call-0',
        toolName: 'tool-0',
        severity: undefined,
        phase: 'completed',
        status: 'succeeded',
        startedAt: new Date(1).toISOString(),
        finishedAt: new Date(2_000).toISOString(),
        durationMs: 1_999,
      },
    })

    const graph = buildLiveExecutionGraph(run, 10_000)
    expect(graph.nodes.find((node) => node.id === 'live-execution')?.timing).toMatchObject({
      elapsedMs: 9_999,
      live: true,
    })
  })

  it('keeps local tool failures as stage warnings while the logical task is still running', () => {
    const run = liveRunWithLogs(1)
    run.logs.push({
      id: 'tool-log-completed',
      event: 'tool',
      title: 'tapcanvas_video_orchestrate completed',
      detail: 'status: failed',
      reason: 'Tool arguments do not match the exact loaded operation schema.',
      tone: 'error',
      at: 3,
      toolActivity: {
        toolCallId: 'tool-call-0',
        toolName: 'tapcanvas_video_orchestrate',
        phase: 'completed',
        status: 'failed',
        severity: 'error',
        startedAt: '2026-08-10T06:47:14.000Z',
        finishedAt: '2026-08-10T06:47:14.120Z',
        durationMs: 120,
        input: { args: { mode: 'repair_assets', bindings: [] } },
        outputPreview: JSON.stringify({
          ok: false,
          code: 'catalog_tool_arguments_invalid',
          message: 'Tool arguments do not match the exact loaded operation schema.',
          issues: [
            { path: '$.assetBindings', keyword: 'required', message: '$.assetBindings is required' },
            { path: '$.bindings', keyword: 'additionalProperties', message: '$.bindings is not allowed' },
          ],
        }),
      },
    })

    const graph = buildLiveExecutionGraph(run)
    const execution = graph.nodes.find((node) => node.id === 'live-execution')

    expect(graph.status).toBe('running')
    expect(execution).toMatchObject({
      status: 'warning',
      summary: '1 次调用 · 1 次局部失败 · 0 次执行中',
      diagnostics: {
        taskStatus: 'running',
        invocations: [expect.objectContaining({
          toolCallId: 'tool-call-0',
          operation: 'mode=repair_assets',
          status: 'failed',
          errorCode: 'catalog_tool_arguments_invalid',
          issues: [
            expect.objectContaining({ path: '$.assetBindings', keyword: 'required' }),
            expect.objectContaining({ path: '$.bindings', keyword: 'additionalProperties' }),
          ],
        })],
      },
    })
  })

  it('diagnoses accepted async work as waiting instead of a failed delivery', () => {
    const trace = traceWithProvenance()
    trace.status = 'waiting_async'
    trace.finishedAt = null
    trace.meta = {
      ...trace.meta,
      completionTrace: {
        version: 1,
        source: 'async_submission',
        terminal: 'suspended',
        allowFinish: false,
        failureReason: null,
        rationale: '供应商已经受理，等待真实资产证据。',
        successCriteria: ['持久资产 URL'],
        missingCriteria: ['持久资产 URL'],
        requiredActions: ['查询已受理任务并记录资产证据'],
      },
      deliveryVerification: {
        applicable: true,
        status: 'unsatisfied',
        criteria: [{ requirementId: 'asset-url', status: 'unresolved', evidenceIds: [] }],
      },
      requestTerminal: { version: 1, terminal: true, status: 'suspended', reason: 'waiting_for_evidence' },
    }

    const graph = buildTraceExecutionGraph(trace)

    expect(graph.nodes.find((node) => node.id === 'history-verification')?.status).toBe('warning')
    expect(graph.nodes.find((node) => node.id === 'history-result')?.status).toBe('warning')
    expect(graph.diagnosis).toMatchObject({
      state: 'waiting',
      headline: '已取得进度，正在等待新证据',
      actionable: true,
      missingCriteria: ['持久资产 URL', 'asset-url'],
      requiredActions: ['查询已受理任务并记录资产证据'],
    })
  })

  it('projects explicit terminal failure without hiding the recorded repair facts', () => {
    const trace = traceWithProvenance()
    trace.status = 'failed'
    trace.errorCode = 'safe_paths_exhausted'
    trace.errorDetail = '所有已授权安全路径均已耗尽。'
    trace.meta = {
      ...trace.meta,
      completionTrace: {
        terminal: 'failure',
        allowFinish: false,
        failureReason: 'safe_paths_exhausted',
        rationale: '无法取得要求的真实交付证据。',
        missingCriteria: ['真实交付资产'],
        requiredActions: [],
      },
      deliveryVerification: { applicable: true, status: 'unsatisfied', criteria: [] },
      requestTerminal: { version: 1, terminal: true, status: 'failed', reason: 'safe_paths_exhausted' },
    }

    const graph = buildTraceExecutionGraph(trace)

    expect(graph.diagnosis.state).toBe('failed')
    expect(graph.diagnosis.missingCriteria).toEqual(['真实交付资产'])
    expect(graph.diagnosis.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'safe_paths_exhausted', severity: 'error' }),
    ]))
  })
})

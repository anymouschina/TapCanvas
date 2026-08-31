import { beforeEach, describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'

import type { AgentsChatResponseDto } from '../../api/server'
import type { AgentsChatTurnStatusDto } from '../../api/agentsChatTurn'
import type { AgentLogicalTaskStateV1 } from '@tapcanvas/agent-observability'
import { useLiveChatRunStore } from './liveChatRunStore'

function responseWithTerminal(
  requestTerminal: NonNullable<NonNullable<AgentsChatResponseDto['trace']>['requestTerminal']>,
): AgentsChatResponseDto {
  const succeededDeliveryChain = requestTerminal?.status === 'succeeded'
    ? {
        expectedDelivery: {
          active: true as const,
          kind: 'text' as const,
          source: 'agents_cli_user_intent_contract' as const,
          reason: 'frozen_user_intent_contract',
          contractHash: 'sha256:live-chat-run-test',
        },
        deliveryEvidence: {
          version: 2 as const,
          items: [],
          artifacts: [],
          assetCount: 0,
          imageAssetCount: 0,
          videoAssetCount: 0,
          wroteCanvas: false,
          generatedAssets: false,
        },
        deliveryVerification: {
          version: 2 as const,
          contractHash: 'sha256:live-chat-run-test',
          status: 'satisfied' as const,
          criteria: [],
          verifiedAt: '2026-08-23T00:00:00.000Z',
        },
      }
    : {}
  return {
    id: 'response-1',
    vendor: 'agents',
    text: '已处理',
    trace: {
      outputMode: 'text_only',
      requestTerminal,
      logicalTaskState: buildLogicalTaskState(
        requestTerminal.status === 'needs_input'
          ? 'waiting_input'
          : requestTerminal.status === 'suspended'
            ? 'waiting_external'
            : requestTerminal.status,
        requestTerminal.reason,
      ),
      ...succeededDeliveryChain,
    },
  }
}

function buildLogicalTaskState(
  status: AgentLogicalTaskStateV1['status'],
  reasonCode: string | null,
  physicalRunStatus: AgentLogicalTaskStateV1['physicalRunStatus'] = 'completed',
): AgentLogicalTaskStateV1 {
  return {
    version: 1,
    logicalTaskId: 'request-1',
    status,
    reasonCode: reasonCode || status,
    physicalRunStatus,
    deliveryStatus: status === 'succeeded' ? 'satisfied' : status === 'failed' || status === 'cancelled' ? 'unsatisfied' : 'pending',
    taskNodeId: 'turn-1',
    taskRevision: 1,
    updatedAt: '2026-08-04T06:21:30.896Z',
    continuationTicket: null,
  }
}

function startRun(): void {
  useLiveChatRunStore.getState().startRun({
    runId: 'run-1',
    requestId: 'request-1',
    requestText: '执行请求',
    sessionKey: 'session-1',
  })
}

function terminalSnapshot(
  state: 'failed' | 'succeeded' | 'needs_input' | 'suspended' | 'cancelled' | 'unknown',
  reasonCode: string | null,
): AgentsChatTurnStatusDto {
  return {
    sessionId: 'session-1',
    durable: true,
    activeTurn: false,
    turn: {
      turnId: 'request-1',
      internalTurnId: 'turn-1',
      state,
      logicalTaskState: buildLogicalTaskState(
        state === 'needs_input' ? 'waiting_input' : state === 'suspended' ? 'waiting_external' : state === 'unknown' ? 'failed' : state,
        reasonCode,
        state === 'suspended' ? 'handed_off' : state === 'unknown' ? 'interrupted' : 'completed',
      ),
      phase: state === 'unknown'
        ? 'agent_running'
        : state === 'needs_input'
          ? 'waiting_for_input'
          : state === 'cancelled'
            ? 'failed'
            : state,
      startedAt: '2026-08-04T06:19:31.000Z',
      updatedAt: '2026-08-04T06:21:30.896Z',
      lastConfirmedAt: '2026-08-04T06:21:30.896Z',
      requestText: '执行请求',
      reasonCode,
      suspension: null,
      lastConfirmedSummary: state === 'unknown' ? '上次任务未正常收尾，当前已无执行进程' : `当前回合已${state}`,
      finalResponse: state === 'succeeded' ? '真实最终答复' : null,
      ...(state === 'succeeded'
        ? {
            terminalDelivery: {
              version: 1 as const,
              requestTerminal: {
                version: 1 as const,
                terminal: true as const,
                status: 'succeeded' as const,
                reason: 'delivery_verification_satisfied',
              },
              expectedDelivery: { version: 2 as const, contractHash: 'contract-1' },
              deliveryEvidence: [{
                evidenceId: 'runtime-final-response',
                kind: 'final_response' as const,
                sourceRef: 'final_response',
              }],
              deliveryVerification: {
                version: 2 as const,
                contractHash: 'contract-1',
                status: 'satisfied' as const,
                verifiedAt: '2026-08-04T06:21:30.896Z',
              },
            },
          }
        : {}),
      pendingQueueCount: 0,
      recentEvents: [],
    },
  }
}

function activeContinuationSnapshot(): AgentsChatTurnStatusDto {
  return {
    sessionId: 'session-1',
    durable: true,
    activeTurn: true,
    turn: {
      turnId: 'request-1',
      internalTurnId: 'turn-continuation-2',
      state: 'running',
      logicalTaskState: buildLogicalTaskState('active', 'agent_running', 'running'),
      phase: 'agent_running',
      startedAt: '2026-08-04T06:21:31.000Z',
      updatedAt: '2026-08-04T06:21:32.000Z',
      lastConfirmedAt: '2026-08-04T06:21:32.000Z',
      requestText: '继续同一逻辑任务',
      reasonCode: null,
      suspension: null,
      lastConfirmedSummary: '正在执行：tapcanvas_video_orchestrate',
      finalResponse: null,
      pendingQueueCount: 0,
      recentEvents: [],
    },
  }
}

describe('liveChatRunStore request terminal contract', () => {
  beforeEach(() => {
    useLiveChatRunStore.setState({ activeRun: null })
  })

  it('retains an explicitly declared workflow key without inferring it from request text', () => {
    useLiveChatRunStore.getState().startRun({
      runId: 'run-workflow',
      requestId: 'request-workflow',
      requestText: '执行请求',
      workflowKey: 'one-click-production/v1',
    })

    expect(useLiveChatRunStore.getState().activeRun?.workflowKey).toBe('one-click-production/v1')
  })

  it('keeps a nonterminal stream failure suspended instead of projecting task failure', () => {
    startRun()
    useLiveChatRunStore.getState().recordEvent({
      event: 'error',
      data: {
        message: '受理状态未知，等待同 turn 对账',
        code: 'agents_bridge_acceptance_unknown',
        terminal: false,
        scope: 'transport',
        retryability: 'unknown',
        acceptanceKnown: false,
        sideEffectOutcomeKnown: false,
        recovery: { kind: 'status_reconcile', referenceId: 'request-1' },
      },
    })

    expect(useLiveChatRunStore.getState().activeRun).toMatchObject({
      status: 'active',
      errorMessage: '',
    })
  })

  it.each([
    ['succeeded', 'succeeded', 'delivery_verified'],
    ['failed', 'failed', 'delivery_verification_failed'],
    ['needs_input', 'waiting_input', 'request_user_input_pending'],
    ['suspended', 'waiting_external', 'async_execution_suspended_until_delivery_verified'],
  ] as const)('projects legacy diagnostic %s onto canonical logical status %s', (status, expectedStatus, reason) => {
    startRun()

    useLiveChatRunStore.getState().completeRun(
      responseWithTerminal({ version: 1, terminal: true, status, reason }),
    )

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe(expectedStatus)
    expect(run?.finishedAt === null).toBe(expectedStatus === 'waiting_input' || expectedStatus === 'waiting_external')
    expect(run?.errorMessage).toBe(status === 'failed' ? reason : '')
  })

  it('fails explicitly when a final response omits logicalTaskState', () => {
    startRun()

    useLiveChatRunStore.getState().completeRun({
      id: 'response-missing-logical-state',
      vendor: 'agents',
      text: '已处理',
      trace: {},
    } as unknown as AgentsChatResponseDto)

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('failed')
    expect(run?.finishedAt).not.toBeNull()
    expect(run?.errorMessage).toBe('logical_task_state_missing')
  })

  it('accepts a server-committed logical success even when legacy diagnostics are also present', () => {
    startRun()

    useLiveChatRunStore.getState().completeRun({
      id: 'response-bare-success',
      vendor: 'agents',
      text: '已经完成',
      trace: {
        logicalTaskState: buildLogicalTaskState('succeeded', 'delivery_verified'),
        requestTerminal: {
          version: 1,
          terminal: true,
          status: 'succeeded',
          reason: 'delivery_verified',
        },
      },
    })

    expect(useLiveChatRunStore.getState().activeRun).toMatchObject({
      status: 'succeeded',
      errorMessage: '',
    })
  })

  it('reconciles a persisted running record from the durable terminal snapshot', () => {
    startRun()

    useLiveChatRunStore.getState().reconcileTurnStatus(
      terminalSnapshot('failed', 'chat_turn_user_interrupt'),
    )

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('cancelled')
    expect(run?.finishedAt).toBe(Date.parse('2026-08-04T06:21:30.896Z'))
    expect(run?.doneReason).toBe('chat_turn_user_interrupt')
    expect(run?.logs[run.logs.length - 1]?.event).toBe('run.cancelled')
  })

	it('accepts the server-committed logical success without re-arbitrating durable evidence', () => {
    startRun()
    const bareSuccess = terminalSnapshot('succeeded', null)
    if (bareSuccess.turn) delete bareSuccess.turn.terminalDelivery

    useLiveChatRunStore.getState().reconcileTurnStatus(bareSuccess)

		expect(useLiveChatRunStore.getState().activeRun).toMatchObject({ status: 'succeeded' })
  })

  it('repairs an older failed interrupt record during durable reconciliation', () => {
    startRun()
    useLiveChatRunStore.getState().failRun('已中断本次对话。', 'request-1')

    useLiveChatRunStore.getState().reconcileTurnStatus(
      terminalSnapshot('failed', 'chat_turn_user_interrupt'),
    )

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('cancelled')
    expect(run?.errorMessage).toBe('')
    expect(run?.doneReason).toBe('chat_turn_user_interrupt')
  })

  it('reactivates the same public request when a physical-budget continuation is running', () => {
    startRun()
    useLiveChatRunStore.getState().completeRun(
      responseWithTerminal({
        version: 1,
        terminal: true,
        status: 'suspended',
        reason: 'root_physical_execution_budget_exhausted',
      }),
    )

    expect(useLiveChatRunStore.getState().activeRun?.status).toBe('waiting_external')

    useLiveChatRunStore.getState().reconcileTurnStatus(activeContinuationSnapshot())

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('active')
    expect(run?.finishedAt).toBeNull()
    expect(run?.doneReason).toBe('')
    expect(run?.logs[run.logs.length - 1]?.event).toBe('run.resumed')
  })

  it('settles a waiting external public request from its later durable failure', () => {
    startRun()
    useLiveChatRunStore.getState().completeRun(
      responseWithTerminal({
        version: 1,
        terminal: true,
        status: 'suspended',
        reason: 'async_execution_suspended_until_delivery_verified',
      }),
    )

    expect(useLiveChatRunStore.getState().activeRun?.status).toBe('waiting_external')

    useLiveChatRunStore.getState().reconcileTurnStatus(
      terminalSnapshot('failed', 'async_dependency_terminal'),
    )

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('failed')
    expect(run?.finishedAt).toBe(Date.parse('2026-08-04T06:21:30.896Z'))
    expect(run?.doneReason).toBe('async_dependency_terminal')
    expect(run?.errorMessage).toBe('当前回合已failed')
    expect(run?.logs[run.logs.length - 1]?.event).toBe('run.failed')
  })

  it('reactivates a failed physical checkpoint without resetting the logical task timer', () => {
    startRun()
    const originalStartedAt = useLiveChatRunStore.getState().activeRun?.startedAt
    useLiveChatRunStore.getState().failRun('bridge stream closed', 'request-1')

    useLiveChatRunStore.getState().reconcileTurnStatus(activeContinuationSnapshot())

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('active')
    expect(run?.startedAt).toBe(originalStartedAt)
    expect(run?.finishedAt).toBeNull()
    expect(run?.errorMessage).toBe('')
    expect(run?.logs[run.logs.length - 1]?.event).toBe('run.resumed')
  })

  it('does not let a stale active snapshot revive a request the user already cancelled', () => {
    startRun()
    useLiveChatRunStore.getState().cancelRun('已中断本次对话。', 'request-1')

    useLiveChatRunStore.getState().reconcileTurnStatus(activeContinuationSnapshot())

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('cancelled')
    expect(run?.doneReason).toBe('chat_turn_user_interrupt')
    expect(run?.logs[run.logs.length - 1]?.event).toBe('run.cancelled')
  })

  it('accepts the canonical cancelled status projected by the runtime', () => {
    startRun()

    useLiveChatRunStore.getState().reconcileTurnStatus(
      terminalSnapshot('cancelled', 'chat_turn_user_interrupt'),
    )

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('cancelled')
    expect(run?.doneReason).toBe('chat_turn_user_interrupt')
    expect(run?.errorMessage).toBe('')
  })

  it('only lets an interrupt callback fail the matching still-running request', () => {
    startRun()

    useLiveChatRunStore.getState().failRun('迟到的中断', 'request-older')
    expect(useLiveChatRunStore.getState().activeRun?.status).toBe('active')

    useLiveChatRunStore.getState().failRun('本回合已被用户中断。', 'request-1')
    expect(useLiveChatRunStore.getState().activeRun?.status).toBe('failed')
    expect(useLiveChatRunStore.getState().activeRun?.errorMessage).toBe('本回合已被用户中断。')
  })

  it('records a user interrupt as cancelled and clears the live error state', () => {
    startRun()

    useLiveChatRunStore.getState().cancelRun('已中断本次对话。', 'request-1')

    const run = useLiveChatRunStore.getState().activeRun
    expect(run?.status).toBe('cancelled')
    expect(run?.errorMessage).toBe('')
    expect(run?.doneReason).toBe('chat_turn_user_interrupt')
    expect(run?.logs[run.logs.length - 1]?.event).toBe('run.cancelled')
  })

  it('projects materialized delivery evidence as completed without waiting for another canvas event', () => {
    startRun()

    useLiveChatRunStore.getState().completeRun({
      id: 'response-materialized',
      vendor: 'agents',
      text: '视频已完成',
      trace: {
        logicalTaskState: buildLogicalTaskState('succeeded', 'delivery_verified'),
        requestTerminal: {
          version: 1,
          terminal: true,
          status: 'succeeded',
          reason: 'delivery_verified',
        },
        expectedDelivery: {
          active: true,
          kind: 'video',
          source: 'agents_cli_user_intent_contract',
          reason: 'frozen_user_intent_contract',
          contractHash: 'sha256:materialized-video',
        },
        deliveryEvidence: {
          version: 2,
          items: [],
          artifacts: [
            {
              toolCallId: 'tool-accepted',
              toolName: 'tapcanvas_video_generate_to_canvas',
              assetType: 'video',
              deliveryState: 'accepted_async',
              nodeId: 'video-node-1',
              taskId: 'video-task-1',
              runId: null,
              clipIndex: null,
              assetUrl: null,
            },
            {
              toolCallId: 'tool-materialized',
              toolName: 'tapcanvas_video_generate_to_canvas',
              assetType: 'video',
              deliveryState: 'materialized',
              nodeId: 'video-node-1',
              taskId: 'video-task-1',
              runId: null,
              clipIndex: null,
              assetUrl: 'https://assets.example/video.mp4',
            },
          ],
          assetCount: 1,
          imageAssetCount: 0,
          videoAssetCount: 1,
          wroteCanvas: true,
          generatedAssets: true,
        },
        deliveryVerification: {
          version: 2,
          contractHash: 'sha256:materialized-video',
          status: 'satisfied',
          criteria: [],
          verifiedAt: '2026-08-23T00:00:00.000Z',
        },
      },
    })

    expect(useLiveChatRunStore.getState().activeRun?.asyncArtifacts).toEqual([
      expect.objectContaining({
        nodeId: 'video-node-1',
        status: 'succeeded',
        toolCallId: 'tool-materialized',
      }),
    ])
  })

  it('settles a persisted running artifact from a hydrated canvas asset and never regresses it', () => {
    startRun()
    useLiveChatRunStore.getState().completeRun({
      id: 'response-accepted',
      vendor: 'agents',
      text: '后台任务已受理',
      trace: {
        logicalTaskState: buildLogicalTaskState('waiting_external', 'async_execution_suspended_until_delivery_verified', 'handed_off'),
        requestTerminal: {
          version: 1,
          terminal: true,
          status: 'suspended',
          reason: 'async_execution_suspended_until_delivery_verified',
        },
        deliveryEvidence: {
          version: 2,
          items: [],
          artifacts: [{
            toolCallId: 'tool-accepted',
            toolName: 'tapcanvas_video_generate_to_canvas',
            assetType: 'video',
            deliveryState: 'accepted_async',
            nodeId: 'video-node-1',
            taskId: 'video-task-1',
            runId: null,
            clipIndex: null,
            assetUrl: null,
          }],
          assetCount: 0,
          imageAssetCount: 0,
          videoAssetCount: 0,
          wroteCanvas: true,
          generatedAssets: false,
        },
      },
    })

    const runningNode = {
      id: 'video-node-1',
      position: { x: 0, y: 0 },
      data: { kind: 'video', status: 'running' },
    } satisfies Node
    useLiveChatRunStore.getState().reconcileAsyncArtifacts([runningNode])
    expect(useLiveChatRunStore.getState().activeRun?.asyncArtifacts?.[0]?.status).toBe('running')

    const completedNode = {
      ...runningNode,
      data: {
        kind: 'video',
        status: 'success',
        videoUrl: 'https://assets.example/video.mp4',
      },
    } satisfies Node
    useLiveChatRunStore.getState().reconcileAsyncArtifacts([completedNode])
    expect(useLiveChatRunStore.getState().activeRun?.asyncArtifacts?.[0]?.status).toBe('succeeded')

    useLiveChatRunStore.getState().reconcileAsyncArtifacts([runningNode])
    expect(useLiveChatRunStore.getState().activeRun?.asyncArtifacts?.[0]?.status).toBe('succeeded')
  })

	it('does not keep monitoring an artifact whose parent task completed at submission', () => {
		startRun()
		useLiveChatRunStore.getState().completeRun({
			id: 'response-submitted-image',
			vendor: 'agents',
			text: '目标节点已写入并触发后台执行。',
			trace: {
				logicalTaskState: buildLogicalTaskState('succeeded', 'managed_async_submission_completed'),
				requestTerminal: {
					version: 1,
					terminal: true,
					status: 'succeeded',
					reason: 'managed_async_submission_completed',
				},
				expectedDelivery: {
					active: true,
					kind: 'image',
					source: 'agents_cli_user_intent_contract',
					reason: 'frozen_user_intent_contract',
					contractHash: 'sha256:submitted-image',
				},
				deliveryEvidence: {
					version: 2,
					items: [],
					artifacts: [{
						toolCallId: 'tool-image',
						toolName: 'tapcanvas_image_generate_to_canvas',
						assetType: 'image',
						deliveryState: 'accepted_async',
						nodeId: 'image-node-1',
						taskId: 'image-task-1',
						runId: null,
						clipIndex: null,
						assetUrl: null,
						completionBoundary: 'submission',
					}],
					assetCount: 0,
					imageAssetCount: 0,
					videoAssetCount: 0,
					wroteCanvas: true,
					generatedAssets: false,
				},
				deliveryVerification: {
					version: 2,
					contractHash: 'sha256:submitted-image',
					status: 'satisfied',
					criteria: [],
					verifiedAt: '2026-08-26T00:00:00.000Z',
				},
			},
		})

		expect(useLiveChatRunStore.getState().activeRun?.status).toBe('succeeded')
		expect(useLiveChatRunStore.getState().activeRun?.asyncArtifacts).toEqual([])
	})

  it('retains exact structured tool and role activity without inferring from display text', () => {
    startRun()

    useLiveChatRunStore.getState().recordEvent({
      event: 'tool',
      data: {
        toolCallId: 'tool-call-1',
        toolName: 'tapcanvas_video_orchestrate',
        phase: 'started',
        startedAt: '2026-07-23T08:00:00.000Z',
      },
    })
    useLiveChatRunStore.getState().recordEvent({
      event: 'agent_role',
      data: {
        agentId: 'agent-1',
        role: 'video_prompt_specialist',
        roleName: '视频提示词专家',
        description: '负责视频提示词',
        status: 'running',
        progressSummary: '正在写作',
        claimedTaskId: 'task-1',
        at: '2026-07-23T08:00:01.000Z',
      },
    })

    const logs = useLiveChatRunStore.getState().activeRun?.logs ?? []
    expect(logs.find((log) => log.event === 'tool')?.toolActivity).toEqual({
      toolCallId: 'tool-call-1',
      toolName: 'tapcanvas_video_orchestrate',
      phase: 'started',
      status: undefined,
      severity: undefined,
      startedAt: '2026-07-23T08:00:00.000Z',
    })
    expect(logs.find((log) => log.event === 'agent_role')?.roleActivity).toEqual({
      agentId: 'agent-1',
      role: 'video_prompt_specialist',
      roleName: '视频提示词专家',
      description: '负责视频提示词',
      status: 'running',
      progressSummary: '正在写作',
      claimedTaskId: 'task-1',
      at: Date.parse('2026-07-23T08:00:01.000Z'),
    })
  })

  it('records the authorized business tool behind a generic catalog wrapper', () => {
    startRun()

    useLiveChatRunStore.getState().recordEvent({
      event: 'tool',
      data: {
        toolCallId: 'tool-call-wrapper',
        toolName: 'tapcanvas_call_tool',
        input: {
          name: 'tapcanvas_video_orchestrate',
          args: { mode: 'preflight_put_beat' },
        },
        phase: 'started',
        startedAt: '2026-07-23T08:00:00.000Z',
      },
    })

    const toolLog = useLiveChatRunStore.getState().activeRun?.logs.find((log) => log.event === 'tool')
    expect(toolLog?.title).toBe('tapcanvas_video_orchestrate started')
    expect(toolLog?.toolActivity?.toolName).toBe('tapcanvas_video_orchestrate')
  })
})

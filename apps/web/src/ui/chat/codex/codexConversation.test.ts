import { describe, expect, it } from 'vitest'
import type {
  CodexTask,
  CodexTaskMessage,
} from '@tapcanvas/codex-task-protocol'
import { buildCodexTimeline } from './codexConversation'

function taskFixture(overrides: Partial<CodexTask> = {}): CodexTask {
  const task: CodexTask = {
    protocolVersion: 2,
    id: 'task-1',
    sessionId: 'session-1',
    parentTaskId: null,
    turnSequence: 1,
    resumeThreadId: null,
    userId: 'user-1',
    bridgeId: 'bridge-1',
    workspaceId: 'workspace-1',
    workspaceConfigFingerprint: 'a'.repeat(64),
    goal: 'Implement the page',
    context: {
      snapshotId: 'snapshot-1',
      projectId: 'project-1',
      flowId: 'flow-1',
      chapterId: null,
      canvasRevision: 1,
      selectedNodeIds: [],
      selectedNodeKinds: [],
      projectName: 'Project One',
      flowName: 'Flow One',
      nodeCount: 0,
      edgeCount: 0,
      sha256: 'b'.repeat(64),
      createdAt: '2026-07-31T08:00:00.000Z',
    },
    fallbackPolicy: 'disabled',
    state: 'codex_running',
    previewId: 'preview-1234567890',
    idempotencyKey: 'idem-1',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T08:00:30.000Z',
    terminalAt: null,
    lastMessage: 'Codex is editing the workspace',
    expectedDelivery: {
      kind: 'workspace_change_with_verified_preview',
      workspaceId: 'workspace-1',
      requiredEvidence: ['codex_turn', 'tests', 'build', 'preview'],
    },
    deliveryEvidence: {
      source: null,
      codex: null,
      build: null,
      preview: null,
    },
    deliveryVerification: {
      status: 'pending',
      checkedAt: null,
      missingCriteria: ['codex_turn', 'tests', 'build', 'preview'],
      rationale: 'Awaiting evidence',
    },
  }
  return { ...task, ...overrides }
}

function messageFixture(
  overrides: Partial<CodexTaskMessage> = {},
): CodexTaskMessage {
  return {
    id: 'message-1',
    taskId: 'task-1',
    sessionId: 'session-1',
    text: 'Use the compact layout.',
    state: 'queued',
    idempotencyKey: 'message-idem-1',
    createdAt: '2026-07-31T08:00:15.000Z',
    deliveredAt: null,
    detail: '',
    ...overrides,
  }
}

describe('buildCodexTimeline', () => {
  it('projects the initial goal, durable steering, and active status in order', () => {
    const timeline = buildCodexTimeline({
      tasks: [taskFixture()],
      messages: [messageFixture()],
    })

    expect(timeline.map((entry) => [entry.role, entry.content])).toEqual([
      ['user', 'Implement the page'],
      [
        'user',
        'Use the compact layout.\n\n> 等待送达：补充消息已持久化，等待 Bridge 送入当前回合。',
      ],
      ['assistant', 'Codex is editing the workspace'],
    ])
    expect(timeline[1]?.kind).toBe('progress')
    expect(timeline[2]).toMatchObject({
      phase: 'thinking',
      kind: 'progress',
      source: 'codex',
    })
  })

  it('renders a structured user question as the terminal assistant reply', () => {
    const running = taskFixture()
    const task = taskFixture({
      state: 'awaiting_user_input',
      terminalAt: '2026-07-31T08:01:00.000Z',
      expectedDelivery: {
        kind: 'codex_response',
        workspaceId: 'workspace-1',
        requiredEvidence: ['codex_turn'],
      },
      deliveryEvidence: {
        ...running.deliveryEvidence,
        codex: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'completed',
          outcome: 'needs_input',
          changedFiles: [],
          summary: 'Which navigation layout should I implement?',
        },
      },
      deliveryVerification: {
        status: 'satisfied',
        checkedAt: '2026-07-31T08:01:00.000Z',
        missingCriteria: [],
        rationale: 'Verified response',
      },
    })

    const timeline = buildCodexTimeline({ tasks: [task], messages: [] })
    expect(timeline[timeline.length - 1]).toMatchObject({
        role: 'assistant',
        content: 'Which navigation layout should I implement?',
        phase: 'final',
        kind: 'result',
      })
  })

  it('shows a rejected steering message instead of hiding delivery failure', () => {
    const timeline = buildCodexTimeline({
      tasks: [taskFixture()],
      messages: [messageFixture({
        state: 'rejected',
        deliveredAt: '2026-07-31T08:00:20.000Z',
        detail: 'The turn already completed.',
      })],
    })

    expect(timeline[1]?.content).toContain('未送达：The turn already completed.')
    expect(timeline[1]?.kind).toBe('error')
  })

  it('does not misreport an uncertain steering write as delivered or rejected', () => {
    const timeline = buildCodexTimeline({
      tasks: [taskFixture()],
      messages: [messageFixture({
        state: 'unknown',
        deliveredAt: '2026-07-31T08:00:20.000Z',
        detail: 'App Server connection closed before the acknowledgement arrived.',
      })],
    })

    expect(timeline[1]?.content).toContain('送达状态未知：')
    expect(timeline[1]?.content).not.toContain('未送达：')
    expect(timeline[1]?.kind).toBe('error')
  })
})

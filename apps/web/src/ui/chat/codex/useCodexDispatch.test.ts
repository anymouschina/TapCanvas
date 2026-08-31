import { describe, expect, it } from 'vitest'
import type { CodexTask } from '@tapcanvas/codex-task-protocol'
import {
  buildCodexPairingPrompt,
  filterCodexTasksForTarget,
  hasSameCodexTurnContext,
  resolveCodexContinuationTask,
  shouldRetainCodexDispatchAttempt,
} from './codexDispatchSupport'

function codexTaskFixture(overrides: Partial<CodexTask> = {}): CodexTask {
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
    state: 'succeeded',
    previewId: 'preview-1234567890',
    idempotencyKey: 'idem-1',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T08:01:00.000Z',
    terminalAt: '2026-07-31T08:01:00.000Z',
    lastMessage: 'Codex responded',
    expectedDelivery: {
      kind: 'codex_response',
      workspaceId: 'workspace-1',
      requiredEvidence: ['codex_turn'],
    },
    deliveryEvidence: {
      source: null,
      codex: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        status: 'completed',
        outcome: 'response_only',
        changedFiles: [],
        summary: 'Codex responded',
      },
      build: null,
      preview: null,
    },
    deliveryVerification: {
      status: 'satisfied',
      checkedAt: '2026-07-31T08:01:00.000Z',
      missingCriteria: [],
      rationale: 'Verified response',
    },
  }
  return { ...task, ...overrides }
}

describe('buildCodexPairingPrompt', () => {
  it('creates a one-time canvas-first installation task without credentials', () => {
    const prompt = buildCodexPairingPrompt({
      pairingCode: "pair'code",
      apiBaseUrl: 'https://canvas.example.com/api',
      connectPackageUrl: 'https://canvas.example.com/connect.tgz',
      expiresAt: '2026-08-01T00:00:00.000Z',
    })

    expect(prompt).toContain('不要只给说明')
    expect(prompt).toContain('.tapcanvas/codex-workspace.json')
    expect(prompt).toContain('"provider":"vercel-sandbox"')
    expect(prompt).toContain(
      "npx -y 'https://canvas.example.com/connect.tgz' pair",
    )
    expect(prompt).toContain("'pair'\\''code'")
    expect(prompt).toContain('--workspace .')
    expect(prompt).toContain('Bridge 已在线')
    expect(prompt).not.toContain('apiKey')
    expect(prompt).not.toContain('VERCEL_TOKEN')
  })
})

describe('shouldRetainCodexDispatchAttempt', () => {
  it('keeps the idempotency key for uncertain writes', () => {
    expect(shouldRetainCodexDispatchAttempt(new TypeError('network lost')))
      .toBe(true)
    expect(shouldRetainCodexDispatchAttempt({
      status: 503,
      code: 'codex_http_error',
    })).toBe(true)
    expect(shouldRetainCodexDispatchAttempt({
      status: 202,
      code: 'codex_invalid_json_response',
    })).toBe(true)
  })

  it('releases the idempotency key after a definite client rejection', () => {
    expect(shouldRetainCodexDispatchAttempt({
      status: 409,
      code: 'codex_bridge_offline',
    })).toBe(false)
  })
})

describe('resolveCodexContinuationTask', () => {
  const context = {
    projectId: 'project-1',
    flowId: 'flow-1',
    chapterId: null,
    canvasRevision: 2,
    selectedNodeIds: ['node-1'],
  }

  it('resumes the latest terminal turn on the same canvas and target', () => {
    const older = codexTaskFixture()
    const latest = codexTaskFixture({
      id: 'task-2',
      parentTaskId: older.id,
      turnSequence: 2,
      deliveryEvidence: {
        ...older.deliveryEvidence,
        codex: older.deliveryEvidence.codex
          ? { ...older.deliveryEvidence.codex, threadId: 'thread-2' }
          : null,
      },
    })

    expect(resolveCodexContinuationTask({
      tasks: [older, latest],
      context,
      bridgeId: 'bridge-1',
      workspaceId: 'workspace-1',
    })?.id).toBe('task-2')
  })

  it('starts a new session when canvas, target, state, or thread evidence differs', () => {
    const task = codexTaskFixture()
    const missingThread = codexTaskFixture({
      deliveryEvidence: { ...task.deliveryEvidence, codex: null },
    })
    const running = codexTaskFixture({ state: 'codex_running', terminalAt: null })

    expect(resolveCodexContinuationTask({
      tasks: [task],
      context: { ...context, flowId: 'flow-2' },
      bridgeId: 'bridge-1',
      workspaceId: 'workspace-1',
    })).toBeNull()
    expect(resolveCodexContinuationTask({
      tasks: [task],
      context,
      bridgeId: 'bridge-2',
      workspaceId: 'workspace-1',
    })).toBeNull()
    expect(resolveCodexContinuationTask({
      tasks: [missingThread, running],
      context,
      bridgeId: 'bridge-1',
      workspaceId: 'workspace-1',
    })).toBeNull()
  })
})

describe('filterCodexTasksForTarget', () => {
  it('does not mix sessions from another Bridge or workspace in the same project', () => {
    const selected = codexTaskFixture()
    const otherWorkspace = codexTaskFixture({
      id: 'task-2',
      workspaceId: 'workspace-2',
    })
    const otherBridge = codexTaskFixture({
      id: 'task-3',
      bridgeId: 'bridge-2',
    })

    expect(filterCodexTasksForTarget({
      tasks: [otherWorkspace, otherBridge, selected],
      projectId: 'project-1',
      bridgeId: 'bridge-1',
      workspaceId: 'workspace-1',
    }).map((task) => task.id)).toEqual(['task-1'])
  })

  it('isolates persistent Codex node sessions and seeds a new node from its owner id', () => {
    const nodeTask = codexTaskFixture({
      context: {
        ...codexTaskFixture().context,
        selectedNodeIds: ['source-1', 'codex-node-1'],
      },
    })
    const otherNodeTask = codexTaskFixture({
      id: 'task-2',
      sessionId: 'session-2',
      context: {
        ...codexTaskFixture().context,
        selectedNodeIds: ['codex-node-2'],
      },
    })

    expect(filterCodexTasksForTarget({
      tasks: [otherNodeTask, nodeTask],
      projectId: 'project-1',
      bridgeId: 'bridge-1',
      workspaceId: 'workspace-1',
      ownerNodeId: 'codex-node-1',
    }).map((task) => task.id)).toEqual(['task-1'])

    expect(filterCodexTasksForTarget({
      tasks: [otherNodeTask, nodeTask],
      projectId: 'project-1',
      bridgeId: 'bridge-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-2',
      ownerNodeId: 'codex-node-1',
    }).map((task) => task.id)).toEqual(['task-2'])
  })
})

describe('hasSameCodexTurnContext', () => {
  const context = {
    projectId: 'project-1',
    flowId: 'flow-1',
    chapterId: null,
    canvasRevision: 1,
    selectedNodeIds: ['node-1', 'node-2'],
  }

  it('allows live steering only against the immutable snapshot input', () => {
    const task = codexTaskFixture({
      context: {
        ...codexTaskFixture().context,
        selectedNodeIds: ['node-2', 'node-1'],
      },
    })
    expect(hasSameCodexTurnContext({ task, context })).toBe(true)
    expect(hasSameCodexTurnContext({
      task,
      context: { ...context, canvasRevision: 2 },
    })).toBe(false)
    expect(hasSameCodexTurnContext({
      task,
      context: { ...context, selectedNodeIds: ['node-1'] },
    })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { CodexTask } from '@tapcanvas/codex-task-protocol'
import {
  buildCodexTaskNodePatch,
  collectCodexContextNodeIds,
  isCodexBridgeCliCompatible,
} from './codexTaskNodeRuntime'

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
    goal: '完成真实实现',
    context: {
      snapshotId: 'snapshot-1',
      projectId: 'project-1',
      flowId: 'flow-1',
      chapterId: null,
      canvasRevision: 1,
      selectedNodeIds: ['codex-1'],
      selectedNodeKinds: ['codex'],
      projectName: 'Project',
      flowName: 'Flow',
      nodeCount: 1,
      edgeCount: 0,
      sha256: 'b'.repeat(64),
      createdAt: '2026-08-13T00:00:00.000Z',
    },
    fallbackPolicy: 'disabled',
    state: 'succeeded',
    previewId: '',
    idempotencyKey: 'idem-1',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:01:00.000Z',
    terminalAt: '2026-08-13T00:01:00.000Z',
    lastMessage: '完成',
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
        summary: '已经完成真实结果',
      },
      build: null,
      preview: null,
    },
    deliveryVerification: {
      status: 'satisfied',
      checkedAt: '2026-08-13T00:01:00.000Z',
      missingCriteria: [],
      rationale: 'verified',
    },
  }
  return { ...task, ...overrides }
}

describe('collectCodexContextNodeIds', () => {
  it('includes the Codex node and every directly connected input once', () => {
    expect(collectCodexContextNodeIds('codex-1', [
      { id: 'e1', source: 'source-1', target: 'codex-1' },
      { id: 'e2', source: 'source-1', target: 'codex-1' },
      { id: 'e3', source: 'codex-1', target: 'downstream-1' },
    ])).toEqual(['codex-1', 'source-1'])
  })
})

describe('isCodexBridgeCliCompatible', () => {
  it('requires the first Bridge release that guarantees TapCanvas CLI access', () => {
    expect(isCodexBridgeCliCompatible('0.6.9')).toBe(false)
    expect(isCodexBridgeCliCompatible('0.7.0')).toBe(true)
    expect(isCodexBridgeCliCompatible('0.7.1')).toBe(true)
    expect(isCodexBridgeCliCompatible('1.0.0')).toBe(true)
    expect(isCodexBridgeCliCompatible('unknown')).toBe(false)
  })
})

describe('buildCodexTaskNodePatch', () => {
  it('persists session identity and terminal text output for downstream nodes', () => {
    expect(buildCodexTaskNodePatch(taskFixture())).toMatchObject({
      codexSessionId: 'session-1',
      codexTaskId: 'task-1',
      codexState: 'succeeded',
      status: 'success',
      text: '已经完成真实结果',
      textResults: [{ text: '已经完成真实结果' }],
    })
  })

  it('does not publish a partial running message as a downstream result', () => {
    const patch = buildCodexTaskNodePatch(taskFixture({
      state: 'codex_running',
      terminalAt: null,
      lastMessage: '正在修改文件',
      deliveryEvidence: {
        ...taskFixture().deliveryEvidence,
        codex: null,
      },
    }))
    expect(patch.status).toBe('running')
    expect(patch).not.toHaveProperty('textResults')
  })
})

import { describe, expect, it } from 'vitest'
import { appendManualMediaAttemptHistory, sanitizeBrowserCanvasPatch, mergeCanvasAuthoringData, mergeCanvasSyncedNodeData } from '@tapcanvas/video-orchestrator-protocol'

const facts = { kind: 'video', workflowExecutionId: 'exec', workflowRuntimeNodeId: 'submit', workflowEffectId: 'effect', status: 'success', videoUrl: 'https://assets.test/result.mp4', videoThumbnailUrl: 'https://assets.test/result.jpg', videoResults: [{ url: 'https://assets.test/result.mp4' }], prompt: 'original' }
describe('browser output ownership', () => {
  it('does not broadcast stale runtime facts, including a stale poster', () => {
    const patch = sanitizeBrowserCanvasPatch({ upsertNodes: [{ id: 'video', data: { ...facts, status: 'running', videoUrl: '', prompt: 'edited' } }] })
    const item = patch.upsertNodes[0]
    expect(item.dataMode).toBe('authoring')
    expect(item.data).toEqual({ kind: 'video', prompt: 'edited' })
    expect(mergeCanvasAuthoringData(facts, item.data)).toEqual({ ...facts, prompt: 'edited' })
  })
  it('preserves user clearing authoring fields while retaining all runtime facts', () => {
    expect(mergeCanvasAuthoringData(facts, { kind: 'video' })).toEqual(expect.objectContaining({ videoUrl: facts.videoUrl, videoThumbnailUrl: facts.videoThumbnailUrl }))
    expect(mergeCanvasAuthoringData(facts, { kind: 'video' })).not.toHaveProperty('prompt')
  })
  it('syncs editable workflow image bindings while preserving frozen headers and submission history', () => {
    const persisted = {
      ...facts,
      workflowPreparedOnly: true,
      workflowReferenceBindings: [{ nodeId: 'old-image', name: '场景', referenceType: 'scene' }],
      workflowReferenceHeader: '【引用素材】旧场景',
      workflowVideoSubmissionInput: { prompt: 'submitted prompt', referenceMediaManifest: { images: [{ url: 'https://assets.test/old.png' }] } },
      workflowFutureExecutionReceipt: { receiptId: 'server-owned' },
    }
    const nextBindings = [{ nodeId: 'manual-image', name: '场景', referenceType: 'scene' }]
    const patch = sanitizeBrowserCanvasPatch({ upsertNodes: [{ id: 'video', data: {
      ...persisted,
      workflowReferenceBindings: nextBindings,
      workflowReferenceHeader: 'tampered header',
      workflowVideoSubmissionInput: { prompt: 'tampered history' },
      workflowFutureExecutionReceipt: { receiptId: 'client-forgery' },
    } }] })
    const update = patch.upsertNodes[0]
    expect(update.dataMode).toBe('authoring')
    expect(update.data).toEqual({ kind: 'video', prompt: 'original', workflowReferenceBindings: nextBindings })
    expect(mergeCanvasAuthoringData(persisted, update.data)).toEqual({
      ...persisted,
      workflowReferenceBindings: nextBindings,
    })
  })
  it('keeps ordinary media edits and omits server status-card data', () => {
    const ordinary = { id: 'uploaded', data: { kind: 'video', videoUrl: 'https://assets.test/upload.mp4' } }
    const result = sanitizeBrowserCanvasPatch({ upsertNodes: [ordinary, { id: 'status', data: { managedProjection: 'workflow_execution', status: 'failed' } }] })
    expect(result.upsertNodes[0]).toEqual(ordinary)
    expect(result.upsertNodes[1]).not.toHaveProperty('data')
  })
})


describe('manual attempt browser snapshots', () => {
  const failed = { kind: 'video', mediaTaskExecutionOwner: 'manual', sourceWorkflowOutput: { nodeId: 'origin' }, runToken: 'attempt-1', status: 'error', lastError: 'provider EOF', httpStatus: 500, prompt: 'old' }
  function browserMerge(data: Record<string, unknown>) {
    const item = sanitizeBrowserCanvasPatch({ upsertNodes: [{ id: 'manual', data }] }).upsertNodes[0]
    expect(item.dataMode).toBe('manual_attempt_snapshot')
    return mergeCanvasSyncedNodeData(failed, item.data, 'manual', item.dataMode)
  }
  it('retains failure evidence when a stale tab broadcasts running for the same attempt, while accepting edits', () => {
    expect(browserMerge({ ...failed, status: 'running', lastError: undefined, httpStatus: null, prompt: 'edited' }))
      .toEqual({ ...failed, prompt: 'edited' })
  })
  it('allows a new explicit attempt and a newly accepted receipt', () => {
    for (const data of [{ ...failed, runToken: 'attempt-2', status: 'running' }, { ...failed, status: 'running', videoTaskId: 'accepted-task' }]) {
      expect(browserMerge(data)).toEqual(data)
    }
  })
  it('accepts authoritative running after a query error without treating it as a provider terminal', () => {
    const receipt = { ...failed, status: 'running', videoTaskId: 'accepted-task', lastError: undefined }
    expect(mergeCanvasSyncedNodeData(failed, receipt, 'manual')).toEqual(receipt)
  })
  it('requires a real result to upgrade browser failure to success and preserves success against late failure', () => {
    expect(browserMerge({ ...failed, status: 'success' })).toEqual(failed)
    const success = { ...failed, status: 'success', videoUrl: 'https://assets.test/result.mp4', lastError: undefined }
    expect(browserMerge(success)).toEqual(success)
    expect(mergeCanvasSyncedNodeData(success, failed, 'manual', 'manual_attempt_snapshot')).toEqual(success)
  })
})


it('does not erase or alias-bypass an existing receipt in a same-attempt terminal snapshot', () => {
  const current = { mediaTaskExecutionOwner: 'manual', sourceWorkflowOutput: { nodeId: 'origin' }, runToken: 'same', status: 'error', taskId: 'receipt', lastError: 'confirmed failure' }
  for (const stale of [{ ...current, taskId: undefined, lastError: undefined }, { ...current, status: 'running', videoTaskId: 'receipt' }]) {
    expect(mergeCanvasSyncedNodeData(current, stale, 'manual', 'manual_attempt_snapshot')).toEqual(current)
  }
  const completed = { ...current, status: 'success', videoUrl: 'https://assets.test/result.mp4', taskId: undefined }
  expect(mergeCanvasSyncedNodeData(current, completed, 'manual', 'manual_attempt_snapshot')).toEqual({ ...completed, taskId: 'receipt' })
})

describe('same-node retry persistence', () => {
  const oldWorkflow = {
    kind: 'video', status: 'failed', workflowExecutionId: 'execution', workflowRuntimeNodeId: 'submit',
    workflowEffectId: 'effect', workflowSubmissionState: 'failed', taskId: 'old-receipt',
    workflowVideoSubmissionInput: { prompt: 'submitted prompt', referenceMediaManifest: { images: [{ url: 'https://assets.test/old.png' }] } },
    lastError: 'provider failed', prompt: 'original prompt', videoUrl: 'https://assets.test/old.mp4',
  }
  const attemptEntry = (attemptId: string, url: string) => ({
    attemptId, canvasNodeId: 'video-node', priorWorkflowIdentity: {}, status: 'success', receiptIds: [],
    submissionState: null, mediaTaskReceiptStatus: null, errorMessage: null, assetUrls: [url],
    results: { videoUrl: url }, logs: [],
  })
  const freshAttempt = (history: unknown[] = []) => ({
    ...oldWorkflow, status: 'running', videoUrl: undefined, taskId: undefined,
    workflowExecutionId: undefined, workflowRuntimeNodeId: undefined, workflowEffectId: undefined,
    workflowSubmissionState: undefined, lastError: undefined,
    mediaTaskExecutionOwner: 'manual', manualMediaAttemptTargetId: 'video-node',
    manualMediaAttemptId: 'attempt-b', runToken: 'run-b', manualMediaAttemptHistory: history,
  })

  it('archives the previous workflow receipt and result while retrying on the same node', () => {
    const next = mergeCanvasSyncedNodeData(oldWorkflow, freshAttempt(), 'video-node') as Record<string, unknown>
    expect(next).toMatchObject({
      manualMediaAttemptId: 'attempt-b', status: 'running',
      manualMediaAttemptHistory: [expect.objectContaining({
        attemptId: 'old-receipt', canvasNodeId: 'video-node', receiptIds: ['old-receipt'],
        assetUrls: ['https://assets.test/old.mp4'], results: { videoUrl: 'https://assets.test/old.mp4' },
        submissionInput: oldWorkflow.workflowVideoSubmissionInput,
      })],
    })
    expect(next).not.toHaveProperty('workflowExecutionId')
    expect(next).not.toHaveProperty('workflowVideoSubmissionInput')
  })

  it('keeps browser history completed between saves, with server facts winning duplicate ids', () => {
    const serverEntry = attemptEntry('attempt-a', 'https://assets.test/server-a.mp4')
    const browserDuplicate = attemptEntry('attempt-a', 'https://assets.test/stale-a.mp4')
    const browserOnly = attemptEntry('attempt-between-saves', 'https://assets.test/browser-b.mp4')
    const current = { ...oldWorkflow, manualMediaAttemptHistory: [serverEntry] }
    const next = mergeCanvasSyncedNodeData(current, freshAttempt([browserDuplicate, browserOnly]), 'video-node') as Record<string, unknown>
    expect(next.manualMediaAttemptHistory).toEqual([
      serverEntry,
      expect.objectContaining({ attemptId: 'old-receipt', canvasNodeId: 'video-node' }),
      browserOnly,
    ])
  })

  it('does not manufacture history for a blank idle node', () => {
    const next = mergeCanvasSyncedNodeData({ kind: 'video' }, freshAttempt(), 'video-node') as Record<string, unknown>
    expect(next.manualMediaAttemptHistory).toEqual([])
    expect(appendManualMediaAttemptHistory('video-node', { kind: 'video' })).toEqual([])
  })

  it('keeps earlier successful assets when a later same-attempt success snapshot is partial', () => {
    const persisted = {
      ...freshAttempt(), status: 'success', videoUrl: 'https://assets.test/first.mp4',
      videoResults: [{ url: 'https://assets.test/first.mp4' }],
    }
    const staleSuccess = { ...persisted, videoUrl: 'https://assets.test/second.mp4', videoResults: [] }
    const merged = mergeCanvasSyncedNodeData(persisted, staleSuccess, 'video-node') as Record<string, unknown>
    expect(merged.videoResults).toEqual([
      { url: 'https://assets.test/first.mp4' },
      { url: 'https://assets.test/second.mp4' },
    ])
  })
})

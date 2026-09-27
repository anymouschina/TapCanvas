import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { projectWorkflowMediaAttempts, resolveWorkflowMediaOutputSlot } from './workflowMediaAttemptProjection'

function mediaNode(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'image', ...data } }
}

describe('workflow media attempt projection', () => {
  it('keeps distinct prepared outputs from the same producer visible with their own dependency edges', () => {
    const shared = {
      workflowExecutionId: 'execution', workflowExecutionFamilyId: 'family',
      workflowRuntimeNodeId: 'materialize', workflowPreparedOnly: true,
    }
    const imageA = mediaNode('image-a', { ...shared, workflowObjectId: 'character-a' })
    const imageB = mediaNode('image-b', { ...shared, workflowObjectId: 'character-b' })
    const videos = Array.from({ length: 25 }, (_, index) => mediaNode(`video-${index}`, {
      ...shared, kind: 'video', workflowClipId: `clip-${index}`, clipIndex: index,
    }))
    const nodes = [imageA, imageB, ...videos]
    const edges = videos.map((video, index): Edge => ({
      id: `reference-${index}`, source: index % 2 ? imageA.id : imageB.id, target: video.id,
    }))
    const projection = projectWorkflowMediaAttempts(nodes, edges)
    expect(projection.nodes).toEqual(nodes)
    expect(projection.edges).toEqual(edges)
    expect(projection.hiddenAttemptNodeIds.size).toBe(0)
    expect(resolveWorkflowMediaOutputSlot(nodes, 'video-12')?.attempts).toHaveLength(1)
  })

  it('keeps the source card identity, displays the latest successful asset, and retains failed attempt history', () => {
    const source = mediaNode('image-source', {
      workflowExecutionId: 'execution-1',
      workflowExecutionFamilyId: 'family-1',
      workflowRuntimeNodeId: 'images::item::cover',
      workflowEffectId: 'family-1:images::item::cover:image-submit',
      status: 'failed',
      lastError: 'provider rejected the first attempt',
      taskId: 'task-old',
    })
    const retry = mediaNode('image-retry', {
      workflowExecutionId: 'execution-2',
      workflowExecutionFamilyId: 'family-1',
      workflowRuntimeNodeId: 'images::item::cover',
      workflowEffectId: 'family-1:images::item::cover:image-submit::retry::retry-key',
      workflowMediaRetry: { retryKey: 'retry-key' },
      status: 'success',
      imageUrl: 'https://assets.example/cover-v2.png',
      imageResults: [{ url: 'https://assets.example/cover-v2.png' }],
      taskId: 'task-new',
    })
    const siblingItem = mediaNode('image-other-item', {
      workflowExecutionId: 'execution-2',
      workflowExecutionFamilyId: 'family-1',
      workflowRuntimeNodeId: 'images::item::character',
      workflowEffectId: 'family-1:images::item::character:image-submit',
      status: 'success',
      imageUrl: 'https://assets.example/character.png',
    })
    const manualVariant = mediaNode('manual-variant', {
      mediaTaskExecutionOwner: 'manual',
      imageUrl: 'https://assets.example/manual.png',
    })
    const input = { id: 'input', type: 'ioNode', position: { x: 0, y: 0 }, data: { kind: 'io-in' } } satisfies Node
    const downstream = { id: 'downstream', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'text' } } satisfies Node
    const nodes = [input, source, retry, siblingItem, manualVariant, downstream]
    const edges: Edge[] = [
      { id: 'source-input', source: 'input', target: source.id },
      { id: 'retry-input', source: 'input', target: retry.id },
      { id: 'source-output', source: source.id, target: 'downstream' },
    ]

    const projection = projectWorkflowMediaAttempts(nodes, edges)
    const projectedSource = projection.nodes.find((node) => node.id === source.id)

    expect(projection.hiddenAttemptNodeIds).toEqual(new Set(['image-retry']))
    expect(projection.nodes.map((node) => node.id)).toEqual(['input', 'image-source', 'image-other-item', 'manual-variant', 'downstream'])
    expect(projectedSource?.data).toMatchObject({
      status: 'success',
      imageUrl: 'https://assets.example/cover-v2.png',
      workflowOutputActiveAttempt: { canvasNodeId: 'image-retry', taskId: 'task-new' },
    })
    expect(projectedSource?.data.workflowOutputAttempts).toMatchObject([
      { canvasNodeId: 'image-source', status: 'failed', errorMessage: 'provider rejected the first attempt' },
      { canvasNodeId: 'image-retry', status: 'success', assetUrls: ['https://assets.example/cover-v2.png'] },
    ])
    expect(projection.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['input', 'image-source'],
      ['image-source', 'downstream'],
    ])
    expect(source.data).not.toHaveProperty('workflowOutputAttempts')
  })

  it('resolves video retry siblings to the immutable source and orders them by retry index', () => {
    const source = mediaNode('video-source', {
      kind: 'video', workflowExecutionId: 'execution-1', workflowExecutionFamilyId: 'family-2',
      workflowRuntimeNodeId: 'video::item::clip', workflowEffectId: 'family-2:video::item::clip:video-submit',
      status: 'success', videoUrl: 'https://assets.example/clip-v1.mp4',
    })
    const retryOne = mediaNode('video-retry-1', {
      kind: 'video', workflowExecutionId: 'execution-2', workflowExecutionFamilyId: 'family-2',
      workflowRuntimeNodeId: 'video-retry-1', workflowEffectId: 'video-retry-effect-1',
      videoRetrySourceNodeId: source.id, videoRetryIndex: 1, status: 'failed', lastError: 'first retry failed',
    })
    const retryTwo = mediaNode('video-retry-2', {
      kind: 'video', workflowExecutionId: 'execution-3', workflowExecutionFamilyId: 'family-2',
      workflowRuntimeNodeId: 'video-retry-2', workflowEffectId: 'video-retry-effect-2',
      videoRetrySourceNodeId: source.id, videoRetryIndex: 2, status: 'success',
      videoUrl: 'https://assets.example/clip-v3.mp4',
    })

    const projection = projectWorkflowMediaAttempts([source, retryTwo, retryOne], [])
    const slot = resolveWorkflowMediaOutputSlot([source, retryTwo, retryOne], source.id)

    expect(projection.nodes.map((node) => node.id)).toEqual(['video-source'])
    expect(projection.nodes[0]?.data).toMatchObject({
      videoUrl: 'https://assets.example/clip-v3.mp4',
      status: 'success',
      workflowOutputAttempts: [
        { canvasNodeId: 'video-source', status: 'success' },
        { canvasNodeId: 'video-retry-1', status: 'failed' },
        { canvasNodeId: 'video-retry-2', status: 'success' },
      ],
    })
    expect(slot?.activeAttempt.canvasNodeId).toBe('video-retry-2')
  })

  it('keeps the prior successful asset visible while showing a newer failed attempt', () => {
    const source = mediaNode('image-source', {
      workflowExecutionId: 'execution-1', workflowExecutionFamilyId: 'family-3',
      workflowRuntimeNodeId: 'images::item::one', workflowEffectId: 'source-effect',
      status: 'success', imageUrl: 'https://assets.example/kept.png',
    })
    const retry = mediaNode('image-retry', {
      workflowExecutionId: 'execution-2', workflowExecutionFamilyId: 'family-3',
      workflowRuntimeNodeId: 'images::item::one', workflowEffectId: 'retry::retry-key',
      status: 'failed', lastError: 'retry failed',
    })
    const projected = projectWorkflowMediaAttempts([source, retry], []).nodes[0]
    expect(projected?.data).toMatchObject({ status: 'error', imageUrl: 'https://assets.example/kept.png', lastError: 'retry failed' })
  })

  it('orders appended image retries from receipt lineage when persisted node loading order is reversed', () => {
    const source = mediaNode('image-source', {
      workflowExecutionId: 'execution-1', workflowExecutionFamilyId: 'family-4',
      workflowRuntimeNodeId: 'images::item::cover', workflowEffectId: 'source-effect',
      status: 'failed',
    })
    const retryOne = mediaNode('image-retry-1', {
      workflowExecutionId: 'execution-2', workflowExecutionFamilyId: 'family-4',
      workflowRuntimeNodeId: 'images::item::cover', workflowEffectId: 'retry-one::retry::key-1',
      workflowMediaRetry: { retryKey: 'key-1', canvasNodeId: 'image-source' }, status: 'failed',
    })
    const retryTwo = mediaNode('image-retry-2', {
      workflowExecutionId: 'execution-3', workflowExecutionFamilyId: 'family-4',
      workflowRuntimeNodeId: 'images::item::cover', workflowEffectId: 'retry-two::retry::key-2',
      workflowMediaRetry: { retryKey: 'key-2', canvasNodeId: 'image-retry-1' },
      status: 'success', imageUrl: 'https://assets.example/cover-v3.png',
    })

    const projected = projectWorkflowMediaAttempts([retryTwo, retryOne, source], []).nodes[0]

    expect(projected?.data).toMatchObject({
      imageUrl: 'https://assets.example/cover-v3.png',
      workflowOutputAttempts: [
        { canvasNodeId: 'image-source', status: 'failed' },
        { canvasNodeId: 'image-retry-1', status: 'failed' },
        { canvasNodeId: 'image-retry-2', status: 'success' },
      ],
    })
  })

  it('shows a waiting vendor receipt as busy on the logical card and clears the prior error from its current view', () => {
    const source = mediaNode('image-source', {
      workflowExecutionId: 'execution-1', workflowExecutionFamilyId: 'family-5',
      workflowRuntimeNodeId: 'images::item::cover', workflowEffectId: 'source-effect',
      status: 'failed', lastError: 'first attempt rejected',
    })
    const retry = mediaNode('image-retry', {
      workflowExecutionId: 'execution-2', workflowExecutionFamilyId: 'family-5',
      workflowRuntimeNodeId: 'images::item::cover', workflowEffectId: 'retry::retry::key',
      workflowMediaRetry: { retryKey: 'key', canvasNodeId: 'image-source' }, status: 'waiting_external',
    })

    const projected = projectWorkflowMediaAttempts([source, retry], []).nodes[0]

    expect(projected?.data.status).toBe('running')
    expect(projected?.data).not.toHaveProperty('lastError')
    expect(projected?.data.workflowOutputAttempts).toMatchObject([
      { canvasNodeId: 'image-source', errorMessage: 'first attempt rejected' },
      { canvasNodeId: 'image-retry', status: 'waiting_external' },
    ])
  })
})

import { describe, expect, it } from 'vitest';
import {
  CANVAS_LIFECYCLE_KEY,
  projectWorkflowGraphForViewer,
  projectWorkflowGraphPatchForViewer,
  reconcileCanvasMembership,
} from '@tapcanvas/workflow-kernel-protocol';
import { preserveManagedFlowProjections } from './flow.managed-projections';
import { mergeFlowStorageEnvelope } from './flow.storage-envelope';
import { applyPublicFlowGraphPatch } from './flow.public.service';
import { PublicFlowGraphSchema } from './flow.public.schemas';
import { UpsertFlowSchema } from './flow.schemas';

const output = {
  id: 'output', type: 'taskNode', position: { x: 0, y: 0 },
  data: { kind: 'video', status: 'running', taskId: 'paid-task', workflowExecutionId: 'run-1', workflowRuntimeNodeId: 'runtime', workflowEffectId: 'effect' },
};
const card = {
  id: 'execution-card', type: 'workflowExecutionNode', position: { x: 0, y: 0 },
  data: { managedProjection: 'workflow_execution', workflowExecutionId: 'run-1' },
};
const graph = { nodes: [card, output], edges: [{ id: 'edge', source: card.id, target: output.id }] };
const nodes = (value: unknown): Record<string, unknown>[] => PublicFlowGraphSchema.parse(value).nodes
  .filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === 'object' && !Array.isArray(node));
const visibleNodes = (value: unknown) => nodes(projectWorkflowGraphForViewer(value, true));

describe('durable canvas membership', () => {
  it('distinguishes an omitted live output from an explicitly deleted output', () => {
    const incoming = { nodes: [card], edges: [] };
    const protectedGraph = preserveManagedFlowProjections({ existing: graph, incoming });
    expect(visibleNodes(reconcileCanvasMembership(graph, protectedGraph)).map((node) => node.id)).toContain(output.id);
    const deleted = reconcileCanvasMembership(graph, protectedGraph, { deletedNodeIds: [output.id] });
    expect(visibleNodes(deleted).map((node) => node.id)).not.toContain(output.id);
    expect(nodes(deleted).find((node) => node.id === output.id)?.data).toEqual(output.data);
  });

  it('settles an accepted task after deletion without restoring its canvas node', () => {
    const detached = reconcileCanvasMembership(graph, { nodes: [], edges: [] }, { deletedNodeIds: [card.id, output.id] });
    const applied = applyPublicFlowGraphPatch({ current: detached, patch: {
      allowOverwrite: true,
      patchNodeData: [{ id: output.id, data: { status: 'success', videoUrl: 'https://assets.example/video.mp4' } }],
    } });
    const persisted: unknown = JSON.parse(mergeFlowStorageEnvelope(JSON.stringify(detached), JSON.stringify(applied.data)));
    expect(visibleNodes(persisted)).toEqual([]);
    expect(nodes(persisted)).toEqual(expect.arrayContaining([expect.objectContaining({
      id: output.id, canvasDetached: true,
      data: expect.objectContaining({ status: 'success', taskId: 'paid-task', videoUrl: 'https://assets.example/video.mp4' }),
    })]));
    for (const admin of [false, true]) {
      expect(projectWorkflowGraphPatchForViewer({ upsertNodes: nodes(persisted) }, admin)).toMatchObject({
        upsertNodes: [], removeNodeIds: expect.arrayContaining([card.id, output.id]),
      });
    }
  });

  it('keeps existing results after deleting the execution, but hides later results of that execution', () => {
    const detached = reconcileCanvasMembership(graph, { nodes: [output], edges: [] }, { deletedNodeIds: [card.id] });
    const late = { ...output, id: 'late-output' };
    const otherRun = { ...output, id: 'new-run-output', data: { ...output.data, workflowExecutionId: 'run-2' } };
    const updated = reconcileCanvasMembership(detached, { nodes: [output, late, otherRun], edges: [] });
    expect(visibleNodes(updated).map((node) => node.id)).toEqual([output.id, otherRun.id]);
    expect(nodes(updated).map((node) => node.id)).toContain(late.id);
  });

  it('keeps recovery-family results detached and allows an explicitly remounted new family', () => {
    const familyCard = { ...card, data: { ...card.data, workflowExecutionFamilyId: 'family-1' } };
    const original = { nodes: [familyCard, output], edges: [] };
    const detached = reconcileCanvasMembership(original, { nodes: [output], edges: [] }, { deletedNodeIds: [card.id] });
    const recovery = { ...output, id: 'recovery-output', data: { ...output.data, workflowExecutionId: 'recovery-2', workflowExecutionFamilyId: 'family-1' } };
    const recovered = reconcileCanvasMembership(detached, { nodes: [...nodes(detached), recovery], edges: [] });
    expect(visibleNodes(recovered).map((node) => node.id)).toEqual([output.id]);
    const newCard = { ...familyCard, data: { ...familyCard.data, workflowExecutionId: 'run-new', workflowExecutionFamilyId: 'family-new' } };
    const remounted = reconcileCanvasMembership(recovered, { nodes: [newCard, output, recovery], edges: [] }, { restoredNodeIds: [card.id] });
    expect(visibleNodes(remounted).map((node) => node.id)).toEqual([card.id, output.id]);
  });

  it('does not let old envelopes or client markers erase a deletion', () => {
    const detached = reconcileCanvasMembership(graph, { nodes: [card], edges: [] }, { deletedNodeIds: [output.id] });
    const stale = { ...graph, [CANVAS_LIFECYCLE_KEY]: { deletedNodeIds: [], detachedExecutionIds: [], retainedNodeIds: [] } };
    const persisted: unknown = JSON.parse(mergeFlowStorageEnvelope(JSON.stringify(detached), JSON.stringify(stale)));
    expect(visibleNodes(persisted).map((node) => node.id)).not.toContain(output.id);
    const subsequentSave = reconcileCanvasMembership(persisted, { nodes: [card], edges: [] });
    expect(nodes(subsequentSave).find((node) => node.id === output.id)?.data).toEqual(output.data);
  });

  it('requires an explicit restore and preserves that restore through storage', () => {
    const detached = reconcileCanvasMembership(graph, { nodes: [card], edges: [] }, { deletedNodeIds: [output.id] });
    const restored: unknown = JSON.parse(mergeFlowStorageEnvelope(JSON.stringify(detached), JSON.stringify(graph), { restoredNodeIds: [output.id] }));
    expect(visibleNodes(restored).map((node) => node.id)).toContain(output.id);
  });

  it('never accepts an injected lifecycle ledger on a new canvas', () => {
    const result = reconcileCanvasMembership({}, { ...graph, [CANVAS_LIFECYCLE_KEY]: { deletedNodeIds: [output.id], detachedExecutionIds: [], retainedNodeIds: [] } });
    expect(visibleNodes(result).map((node) => node.id)).toContain(output.id);
    expect(result).not.toHaveProperty(CANVAS_LIFECYCLE_KEY);
  });

  it('removes detached edges even in an edge-only realtime message', () => {
    expect(projectWorkflowGraphPatchForViewer({ upsertEdges: [{ id: 'edge', source: 'a', target: 'b', canvasDetached: true }] }, true))
      .toMatchObject({ upsertEdges: [] });
  });

  it('requires a revision for explicit deletion or restoration', () => {
    expect(UpsertFlowSchema.safeParse({ name: 'canvas', data: {}, deletedNodeIds: [output.id] }).success).toBe(false);
    expect(UpsertFlowSchema.safeParse({ name: 'canvas', data: {}, restoredNodeIds: [output.id], expectedRevision: 4 }).success).toBe(true);
  });
});

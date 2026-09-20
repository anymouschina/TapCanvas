import { isAdminWorkflowGraphNode, reconcileCanvasMembership, type CanvasMembershipChanges } from '@tapcanvas/workflow-kernel-protocol';
import { AppError } from '../../middleware/error';

/** Restore membership using the latest persisted receipt, never a client copy. */
export function restorePersistedCanvasNodes(current: unknown, restoredNodeIds: readonly string[] = []): unknown {
  if (!restoredNodeIds.length) return current;
  const graph = current && typeof current === 'object' ? current as Record<string, unknown> : {};
  const nodes: unknown[] = Array.isArray(graph.nodes) ? graph.nodes : [];
  const ids = new Set(nodes.map((node) => String((node as Record<string, unknown>).id)));
  const missing = restoredNodeIds.filter((id) => !ids.has(id));
  if (missing.length) throw new AppError('Cannot restore missing persisted nodes', {
    status: 404, code: 'canvas_restore_node_missing', details: { nodeIds: missing },
  });
  return reconcileCanvasMembership(current, current, { restoredNodeIds });
}

export function assertCanvasMembershipPermission(current: unknown, changes: CanvasMembershipChanges, canManageWorkflow: boolean): void {
  if (canManageWorkflow) return;
  const graph = current && typeof current === 'object' ? current as Record<string, unknown> : {};
  const nodes: unknown[] = Array.isArray(graph.nodes) ? graph.nodes : [];
  const changed = new Set([...(changes.deletedNodeIds ?? []), ...(changes.restoredNodeIds ?? [])]);
  if (nodes.some((node) => isAdminWorkflowGraphNode(node)
    && changed.has(String((node as Record<string, unknown>).id)))) {
    throw new AppError('Cannot change protected workflow membership', { status: 403, code: 'canvas_membership_forbidden' });
  }
}

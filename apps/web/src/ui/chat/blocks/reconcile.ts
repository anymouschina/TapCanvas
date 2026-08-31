import type { ContentBlock, BlockStreamOp, TextBlock } from './types';

export type BlockReconcileState = {
  order: string[];
  byId: Record<string, ContentBlock>;
};

export const emptyBlockState: BlockReconcileState = { order: [], byId: {} };

export function reconcileBlocks(state: BlockReconcileState, op: BlockStreamOp): BlockReconcileState {
  const order = state.order.slice();
  const byId = { ...state.byId };
  const ensureOrder = (id: string) => {
    if (!order.includes(id)) order.push(id);
  };

  switch (op.op) {
    case 'start': {
      ensureOrder(op.block.id);
      if (!byId[op.block.id]) byId[op.block.id] = op.block;
      return { order, byId };
    }
    case 'delta': {
      const cur = byId[op.id];
      if (cur && cur.type === 'text') {
        byId[op.id] = { ...cur, text: cur.text + op.textDelta } as TextBlock;
      }
      return { order, byId };
    }
    case 'set': {
      ensureOrder(op.block.id);
      byId[op.block.id] = op.block;
      return { order, byId };
    }
    case 'end': {
      const cur = byId[op.id];
      if (cur && (cur.type === 'text' || cur.type === 'choice' || cur.type === 'data') && op.state) {
        byId[op.id] = { ...cur, state: op.state } as ContentBlock;
      }
      return { order, byId };
    }
    default:
      return state;
  }
}

export function toOrderedBlocks(state: BlockReconcileState): ContentBlock[] {
  return state.order.map((id) => state.byId[id]).filter(Boolean);
}

/** result 快照覆盖重建（断流兜底）：以 blocks[] 为准重置 state。 */
export function resetFromSnapshot(blocks: ContentBlock[]): BlockReconcileState {
  const order: string[] = [];
  const byId: Record<string, ContentBlock> = {};
  for (const b of blocks) {
    order.push(b.id);
    byId[b.id] = b;
  }
  return { order, byId };
}

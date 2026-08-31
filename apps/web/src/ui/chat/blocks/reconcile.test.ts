import { describe, it, expect } from 'vitest';
import { reconcileBlocks, toOrderedBlocks, resetFromSnapshot, type BlockReconcileState } from './reconcile';
import type { BlockStreamOp } from './types';

function apply(ops: BlockStreamOp[]): BlockReconcileState {
  let s: BlockReconcileState = { order: [], byId: {} };
  for (const op of ops) s = reconcileBlocks(s, op);
  return s;
}

describe('reconcileBlocks', () => {
  it('start 插入占位并保序', () => {
    const s = apply([{ op: 'start', block: { id: 'text-main', type: 'text', text: '', state: 'streaming' } }]);
    expect(s.order).toEqual(['text-main']);
    expect(s.byId['text-main']).toMatchObject({ type: 'text', text: '' });
  });

  it('delta 累加到对应 id 的 text', () => {
    const s = apply([
      { op: 'start', block: { id: 'text-main', type: 'text', text: '', state: 'streaming' } },
      { op: 'delta', id: 'text-main', textDelta: '你' },
      { op: 'delta', id: 'text-main', textDelta: '好' },
    ]);
    expect((s.byId['text-main'] as any).text).toBe('你好');
  });

  it('set 原子 upsert，保序追加', () => {
    const s = apply([
      { op: 'start', block: { id: 'text-main', type: 'text', text: 'hi', state: 'streaming' } },
      { op: 'set', block: { id: 'media-1', type: 'media', layout: 'single', items: [{ kind: 'image', url: 'https://x/a.png' }] } },
    ]);
    expect(s.order).toEqual(['text-main', 'media-1']);
    expect(s.byId['media-1'].type).toBe('media');
  });

  it('end 置 state，不改顺序', () => {
    const s = apply([
      { op: 'start', block: { id: 'text-main', type: 'text', text: 'hi', state: 'streaming' } },
      { op: 'end', id: 'text-main', state: 'complete' },
    ]);
    expect((s.byId['text-main'] as any).state).toBe('complete');
    expect(s.order).toEqual(['text-main']);
  });

  it('toOrderedBlocks 输出按 order', () => {
    const s = apply([
      { op: 'set', block: { id: 'a', type: 'text', text: '1' } },
      { op: 'set', block: { id: 'b', type: 'text', text: '2' } },
    ]);
    expect(toOrderedBlocks(s).map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('resetFromSnapshot 以快照重建', () => {
    const s = resetFromSnapshot([
      { id: 'text-main', type: 'text', text: 'final', state: 'complete' },
      { id: 'choice-x', type: 'choice', requestId: 'x', state: 'pending', questions: [] },
    ]);
    expect(s.order).toEqual(['text-main', 'choice-x']);
    expect((s.byId['text-main'] as any).text).toBe('final');
  });
});

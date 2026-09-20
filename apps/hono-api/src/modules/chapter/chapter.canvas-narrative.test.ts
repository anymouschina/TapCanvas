import { describe, expect, it } from 'vitest';
import { reconcileEditableChapterNarrative } from './chapter.canvas-narrative';

describe('canvas chapter narrative edits', () => {
  const seed = { id: 'chapter-seed-c1', data: {
    chapterTitle: '第一章', chapterText: '原文', content: '原文',
    prompt: '【第一章】\n\n原文', sourceHash: 'old', readOnly: true,
  } };
  const current = { nodes: [seed], edges: [] };

  it('updates the source from rich text edits and strips only the exact title prefix', () => {
    const incoming = { nodes: [{ ...seed, data: { ...seed.data, prompt: '【第一章】\n\n新正文' } }], edges: [] };
    const result = reconcileEditableChapterNarrative('c1', current, incoming, 2);
    expect(result.metadata).toEqual({ summary: '新正文' });
    expect(result.flow.nodes[0].data).toMatchObject({ chapterText: '新正文', content: '新正文', sourceChapterRevision: 2, readOnly: false });
    expect(result.flow.nodes[0].data).not.toHaveProperty('sourceHash', 'old');
  });

  it('does not rewrite chapter metadata or source revision for layout-only saves', () => {
    const result = reconcileEditableChapterNarrative('c1', current, current, 9);
    expect(result.metadata).toEqual({});
    expect(result.flow.nodes[0].data).toHaveProperty('sourceHash', 'old');
  });

  it('persists an intentionally cleared body', () => {
    const incoming = { nodes: [{ ...seed, data: { ...seed.data, prompt: '' } }], edges: [] };
    expect(reconcileEditableChapterNarrative('c1', current, incoming, 2).metadata).toEqual({ summary: '' });
  });
});

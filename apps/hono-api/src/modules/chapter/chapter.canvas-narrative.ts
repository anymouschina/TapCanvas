import { createHash } from 'node:crypto';
import type { CanvasFlow } from './chapter.canvas-flow.schemas';

function dataOf(node: Record<string, unknown> | undefined): Record<string, unknown> {
  return node?.data !== null && typeof node?.data === 'object' && !Array.isArray(node.data)
    ? node.data as Record<string, unknown> : {};
}

/** Save the edited source and chapter metadata under the same canvas revision fence. */
export function reconcileEditableChapterNarrative(
  chapterId: string, current: CanvasFlow, incoming: CanvasFlow, revision: number,
): { flow: CanvasFlow; metadata: { summary?: string } } {
  const id = `chapter-seed-${chapterId}`;
  const previous = current.nodes.find(node => node.id === id);
  const next = incoming.nodes.find(node => node.id === id);
  if (!next) return { flow: incoming, metadata: {} };
  const before = dataOf(previous);
  const after = dataOf(next);
  const merged: Record<string, unknown> = { ...before, ...after, readOnly: false };
  const changedPrompt = typeof after.prompt === 'string' && after.prompt !== before.prompt;
  const changedText = typeof after.chapterText === 'string' && after.chapterText !== before.chapterText;
  let summary: string | undefined;
  if (changedPrompt) {
    const title = typeof merged.chapterTitle === 'string' ? merged.chapterTitle : '';
    const prefix = `【${title}】\n\n`;
    const prompt = after.prompt as string;
    summary = title && prompt.startsWith(prefix) ? prompt.slice(prefix.length) : prompt;
  } else if (changedText) {
    summary = after.chapterText as string;
  }
  const data = summary === undefined ? merged : {
    ...merged, chapterText: summary, content: summary,
    sourceChapterRevision: revision,
    sourceHash: createHash('sha256').update(JSON.stringify({
      chapterId, title: merged.chapterTitle ?? '', summary,
      storyPreviewContract: merged.storyPreviewContract ?? null,
    })).digest('hex'),
  };
  return {
    flow: { ...incoming, nodes: incoming.nodes.map(node => node.id === id ? { ...previous, ...node, data } : node) },
    metadata: summary === undefined ? {} : { summary },
  };
}

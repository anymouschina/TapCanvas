import { isDeepStrictEqual } from 'node:util';

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function buildWorkflowClipSourceSnapshot(input: {
  clipId: string; sourceRanges: unknown; clipFacts: unknown;
}): Record<string, unknown> {
  if (!input.clipId.trim() || !Array.isArray(input.sourceRanges) || input.sourceRanges.length === 0
    || !record(input.clipFacts) || input.sourceRanges.some((range) => {
      const value = record(range);
      return !value || typeof value.sourceId !== 'string' || !value.sourceId.trim()
        || typeof value.sourceFingerprint !== 'string' || !value.sourceFingerprint.trim()
        || !Number.isInteger(value.sourceIndex) || Number(value.sourceIndex) < 0
        || !Number.isInteger(value.startOffset) || Number(value.startOffset) < 0
        || !Number.isInteger(value.endOffset) || Number(value.endOffset) <= Number(value.startOffset);
    })) throw new Error('workflow_clip_source_snapshot_invalid');
  return { clipId: input.clipId, sourceRanges: input.sourceRanges, clipFacts: input.clipFacts };
}

/** Read only protocol-identified packets from the owned immutable execution outputs. */
export function resolvePreparedClipSourceSnapshot(node: Record<string, unknown>, outputs: readonly unknown[]): void {
  const data = record(node.data);
  const clipId = typeof data?.workflowClipId === 'string' ? data.workflowClipId.trim() : '';
  if (!data || !clipId) throw new Error('prepared_video_clip_identity_missing');
  const candidates: Record<string, unknown>[] = [];
  const queue: unknown[] = [...outputs];
  let visited = 0;
  while (queue.length > 0) {
    if (++visited > 100_000) throw new Error('prepared_video_source_output_size_exceeded');
    const value = queue.pop();
    const item = record(value);
    if (!item) continue;
    if (item.protocolVersion === 'tapcanvas.clip-production-packet/v1' && item.clipId === clipId) {
      candidates.push(buildWorkflowClipSourceSnapshot({ clipId, sourceRanges: item.sourceRanges, clipFacts: item.clipFacts }));
      continue;
    }
    if (item.protocolVersion === 'tapcanvas.clip-production-media-item/v1') {
      queue.push(item.packet);
    } else if (item.protocolVersion === 'workflow.collection/v1' && Array.isArray(item.items)) {
      for (const entry of item.items) queue.push(record(entry)?.value);
    } else if (item.protocolVersion === '1' && record(item.ports) && Array.isArray(item.artifacts)) {
      queue.push(...Object.values(item.ports as Record<string, unknown>));
      for (const artifact of item.artifacts) queue.push(record(artifact)?.value);
      if (Array.isArray(item.itemRuns)) for (const run of item.itemRuns) {
        const receipt = record(run);
        if (receipt?.status !== 'success') continue;
        const ports = record(receipt.ports);
        if (ports) queue.push(...Object.values(ports));
        if (Array.isArray(receipt.artifacts)) for (const artifact of receipt.artifacts) queue.push(record(artifact)?.value);
      }
    }
  }
  if (candidates.length === 0 || candidates.some((snapshot) => !isDeepStrictEqual(snapshot, candidates[0]))) {
    throw new Error('prepared_video_frozen_source_packet_missing_or_ambiguous');
  }
  if (data.workflowEffectSourceSnapshot !== undefined && !isDeepStrictEqual(data.workflowEffectSourceSnapshot, candidates[0])) {
    throw new Error('prepared_video_frozen_source_snapshot_conflict');
  }
  data.workflowEffectSourceSnapshot = candidates[0];
}

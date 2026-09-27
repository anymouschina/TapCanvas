import { describe, expect, it } from 'vitest';
import { buildWorkflowClipSourceSnapshot, resolvePreparedClipSourceSnapshot } from './workflow-clip-source-snapshot';
const packet = { protocolVersion: 'tapcanvas.clip-production-packet/v1', clipId: 'clip-1',
  sourceRanges: [{ sourceId: 'chapter', sourceFingerprint: 'hash', sourceIndex: 0, startOffset: 0, endOffset: 10 }], clipFacts: { action: 'run' } };
const output = (value: unknown) => ({ protocolVersion: '1', ports: { packets: {
  protocolVersion: 'workflow.collection/v1', items: [{ value }],
} }, artifacts: [] });
describe('frozen Clip source snapshot', () => {
  it('restores only the exact Clip packet from typed execution output and media collections', () => {
    const node: Record<string, unknown> = { data: { workflowClipId: 'clip-1' } };
    resolvePreparedClipSourceSnapshot(node, [output(packet), output({ protocolVersion: 'tapcanvas.clip-production-media-item/v1', packet })]);
    expect(node).toEqual({ data: { workflowClipId: 'clip-1', workflowEffectSourceSnapshot: buildWorkflowClipSourceSnapshot(packet) } });
  });
  it('rejects missing and conflicting source receipts rather than fabricating a snapshot', () => {
    const node = { data: { workflowClipId: 'clip-1' } };
    expect(() => resolvePreparedClipSourceSnapshot(node, [output({ ...packet, clipId: 'other' })])).toThrow('missing_or_ambiguous');
    expect(() => resolvePreparedClipSourceSnapshot(node, [output(packet), output({ ...packet, clipFacts: { action: 'changed' } })])).toThrow('missing_or_ambiguous');
    expect(() => resolvePreparedClipSourceSnapshot(node, [{ arbitrary: packet }])).toThrow('missing_or_ambiguous');
  });
  it('does not overwrite an existing source snapshot with a different fingerprint', () => {
    const node = { data: { workflowClipId: 'clip-1', workflowEffectSourceSnapshot: { clipId: 'clip-1', sourceHash: 'existing-paid' } } };
    expect(() => resolvePreparedClipSourceSnapshot(node, [output(packet)])).toThrow('snapshot_conflict');
    expect(node.data.workflowEffectSourceSnapshot.sourceHash).toBe('existing-paid');
  });
});

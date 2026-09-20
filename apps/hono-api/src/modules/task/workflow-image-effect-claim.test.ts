import { describe, it, expect, vi } from 'vitest';
import { buildWorkflowImageClaim } from './workflow-image-effect-claim';
describe('durable image effect claim', () => {
  it('rejects the second CAS writer before paid submission and preserves the first claim', async () => {
    const current = { nodes: [] as Record<string, unknown>[] };
    const submit = vi.fn();
    const attempt = async () => {
      const patch = buildWorkflowImageClaim({ current, node: { data: { prompt: 'image' } }, nodeId:'asset', effectId:'effect', claimedAt:'now' });
      current.nodes.push(...patch.createNodes);
      await submit();
    };
    const result = await Promise.allSettled([attempt(), attempt()]);
    expect(result.map(item => item.status)).toEqual(['fulfilled','rejected']);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(current.nodes).toHaveLength(1);
    expect(() => buildWorkflowImageClaim({ current, node:{data:{}},nodeId:'asset',effectId:'effect',claimedAt:'later' })).toThrow('already claimed');
  });
});

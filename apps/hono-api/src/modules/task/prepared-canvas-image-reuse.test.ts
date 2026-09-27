import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../types';
import type { FlowRow } from '../flow/flow.repo';
import { reusePreparedCanvasImage } from './prepared-canvas-image-reuse';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), hydrate: vi.fn() }));
vi.mock('./agents-tool-bridge.image-reference-ids', () => ({ resolveExecutionImageReferences: mocks.resolve }));
vi.mock('../execution/execution.clip-production-node-runner', () => ({ hydrateWorkflowClipReusedImageNode: mocks.hydrate }));
const input = () => ({ c: { env: {} } as AppContext, requestUserId: 'owner', flowId: 'flow', chapterId: 'chapter',
  row: { project_id: 'project' } as FlowRow,
  node: { id: 'same-image-node', data: { existingAssetId: 'existing-image', existingProjectId: 'project',
    workflowExecutionId: 'execution', workflowExecutionFamilyId: 'family', workflowRuntimeNodeId: 'runtime',
    assetIdentity: 'effect', generationSpecVersion: 'project-asset-reuse/v1' } },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue([{ url: 'https://assets.test/saved.png' }]);
  mocks.hydrate.mockResolvedValue({ nodeId: 'same-image-node' });
});
describe('prepared image exact reuse', () => {
  it('hydrates the existing effect without requiring a generation prompt or paid submission', async () => {
    expect(await reusePreparedCanvasImage(input())).toMatchObject({ nodeId: 'same-image-node', reused: true,
      upstreamRequestAttempted: false, status: 'success' });
    expect(mocks.hydrate).toHaveBeenCalledWith({}, expect.objectContaining({
      effectAssetId: 'effect', existingAssetId: 'existing-image', imageUrl: 'https://assets.test/saved.png',
    }));
  });
  it('rejects wrong project and unresolved media without changing the node', async () => {
    const request = input(); request.node.data.existingProjectId = 'different';
    await expect(reusePreparedCanvasImage(request)).rejects.toThrow('different project');
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue([]);
    await expect(reusePreparedCanvasImage(input())).rejects.toThrow('no ready image');
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it('leaves actual generation on the existing submission path', async () => {
    const request = input(); request.node.data.existingAssetId = '';
    expect(await reusePreparedCanvasImage(request)).toBeNull();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});

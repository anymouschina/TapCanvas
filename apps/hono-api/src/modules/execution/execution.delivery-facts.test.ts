import { describe, expect, it } from 'vitest';
import { preparedNodeDelivery, verifyDeliveryFacts } from './execution.delivery-facts';

const facts = ['persisted', 'promptPersisted', 'dependenciesReady'];
describe('persisted delivery facts', () => {
  it('rejects a satisfied planning receipt without persisted dependency facts', () => {
    expect(verifyDeliveryFacts({ deliveryVerification: { status: 'satisfied', scope: 'planned_nodes_only' },
      deliveryEvidence: { clipCount: 5, imageCount: 15 } }, facts).status).toBe('unsatisfied');
  });
  it.each([
    [{ referenceId: 'image-1', url: '' }],
    [{ referenceId: 'image-1', url: 'blob:preview' }],
    [{ referenceId: 'wrong-id', url: 'https://assets.example/image.png' }],
    [{ referenceId: 'image-1', url: 'https://assets.example/image.png' }, { referenceId: 'image-1', url: 'https://assets.example/image.png' }],
    [],
  ])('requires an exact one-to-one dependency URL receipt: %j', (...dependencies) => {
    expect(verifyDeliveryFacts({ deliveryEvidence: { persisted: true, promptPersisted: true,
      requiredDependencyIds: ['image-1'], dependencies } }, facts).status).toBe('unsatisfied');
  });
  it('accepts a real image receipt and legal reference-free node', () => {
    for (const imageDependencies of [[], [{ referenceId: 'image-1', url: 'https://assets.example/image.png' }]]) {
      const result = preparedNodeDelivery({ nodeId: 'video-1', persisted: true, promptPersisted: true,
        referenceImageNodeIds: imageDependencies.map(image => image.referenceId), referenceAssetIds: [], imageDependencies });
      expect(verifyDeliveryFacts(result, facts).status).toBe('satisfied');
      expect(result.deliveryEvidence.videoSubmitted).toBe(false);
    }
  });
});

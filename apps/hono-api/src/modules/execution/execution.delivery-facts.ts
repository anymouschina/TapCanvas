import type { WorkflowVideoPreparationReceipt } from "./execution.video-node-preparation";
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);


function persistentUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch { return false; }
}

/** Structural facts are checked against the receiving node's declared contract. */
export function verifyDeliveryFacts(value: unknown, requiredFacts: unknown): Readonly<{
  status: 'satisfied' | 'unsatisfied'; missingFacts: readonly string[];
}> {
  if (!Array.isArray(requiredFacts) || requiredFacts.some(fact => typeof fact !== 'string')) {
    throw new Error('Workflow delivery required facts must be an array of fact names');
  }
  const evidence = record(value) && record(value.deliveryEvidence) ? value.deliveryEvidence : {};
  const missingFacts = requiredFacts.filter((fact: string) => {
    if (fact !== 'dependenciesReady') return evidence[fact] !== true;
    const required = evidence.requiredDependencyIds;
    const dependencies = evidence.dependencies;
    if (!Array.isArray(required) || required.some(id => typeof id !== 'string' || !id)
      || new Set(required).size !== required.length || !Array.isArray(dependencies)) return true;
    const ids = dependencies.map(dependency => record(dependency) ? dependency.referenceId : undefined);
    return dependencies.length !== required.length || new Set(ids).size !== ids.length
      || dependencies.some(dependency => !record(dependency)
        || !required.includes(dependency.referenceId) || !persistentUrl(dependency.url));
  });
  return { status: missingFacts.length === 0 ? 'satisfied' : 'unsatisfied', missingFacts };
}

export function preparedNodeDelivery(receipt: WorkflowVideoPreparationReceipt) {
  const requiredFacts = ['persisted', 'promptPersisted', 'dependenciesReady'];
  const deliveryEvidence = {
    nodeId: receipt.nodeId, persisted: receipt.persisted, promptPersisted: receipt.promptPersisted,
    requiredDependencyIds: [...new Set([...receipt.referenceImageNodeIds, ...receipt.referenceAssetIds])],
    dependencies: receipt.imageDependencies, videoSubmitted: false,
  };
  const verification = verifyDeliveryFacts({ deliveryEvidence }, requiredFacts);
  if (verification.status !== 'satisfied') {
    throw new Error(`Prepared node readback missing facts: ${verification.missingFacts.join(', ')}`);
  }
  return {
    ...receipt,
    expectedDelivery: { artifactType: 'tapcanvas.video-node/v1', requiredFacts },
    deliveryEvidence,
    deliveryVerification: { version: 2, ...verification, verifiedBy: 'persisted_node_readback', scope: 'dependencies_ready' },
  };
}

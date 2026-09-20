import type { ResolvedExecutionImageReference } from "../task/agents-tool-bridge.image-reference-ids";
import { readAssetObjectIdentityContracts } from "../task/video-reference-contract-binding";
import { assetObjectContractIdentityKey } from "../task/video-orchestrator.asset-object-contract";

/** Authoring aliases identify assets; provider numbering is compiled at submission. */
export function buildPreparedVideoReferences(
  contracts: unknown,
  references: readonly ResolvedExecutionImageReference[],
) {
  const assetInputs = references.map((reference) => ({
    url: reference.url,
    assetId: reference.assetId,
    assetRefId: reference.assetRefId || reference.referenceId,
    name: reference.name,
    role: "reference" as const,
  }));
  const referenceTokens = new Map<string, readonly string[]>();
  for (const contract of readAssetObjectIdentityContracts(contracts)) {
    const tokens = references.flatMap((reference, index) => {
      const matches = contract.referenceImageNodeIds.some((id) => id === reference.nodeId)
        || contract.referenceAssetIds.some((id) =>
          id === reference.referenceId || id === reference.assetId || id === reference.assetRefId);
      return matches ? [`@${assetInputs[index]!.assetRefId}`] : [];
    });
    referenceTokens.set(assetObjectContractIdentityKey(contract.kind, contract.name), [...new Set(tokens)]);
  }
  return { assetInputs, referenceTokens };
}

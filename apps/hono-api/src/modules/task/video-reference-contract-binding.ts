import type { ResolvedExecutionImageReference } from "./agents-tool-bridge.image-reference-ids";
import {
  assetObjectContractIdentityKey,
  type AssetReferenceIndicesByContractKey,
} from "./video-orchestrator.asset-object-contract";
import {
  purposeForAssetKind,
  type VideoReferenceImageBinding,
  type VideoReferenceImageManifestItem,
} from "./video-reference-manifest";

export type AssetObjectIdentityContract = {
  kind: string;
  name: string;
  physicalIdentityKey?: string;
  referenceImageNodeIds: string[];
  referenceAssetIds: string[];
  referenceRole?: string;
};

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(readTrimmedString).filter(Boolean))];
}

export function readAssetObjectIdentityContracts(value: unknown): AssetObjectIdentityContract[] {
  if (!Array.isArray(value)) return [];
  const contracts: AssetObjectIdentityContract[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const kind = readTrimmedString(record.kind);
    const name = readTrimmedString(record.name);
    if (!kind || !name) continue;
    const physicalIdentityKey = readTrimmedString(record.physicalIdentityKey);
    const referenceRole = readTrimmedString(record.referenceRole);
    contracts.push({
      kind,
      name,
      ...(physicalIdentityKey ? { physicalIdentityKey } : {}),
      referenceImageNodeIds: readUniqueStrings(record.referenceImageNodeIds),
      referenceAssetIds: readUniqueStrings(record.referenceAssetIds),
      ...(referenceRole ? { referenceRole } : {}),
    });
  }
  return contracts;
}

function resolvedReferenceMatchesAssetId(
  reference: ResolvedExecutionImageReference,
  assetIds: ReadonlySet<string>,
): boolean {
  return Boolean(
    (reference.assetId && assetIds.has(reference.assetId))
    || (reference.assetRefId && assetIds.has(reference.assetRefId)),
  );
}

/**
 * Attach every frozen object contract to the exact resolved media item that
 * will enter the provider content array. Both canvas-node and project-asset
 * references are first-class identities; no prompt text or display label is
 * inspected to infer the association.
 */
export function hydrateReferenceBindingsFromAssetContracts(input: {
  contracts: readonly AssetObjectIdentityContract[];
  resolvedReferences: readonly ResolvedExecutionImageReference[];
  bindings: ReadonlyMap<string, VideoReferenceImageBinding>;
  merge: (binding: VideoReferenceImageBinding) => void;
}): void {
  for (const contract of input.contracts) {
    const contractKey = assetObjectContractIdentityKey(contract.kind, contract.name);
    const contractNodeIds = new Set(contract.referenceImageNodeIds);
    const contractAssetIds = new Set(contract.referenceAssetIds);
    const assetKind = purposeForAssetKind(contract.kind);
    const matchedReferences = input.resolvedReferences.filter((reference) => (
      Boolean(reference.nodeId && contractNodeIds.has(reference.nodeId))
      || resolvedReferenceMatchesAssetId(reference, contractAssetIds)
    ));

    for (const reference of matchedReferences) {
      const current = input.bindings.get(reference.url);
      input.merge({
        url: reference.url,
        label: current?.label || `${contract.kind}:${contract.name}`,
        purpose: current?.purpose && current.purpose !== "other"
          ? current.purpose
          : assetKind ?? "other",
        purposes: [...(current?.purposes ?? []), ...(assetKind ? [assetKind] : [])],
        sourceNodeIds: [
          ...(current?.sourceNodeIds ?? []),
          ...(reference.nodeId ? [reference.nodeId] : []),
        ],
        assetContractKeys: [
          ...(current?.assetContractKeys ?? []),
          contractKey,
        ],
        ...(assetKind ? { assetKind } : {}),
        assetName: contract.name,
        ...(contract.referenceRole ? { referenceRole: contract.referenceRole } : {}),
      });
    }
  }
}

/**
 * Convert the final provider content order into the exact @图N addresses used
 * by the prompt renderer. Frozen contract keys are authoritative; node/name
 * matching remains as structural support for older manually-authored inputs.
 */
export function buildFinalAssetReferenceIndices(input: {
  contracts: readonly AssetObjectIdentityContract[];
  images: readonly VideoReferenceImageManifestItem[];
}): AssetReferenceIndicesByContractKey {
  const indices = new Map<string, readonly string[]>();
  for (const contract of input.contracts) {
    const contractKey = assetObjectContractIdentityKey(contract.kind, contract.name);
    const contractNodeIds = new Set(contract.referenceImageNodeIds);
    const expectedPurpose = purposeForAssetKind(contract.kind);
    const references = input.images.flatMap((image, index) => {
      const sameFrozenContract = (image.assetContractKeys ?? []).includes(contractKey);
      const sameSourceNode = image.sourceNodeIds.some((nodeId) => contractNodeIds.has(nodeId));
      const sameStructuredIdentity =
        (image.assetName === contract.name || image.assetName === contract.physicalIdentityKey)
        && expectedPurpose !== null
        && (image.assetKind === expectedPurpose || image.purposes.includes(expectedPurpose));
      return sameFrozenContract || sameSourceNode || sameStructuredIdentity
        ? [`@图${index + 1}`]
        : [];
    });
    if (references.length > 0) {
      const uniqueReferences = [...new Set(references)];
      indices.set(contractKey, uniqueReferences);
      if (contract.physicalIdentityKey && contract.physicalIdentityKey !== contract.name) {
        indices.set(
          assetObjectContractIdentityKey(contract.kind, contract.physicalIdentityKey),
          uniqueReferences,
        );
      }
    }
  }
  return indices;
}

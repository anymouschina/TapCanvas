import { frozenReadyProjectImages } from './execution.project-image-references';
import type { WorkflowProjectAssetSnapshot, WorkflowProjectContext } from './execution.project-context';

export type WorkflowProjectAssetLookup = Readonly<{
  referenceType: string;
  assetId?: string;
  physicalIdentityKey?: string;
  canonicalName?: string;
  assetReuseKey?: string;
  assetPurpose?: string;
  stateKey?: string;
}>;

type MatchField = keyof WorkflowProjectAssetLookup;
const identityFields = ['assetId', 'physicalIdentityKey', 'canonicalName', 'assetReuseKey'] as const;
const matchFields = ['referenceType', ...identityFields, 'assetPurpose', 'stateKey'] as const;
const read = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const canonicalName = (value: string): string => value.normalize('NFKC').trim();
const compareIds = (left: WorkflowProjectAssetSnapshot, right: WorkflowProjectAssetSnapshot): number =>
  left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0;

export type WorkflowProjectAssetLookupCandidate = Readonly<{
  assetId: string;
  aliases: readonly string[];
  canonicalName: string;
  referenceType: string | null;
  assetPurpose: string | null;
  stateKey: string | null;
  physicalIdentityKey: string | null;
  assetReuseKey: string | null;
}>;

export type WorkflowProjectAssetLookupResult = Readonly<{
  status: 'matched' | 'candidates' | 'no_match';
  basis: Readonly<{
    fields: readonly MatchField[];
    identity: 'exact_handle_or_key' | 'canonical_name_only';
    handleCount: number;
    mediaCount: number;
    /** Identity evidence does not claim visual quality or task suitability. */
    suitability: 'not_evaluated';
  }>;
  candidates: readonly WorkflowProjectAssetLookupCandidate[];
}>;

/** Exact frozen facts only. Names retrieve candidates and never establish identity. */
export function lookupWorkflowProjectImages(
  context: WorkflowProjectContext,
  match: WorkflowProjectAssetLookup,
): WorkflowProjectAssetLookupResult {
  if (!match || !read(match.referenceType) || !identityFields.some(field => read(match[field]))) {
    throw new Error('workflow_asset_lookup_identity_required');
  }
  const fields = matchFields.filter(field => match[field] !== undefined);
  for (const field of fields) {
    if (!read(match[field])) throw new Error(`workflow_asset_lookup_field_invalid:${field}`);
  }
  const expected = Object.fromEntries(fields.map(field => [field, field === 'canonicalName'
    ? canonicalName(match[field]!) : read(match[field])])) as Partial<Record<MatchField, string>>;
  const matches = frozenReadyProjectImages(context).filter(asset => {
    const facts: Readonly<Record<string, unknown>> = asset.sourceFacts;
    const observed: Readonly<Record<MatchField, string | null>> = {
      referenceType: read(asset.referenceType), assetId: asset.assetId,
      physicalIdentityKey: read(facts.physicalIdentityKey),
      canonicalName: canonicalName(asset.canonicalName), assetReuseKey: read(facts.assetReuseKey),
      assetPurpose: read(asset.assetPurpose), stateKey: read(facts.stateKey),
    };
    return fields.every(field => observed[field] === expected[field]);
  });
  const media = new Map<string, WorkflowProjectAssetSnapshot[]>();
  for (const asset of matches) {
    const key = asset.sourceFacts.mediaIdentityKey!;
    const group = media.get(key);
    if (group) group.push(asset);
    else media.set(key, [asset]);
  }
  const candidates = [...media.values()].map(group => {
    // Prefer a handle carrying a persisted physical identity. The alias group
    // is an equality of actual media, not an inferred equality of identities.
    const ordered = [...group].sort((left, right) => Number(Boolean(right.sourceFacts.physicalIdentityKey))
      - Number(Boolean(left.sourceFacts.physicalIdentityKey)) || compareIds(left, right));
    const asset = ordered[0]!;
    const facts: Readonly<Record<string, unknown>> = asset.sourceFacts;
    return { assetId: asset.assetId, aliases: ordered.slice(1).map(alias => alias.assetId),
      canonicalName: asset.canonicalName, referenceType: asset.referenceType,
      assetPurpose: asset.assetPurpose, stateKey: read(facts.stateKey),
      physicalIdentityKey: asset.sourceFacts.physicalIdentityKey,
      assetReuseKey: read(facts.assetReuseKey) };
  }).sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
  const exactIdentity = fields.some(field => field === 'assetId' || field === 'physicalIdentityKey' || field === 'assetReuseKey');
  return { status: candidates.length === 0 ? 'no_match' : exactIdentity && candidates.length === 1 ? 'matched' : 'candidates',
    basis: { fields, identity: exactIdentity ? 'exact_handle_or_key' : 'canonical_name_only',
      handleCount: matches.length, mediaCount: candidates.length, suitability: 'not_evaluated' }, candidates };
}

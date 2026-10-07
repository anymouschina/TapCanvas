export const FROZEN_REFERENCE_FACTS_KEYWORD: 'x-frozenReferenceFacts';
export const REFERENCE_FACT_EQUALITY_KEYWORD: 'x-referenceFactEquality';
export type FrozenReferenceFacts = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string | null>>>>>>;
export type ReferenceFactEqualityIssue = Readonly<{ path: string; message: string }>;
export type ReferenceFactObservation = Readonly<{ path: string; code: 'reference_fact_unknown'; message: string }>;
export function inspectReferenceFactEquality(
  schema: unknown,
  value: unknown,
  path: string,
  referenceFacts: unknown,
): { issues: ReferenceFactEqualityIssue[]; observations: ReferenceFactObservation[] };

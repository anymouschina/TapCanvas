export const SOURCE_PARTITION_KEYWORD: 'x-sourcePartition';
export const SOURCE_ALLOCATION_KEYWORD: 'x-sourceAllocation';
export type SourceLine = Readonly<{ lineId: string; text: string }>;
export type SourceUnitLedgerFacts = Readonly<{ sourceId: string; sourceFingerprint: string; lines: readonly SourceLine[] }>;
export type SourceUnit = Readonly<{
  unitId: string; sourceLineId: string; text: string;
} & ({ expression: 'spoken' | 'thought'; speakerName: string; delivery: 'on_screen' | 'off_screen' | 'voice_over' }
  | { expression: 'written' | 'narration'; speakerName: string | null; delivery: null })>;
export type SourceUnitLedger = Readonly<{ sourceId: string; sourceFingerprint: string; units: readonly SourceUnit[] }>;
export type AuthoredSourceUnit = Readonly<{
  sourceLineId: string; startOffset: number; endOffset: number;
} & ({ expression: 'spoken' | 'thought'; speakerName: string; delivery: 'on_screen' | 'off_screen' | 'voice_over' }
  | { expression: 'written' | 'narration'; speakerName: string | null; delivery: null })>;
export type AuthoredSourceUnitLedger = Readonly<{ sourceId: string; sourceFingerprint: string; units: readonly AuthoredSourceUnit[] }>;
export type SourceUnitIssue = Readonly<{ path: string; message: string }>;
export type SourceRelationIssue = SourceUnitIssue & Readonly<{ keyword: 'x-sourcePartition' | 'x-sourceAllocation' }>;
export type SourceUnitReference = Readonly<{ unitId: string; startOffset: number; endOffset: number }>;
/** Authored form: `startOffset` is host-derived cursor state; `endOffset` is only needed to split a unit across beats. */
export type AuthoredSourceUnitReference = Readonly<{ unitId: string; startOffset?: number; endOffset?: number }>;
export type SourceUnitBeat = Readonly<Record<string, unknown> & { sourceUnitRefs: readonly AuthoredSourceUnitReference[]; dialogueScript?: never }>;
export type SourceUnitDialogueLine = Readonly<{ lineId: string; speakerName: string; text: string; delivery: 'on_screen' | 'off_screen' | 'voice_over' }>;
export const sourceUnitLedgerSchema: Record<string, unknown>;
export const authoredSourceUnitLedgerSchema: Record<string, unknown>;
export function buildSourceLines(text: string): SourceLine[];
export function inspectSourceUnitLedger(value: unknown, facts: SourceUnitLedgerFacts): SourceUnitIssue[];
export function inspectAuthoredSourceUnitPartition(value: unknown, facts: unknown): SourceUnitIssue[];
export function reconstructSourceUnitLedger(value: unknown, facts: SourceUnitLedgerFacts): SourceUnitLedger;
export function bindSourceUnitLedgerSchema(facts: SourceUnitLedgerFacts): Record<string, unknown>;
export class SourceUnitReferenceError extends Error { readonly issues: readonly SourceUnitIssue[]; constructor(issues: readonly SourceUnitIssue[]); }
export function projectSourceUnitReferences<T extends SourceUnitBeat>(ledger: SourceUnitLedger, beats: readonly T[]): {
  beats: Array<Omit<T, 'dialogueScript'> & { dialogueScript: SourceUnitDialogueLine[] }>;
  speechLedger: Array<SourceUnitDialogueLine & { clipIndex: number }>;
};
export function inspectSourceRelations(schema: unknown, value: unknown, path?: string): SourceRelationIssue[];

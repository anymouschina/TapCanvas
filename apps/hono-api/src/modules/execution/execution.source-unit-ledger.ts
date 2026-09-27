import {
	buildSourceLines,
	sourceUnitLedgerSchema,
	reconstructSourceUnitLedger,
	type SourceUnitLedger,
	type SourceUnitLedgerFacts,
} from "../../../../../packages/schemas/source-unit-ledger/index.mjs";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Preserve authoritative source order; no quote parsing or speaker inference. */
export function sourceUnitLedgerFacts(deliveryContract: unknown): SourceUnitLedgerFacts {
	if (!isRecord(deliveryContract) || !isRecord(deliveryContract.canvasFacts)
		|| !Array.isArray(deliveryContract.canvasFacts.authoritativeSources)) {
		throw new Error("Source partition requires frozen delivery-contract.canvasFacts.authoritativeSources");
	}
	const sources = deliveryContract.canvasFacts.authoritativeSources;
	if (sources.length === 0 || !sources.every(isRecord)) throw new Error("Source partition requires non-empty source records");
	const lineage = resolveWorkflowAuthoritativeSourceLineage(sources);
	const lines = sources.flatMap((source, sourceIndex) => {
		if (typeof source.content !== "string" || !source.content.trim()) {
			throw new Error(`authoritativeSources[${sourceIndex}].content must be non-empty`);
		}
		return buildSourceLines(source.content).map((line) => ({ ...line, lineId: `source-${sourceIndex}:${line.lineId}` }));
	});
	return { ...lineage, lines };
}

export function parseSourceUnitLedger(value: unknown): SourceUnitLedger {
	const parsed: unknown = isRecord(value) && typeof value.text === "string" ? JSON.parse(value.text) : value;
	const issues = validateWorkflowToolArguments(sourceUnitLedgerSchema, parsed);
	if (issues.length) throw new Error(`source-ledger: ${issues.map((issue) => issue.message).join(" | ")}`);
	return parsed as SourceUnitLedger;
}

/** Materialize author-owned UTF-16 ranges from frozen source without asking the model to copy text. */
export function canonicalizeSourceUnitLedger(value: unknown, facts: SourceUnitLedgerFacts): Readonly<{
	ledger: SourceUnitLedger;
	reconstructedUnits: number;
}> {
	const parsed: unknown = isRecord(value) && typeof value.text === "string" ? JSON.parse(value.text) : value;
	const ledger = reconstructSourceUnitLedger(parsed, facts);
	return { ledger, reconstructedUnits: ledger.units.length };
}

/** Bind the independent ledger as host-owned validation facts for chapter allocation. */
export function bindSourceAllocationSchema(schema: Record<string, unknown>, ledger: SourceUnitLedger): Record<string, unknown> {
	return {
		...schema,
		"x-sourceAllocation": {
			ledger,
			unitRanges: ledger.units.map((unit) => ({ unitId: unit.unitId, startOffset: 0, endOffset: unit.text.length })),
		},
	};
}

import type { WorkflowPersistedInputSource } from "./execution.retrieval-input-projection";

type Inputs = Readonly<Record<string, readonly unknown[]>>;
type Projection = Readonly<{ source: string; reference: string; requiredTool: string }>;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === "object";
}

function valueType(value: unknown): string {
	return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/** Model-facing disclosure only; persisted inputs and repair identities are untouched. */
export function collectWorkflowInputReadProjections(
	inputs: Inputs,
	identity: Readonly<{ executionId: string; persistedInputSource?: WorkflowPersistedInputSource }>,
	options: Readonly<{ excludedSources?: readonly string[] }> = {},
) {
	const projections: Projection[] = [];
	const diagnostics = {
		projected: 0, retainedWithoutPersistedSource: 0, retainedAmbiguous: 0,
		retainedUnmatched: 0, retainedWithoutSavings: 0, retainedInvalidPath: 0,
		sourceCharacters: 0, referenceCharacters: 0,
		references: [] as Array<{ nodeId: string; revision: string; path: string[] }>,
	};
	const persisted = identity.persistedInputSource;
	if (!persisted?.nodeId || !persisted.revision) {
		diagnostics.retainedWithoutPersistedSource = Object.values(inputs).reduce((sum, values) => sum + values.length, 0);
		return { projections, diagnostics };
	}
	const locations = new Map<string, string[][]>();
	const index = (value: unknown, path: string[]): void => {
		if (!isContainer(value) || path.length > 32) return;
		const serialized = JSON.stringify(value);
		const paths = locations.get(serialized) ?? [];
		paths.push(path);
		locations.set(serialized, paths);
		for (const [key, child] of Object.entries(value)) index(child, [...path, key]);
	};
	index(persisted.inputs, []);
	const excluded = new Set(options.excludedSources ?? []);
	const containsExcluded = (value: unknown, depth = 0): boolean => isContainer(value)
		&& (depth > 32 || excluded.has(JSON.stringify(value))
			|| Object.values(value).some((child) => containsExcluded(child, depth + 1)));
	const emitted = new Set<string>();
	const visit = (value: unknown, depth: number): void => {
		if (!isContainer(value) || depth > 32) return;
		const source = JSON.stringify(value);
		if (excluded.has(source) || emitted.has(source)) return;
		// Disclose independently addressable descendants first. A single opaque
		// parent handle otherwise forces the author to page through unrelated
		// siblings just to reach one source. Keep projections non-overlapping.
		for (const child of Object.values(value)) visit(child, depth + 1);
		const containsProjected = (child: unknown): boolean => isContainer(child)
			&& (emitted.has(JSON.stringify(child)) || Object.values(child).some(containsProjected));
		if (Object.values(value).some(containsProjected)) return;
		const paths = locations.get(source) ?? [];
		const path = paths[0];
		const validPath = path && path.length <= 32 && path.every((segment) => segment.length <= 512);
		if (paths.length === 0) diagnostics.retainedUnmatched += 1;
		else if (paths.length > 1) diagnostics.retainedAmbiguous += 1;
		else if (!validPath) diagnostics.retainedInvalidPath += 1;
		else if (!containsExcluded(value)) {
			const reference = JSON.stringify({
				projectionVersion: "workflow.input-reference/v1",
				kind: valueType(value), jsonCharacters: source.length, characterUnit: "utf16_code_units",
				...(Array.isArray(value) ? { itemCount: value.length } : {
					fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, valueType(child)])),
				}),
				contentRead: {
					tool: "tapcanvas_execution_node_runs_get",
					args: { executionId: identity.executionId, nodeId: persisted.nodeId, revision: persisted.revision,
						view: "content", field: "input", format: "json", path, offset: 0, textLimit: 12000 },
					pagination: { next: "nextOffset", consistency: "revision", encoding: "json",
						instruction: "Concatenate text pages in offset order before parsing a complete JSON value. Metadata is not read content." },
				},
			});
			if (reference.length < source.length) {
				projections.push({ source, reference, requiredTool: "tapcanvas_execution_node_runs_get" });
				emitted.add(source);
				diagnostics.projected += 1;
				diagnostics.sourceCharacters += source.length;
				diagnostics.referenceCharacters += reference.length;
				diagnostics.references.push({ nodeId: persisted.nodeId, revision: persisted.revision, path });
				return;
			}
			diagnostics.retainedWithoutSavings += 1;
		}
	};
	for (const values of Object.values(inputs)) for (const value of values) visit(value, 0);
	return { projections, diagnostics };
}

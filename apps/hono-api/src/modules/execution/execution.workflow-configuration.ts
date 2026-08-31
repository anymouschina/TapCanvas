type JsonRecord = Record<string, unknown>;

const INHERITED_MEDIA_CONFIGURATION_FIELDS = [
	"workflowVideoModelSelection",
	"workflowVideoModelKey",
	"workflowVideoResolution",
	"workflowVideoAspectRatio",
	"workflowImageModelSelection",
	"workflowImageModelKey",
	"workflowImageAspectRatio",
	"workflowImageSize",
] as const;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(record: JsonRecord, field: string): string {
	const value = record[field];
	return typeof value === "string" ? value.trim() : "";
}

function workflowNodeIdentity(node: JsonRecord): string {
	const data = isRecord(node.data) ? node.data : {};
	return [
		readString(data, "workflowInstanceId"),
		readString(data, "workflowNodeId"),
	].join("\u0000");
}

/**
 * Materialize author-declared media configuration inheritance into a frozen
 * workflow graph. Variant nodes (for example the fast-launch branch) point at
 * one canonical configuration node instead of copying model/spec values that
 * can later drift independently.
 *
 * This is deliberately structural: it only resolves exact node identities and
 * copies a fixed set of execution fields. It does not inspect prompts, labels,
 * workflow meaning, account preferences, or user prose.
 */
export function materializeWorkflowConfigurationInheritance(
	nodesInput: readonly unknown[],
): unknown[] {
	const nodes = nodesInput.map((value) => isRecord(value) ? value : null);
	const byIdentity = new Map<string, JsonRecord>();
	for (const node of nodes) {
		if (!node) continue;
		const identity = workflowNodeIdentity(node);
		if (identity !== "\u0000") byIdentity.set(identity, node);
	}

	return nodesInput.map((rawNode, index) => {
		const node = nodes[index];
		if (!node || !isRecord(node.data)) return rawNode;
		const targetData = node.data;
		const sourceNodeId = readString(targetData, "workflowConfigurationSourceNodeId");
		if (!sourceNodeId) return rawNode;
		const workflowInstanceId = readString(targetData, "workflowInstanceId");
		if (!workflowInstanceId) {
			throw new Error("workflow configuration inheritance requires workflowInstanceId");
		}
		const sourceNode = byIdentity.get(`${workflowInstanceId}\u0000${sourceNodeId}`);
		if (!sourceNode || !isRecord(sourceNode.data)) {
			throw new Error(`workflow configuration source node is missing: ${sourceNodeId}`);
		}
		if (readString(sourceNode.data, "workflowConfigurationSourceNodeId")) {
			throw new Error(`workflow configuration source cannot inherit from another node: ${sourceNodeId}`);
		}
		const nextData: JsonRecord = { ...targetData };
		for (const field of INHERITED_MEDIA_CONFIGURATION_FIELDS) {
			const sourceValue = readString(sourceNode.data, field);
			const targetValue = readString(targetData, field);
			if (sourceValue && targetValue && sourceValue !== targetValue) {
				throw new Error(
					`workflow configuration drift at ${readString(targetData, "workflowNodeId") || "unknown"}.${field}: expected ${sourceValue}, got ${targetValue}`,
				);
			}
			if (sourceValue) nextData[field] = sourceNode.data[field];
		}
		return { ...node, data: nextData };
	});
}

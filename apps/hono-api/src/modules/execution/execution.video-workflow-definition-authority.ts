import {
	VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
	VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
	VIDEO_PRODUCTION_WORKFLOW_KEY,
} from "@tapcanvas/video-orchestrator-protocol";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as JsonRecord
		: null;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function parseFlowData(value: unknown): JsonRecord {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value) as unknown;
		} catch (error: unknown) {
			throw new Error(`Workflow definition is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const root = record(parsed);
	if (!root) throw new Error("Workflow definition must be an object");
	return root;
}

function nodeData(node: unknown): JsonRecord {
	return record(record(node)?.data) ?? {};
}

function nodeId(node: unknown): string {
	return stringValue(record(node)?.id);
}

function isAuthoredWorkflowNode(node: unknown): boolean {
	const raw = record(node);
	const data = nodeData(node);
	const kind = stringValue(data.kind);
	// The definition authority belongs to the editable workflow graph. Runtime
	// output nodes may retain the workflow key while carrying an older snapshot
	// of the stage that produced them; they must not make the authored template
	// appear outdated. The group container is authored too, even though it has
	// no workflowTrigger/workflowStage kind.
	return raw?.type === "groupNode"
		|| raw?.type === "group"
		|| kind === "workflowTrigger"
		|| kind === "workflowStage";
}

/**
 * Collection inputs that describe clips and the assets consumed by those
 * clips cannot be aligned by ordinal position: the asset collection contains
 * one item per asset while the clip collection contains one item per clip.
 * The canonical video workflow therefore carries an explicit keyed-join
 * contract on any authored node exposing both ports.  Keep this check at the
 * diagnostic boundary so collection alignment drift remains observable.
 * Saved workflow contracts are never rewritten from template metadata.
 */
function hasCanonicalClipAssetJoin(spec: JsonRecord): boolean {
	const inputPorts = Array.isArray(spec.inputPorts)
		? spec.inputPorts.filter((value): value is string => typeof value === "string")
		: [];
	if (!inputPorts.includes("clip-contexts") || !inputPorts.includes("asset-bindings")) return true;
	const alignment = record(spec.inputAlignment);
	return alignment?.strategy === "keyed_join"
		&& alignment.primaryPort === "clip-contexts"
		&& alignment.primaryKeyPath === "beat.clipId"
		&& alignment.candidateKeyPath === "assetPlan.consumerClipIds"
		&& Array.isArray(alignment.candidatePorts)
		&& alignment.candidatePorts.length === 1
		&& alignment.candidatePorts[0] === "asset-bindings";
}

export type VideoWorkflowCanvasDefinitionState = Readonly<{
	applicable: boolean;
	current: boolean;
	requiredVersion: typeof VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION;
	requiredFingerprint: typeof VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT;
	observedVersions: readonly number[];
	observedFingerprints: readonly string[];
	invalidNodeIds: readonly string[];
}>;

/**
 * Inspect only immutable structural provenance carried by the authored graph.
 * Version is a human-readable cutover marker; the fingerprint is the actual
 * template identity. Differences are diagnostics only; execution validates
 * the actual saved graph independently of its template origin.
 */
export function inspectVideoWorkflowCanvasDefinition(
	flowData: unknown,
): VideoWorkflowCanvasDefinitionState {
	const root = parseFlowData(flowData);
	const nodes = Array.isArray(root.nodes) ? root.nodes : [];
	const canonicalNodes = nodes.filter((node) => (
		stringValue(nodeData(node).workflowKey) === VIDEO_PRODUCTION_WORKFLOW_KEY
		&& isAuthoredWorkflowNode(node)
	));
	if (canonicalNodes.length === 0) {
		return {
			applicable: false,
			current: true,
			requiredVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
			requiredFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
			observedVersions: [],
			observedFingerprints: [],
			invalidNodeIds: [],
		};
	}
	const observedVersions = [...new Set(canonicalNodes.flatMap((node) => {
		const value = nodeData(node).workflowCanvasDefinitionVersion;
		return typeof value === "number" && Number.isInteger(value) ? [value] : [];
	}))].sort((left, right) => left - right);
	const observedFingerprints = [...new Set(canonicalNodes.flatMap((node) => {
		const value = stringValue(nodeData(node).workflowCanvasDefinitionFingerprint);
		return value ? [value] : [];
	}))].sort();
	const invalidNodeIds = canonicalNodes.flatMap((node) => {
		const data = nodeData(node);
		const spec = record(data.workflowAtomicSpec);
		return data.workflowCanvasDefinitionVersion === VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION
			&& stringValue(data.workflowCanvasDefinitionFingerprint) === VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT
			&& (!spec || hasCanonicalClipAssetJoin(spec))
			? []
			: [nodeId(node)];
	});
	return {
		applicable: true,
		current: invalidNodeIds.length === 0,
		requiredVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
		requiredFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
		observedVersions,
		observedFingerprints,
		invalidNodeIds,
	};
}

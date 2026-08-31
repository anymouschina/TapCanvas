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

export type VideoWorkflowCanvasDefinitionState = Readonly<{
	applicable: boolean;
	current: boolean;
	requiredVersion: typeof VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION;
	requiredFingerprint: typeof VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT;
	observedVersions: readonly number[];
	observedFingerprints: readonly string[];
	invalidNodeIds: readonly string[];
}>;

export type VideoWorkflowDefinitionAuthorityV1 = Readonly<{
	protocolVersion: "tapcanvas.workflow-definition-authority/v1";
	workflowKey: typeof VIDEO_PRODUCTION_WORKFLOW_KEY;
	canvasDefinitionVersion: typeof VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION;
	canvasDefinitionFingerprint: typeof VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT;
}>;

export function createVideoWorkflowDefinitionAuthority(
	state: VideoWorkflowCanvasDefinitionState,
): VideoWorkflowDefinitionAuthorityV1 | null {
	if (!state.applicable) return null;
	if (!state.current) {
		throw new Error("Cannot freeze authority for an outdated one-click production definition");
	}
	return {
		protocolVersion: "tapcanvas.workflow-definition-authority/v1",
		workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
		canvasDefinitionVersion: state.requiredVersion,
		canvasDefinitionFingerprint: state.requiredFingerprint,
	};
}

/**
 * Inspect only immutable structural provenance carried by the authored graph.
 * Version is a human-readable cutover marker; the fingerprint is the actual
 * executable-definition identity and prevents two different templates from
 * being treated as the same version.
 */
export function inspectVideoWorkflowCanvasDefinition(
	flowData: unknown,
): VideoWorkflowCanvasDefinitionState {
	const root = parseFlowData(flowData);
	const nodes = Array.isArray(root.nodes) ? root.nodes : [];
	const canonicalNodes = nodes.filter((node) => (
		stringValue(nodeData(node).workflowKey) === VIDEO_PRODUCTION_WORKFLOW_KEY
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
		return data.workflowCanvasDefinitionVersion === VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION
			&& stringValue(data.workflowCanvasDefinitionFingerprint) === VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT
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

import type { NodeRunRow } from "../execution/execution.repo";
import type {
	AsyncAgentContinuationArtifactDependencyV2,
	AsyncAgentContinuationMaterializedArtifactV1,
} from "./async-agent-continuation";

const PERSISTENT_MEDIA_ARTIFACT_TYPES = {
	"tapcanvas.image/v1": "image",
	"tapcanvas.video/v1": "video",
	"tapcanvas.master-video/v1": "video",
	"tapcanvas.audio/v1": "audio",
} as const satisfies Record<string, "image" | "video" | "audio">;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function readPersistentMediaType(value: unknown): "image" | "video" | "audio" | null {
	if (typeof value !== "string") return null;
	return PERSISTENT_MEDIA_ARTIFACT_TYPES[value as keyof typeof PERSISTENT_MEDIA_ARTIFACT_TYPES] ?? null;
}

function expectedDependencyMediaType(
	artifactId: string,
): "image" | "video" | "audio" | null {
	const separator = artifactId.indexOf(":");
	const prefix = separator < 0 ? artifactId : artifactId.slice(0, separator);
	return prefix === "image" || prefix === "video" || prefix === "audio" ? prefix : null;
}

/**
 * Converts a successful workflow delivery-verifier output into the same
 * trusted materialization channel used by provider task results. The input is
 * deliberately limited to protocol fields: terminal node status, the
 * delivery verifier's exact artifact type, verified item count and a real
 * HTTP(S) value. Prompt text and workflow/node names never participate.
 */
export function collectWorkflowExecutionMaterializedArtifacts(input: Readonly<{
	dependency: AsyncAgentContinuationArtifactDependencyV2;
	nodeRuns: readonly Pick<
		NodeRunRow,
		"execution_id" | "node_id" | "status" | "output_refs" | "finished_at"
	>[];
}>): AsyncAgentContinuationMaterializedArtifactV1[] {
	if (
		input.dependency.runProtocol !== "workflow_execution_family" ||
		!input.dependency.runId
	) return [];
	const expectedMediaType = expectedDependencyMediaType(input.dependency.artifactId);
	if (!expectedMediaType) return [];
	const artifacts: AsyncAgentContinuationMaterializedArtifactV1[] = [];
	const urls = new Set<string>();
	for (const nodeRun of input.nodeRuns) {
		if (nodeRun.status !== "success" || !nodeRun.finished_at || !nodeRun.output_refs) continue;
		let output: unknown;
		try {
			output = JSON.parse(nodeRun.output_refs) as unknown;
		} catch {
			continue;
		}
		if (!isRecord(output) || !isRecord(output.evidence)) continue;
		const verifiedItems = output.evidence.verifiedItems;
		const artifactType = output.evidence.expectedArtifactType;
		const mediaType = readPersistentMediaType(artifactType);
		if (
			output.evidence.executorCompleted !== true ||
			typeof verifiedItems !== "number" ||
			!Number.isInteger(verifiedItems) ||
			verifiedItems < 1 ||
			mediaType !== expectedMediaType ||
			!Array.isArray(output.artifacts)
		) continue;
		for (const candidate of output.artifacts) {
			if (!isRecord(candidate) || candidate.type !== artifactType) continue;
			const assetUrl = typeof candidate.value === "string" ? candidate.value.trim() : "";
			if (!assetUrl || assetUrl.length > 8_000 || !isHttpUrl(assetUrl) || urls.has(assetUrl)) continue;
			urls.add(assetUrl);
			artifacts.push({
				version: 1,
				artifactId: input.dependency.artifactId,
				mediaType,
				nodeId: nodeRun.node_id,
				taskId: null,
				runId: input.dependency.runId,
				sourceExecutionId: nodeRun.execution_id,
				assetId: null,
				assetUrl,
				observedAt: nodeRun.finished_at,
				source: "workflow_execution",
			});
		}
	}
	return artifacts;
}

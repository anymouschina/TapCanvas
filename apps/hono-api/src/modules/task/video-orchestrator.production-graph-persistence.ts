import {
	listAuthoringArtifacts,
	stableContentHash,
	upsertAuthoringArtifact,
} from "./video-orchestrator.authoring.repo";
import { AUTHORING_DELIVERY_VERIFY_NODE_KEY } from "./video-orchestrator.authoring-graph";
import { buildProductionGraphEvidenceWrites } from "./video-orchestrator.production-graph-evidence";
import type { VideoRunRow } from "./video-run.repo";

export type ProductionGraphOrchestrationEvidence = Readonly<{
	state?: unknown;
	clips?: unknown;
	concatVideoUrl?: unknown;
	masterVideoUrl?: unknown;
	deliveryEvidence?: unknown;
	finishingVerification?: unknown;
}>;

/**
 * Persist the factual production graph projection emitted by one orchestration
 * boundary. The same writer is shared by the normal drive-cycle result and by
 * pre-external phase transitions, so the workflow graph cannot lag behind a
 * long-running provider/media-worker call.
 */
export async function persistProductionGraphEvidence(input: {
	run: VideoRunRow;
	orchestration: ProductionGraphOrchestrationEvidence;
	nowIso: string;
}): Promise<void> {
	// Direct single-video runs intentionally do not have a BeatSheet graph.
	if (!input.run.beat_sheet) return;
	const writes = buildProductionGraphEvidenceWrites({
		runId: input.run.id,
		state: input.orchestration.state,
		clips: input.orchestration.clips,
		concatVideoUrl: input.orchestration.concatVideoUrl,
		masterVideoUrl: input.orchestration.masterVideoUrl,
		deliveryEvidence: input.orchestration.deliveryEvidence,
		finishingVerification: input.orchestration.finishingVerification,
	});
	if (writes.length === 0) return;
	const existing = new Map(
		(await listAuthoringArtifacts(input.run.id)).map((artifact) => [artifact.artifact_key, artifact]),
	);
	for (const write of writes) {
		const contentHash = stableContentHash(write.payload);
		const previous = existing.get(write.artifactKey);
		// Generated media stays immutable, but the derived delivery-verifier node
		// may reflect newly available or strengthened evidence.
		if (
			previous?.status === "ready" &&
			write.status !== "ready" &&
			write.artifactKey !== AUTHORING_DELIVERY_VERIFY_NODE_KEY
		) continue;
		if (previous?.status === write.status && previous.content_hash === contentHash) continue;
		await upsertAuthoringArtifact({
			runId: input.run.id,
			artifactKey: write.artifactKey,
			contentHash,
			derivedFrom: write.derivedFrom,
			status: write.status,
			payload: JSON.stringify(write.payload),
			...(write.error !== undefined ? { error: write.error } : {}),
			nowIso: input.nowIso,
		});
	}
}

import { describe, expect, it } from "vitest";
import {
	WRITER_OUTPUT_CONTRACT_VERSION,
	WRITER_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
	inspectWriterRepairWindow,
	isCancelledWriterRecoveryCandidate,
	markWriterSiblingCancellationRepairable,
	normalizeWriterContractMigrationForRepair,
	normalizeWriterExecutionFailureForRepair,
	planClipRepair,
	planPersistedWriterArtifact,
} from "./video-orchestrator.writer-repair-policy";

describe("writer single-submission terminal policy", () => {
	it("keeps only never-started and already-running writer work resumable", () => {
		expect(planPersistedWriterArtifact({ status: "ready", payload: {} })).toMatchObject({
			disposition: "ready",
			resumable: false,
		});
		expect(planPersistedWriterArtifact({ status: "pending", payload: {} })).toMatchObject({
			disposition: "pending_dispatch",
			resumable: true,
		});
		expect(planPersistedWriterArtifact({ status: "running", payload: {} })).toMatchObject({
			disposition: "running_resume",
			resumable: true,
		});
	});

	it("makes every failed writer artifact terminal regardless of historical repair markers", () => {
		for (const payload of [
			{},
			{ repairable: true, repairAttempt: 1 },
			{ repairable: true, executionRecoveryAttempt: 4, agentId: "agent-1" },
			{ repairable: true, writerContractVersion: 1, sourceHash: "source-1" },
		]) {
			expect(planPersistedWriterArtifact({ status: "failed", payload })).toMatchObject({
				disposition: "blocked",
				resumable: false,
				maxAttempts: 0,
				normalizedPayload: { repairable: false },
				reason: expect.stringContaining(WRITER_STRUCTURED_OUTPUT_SUBMISSION_POLICY),
			});
		}
	});

	it("never returns a content correction plan after a failed submission", () => {
		expect(planClipRepair({
			status: "failed",
			payload: { repairable: true, repairAttempt: 2 },
			maxAttempts: 99,
		})).toEqual({
			repair: false,
			attempt: 2,
			reason: `${WRITER_STRUCTURED_OUTPUT_SUBMISSION_POLICY}: 首次提交失败只记录，不重派`,
		});
	});

	it("projects failed clips as blocked instead of a pending repair window", () => {
		expect(inspectWriterRepairWindow([
			{
				artifact_key: "clip:0",
				status: "failed",
				payload: JSON.stringify({ repairable: true, repairAttempt: 1 }),
			},
			{
				artifact_key: "clip:1",
				status: "ready",
				payload: JSON.stringify({ writerResultHash: "ready-1" }),
			},
		])).toEqual({
			pending: false,
			failedClipCount: 1,
			repairableClipCount: 0,
			blockedClipCount: 1,
			pendingClipCount: 0,
			runningClipCount: 0,
			resumableClipCount: 0,
			nextAttempt: null,
			maxAttempts: 0,
		});
	});

	it("does not revive a cancelled writer failure", () => {
		expect(isCancelledWriterRecoveryCandidate({
			state: "cancelled",
			authoringState: "authoring_failed",
			totalClips: 0,
			clipsDone: 0,
			writerRecovery: {
				pending: true,
				failedClipCount: 1,
				repairableClipCount: 1,
				blockedClipCount: 0,
				pendingClipCount: 0,
				runningClipCount: 0,
				resumableClipCount: 1,
				nextAttempt: 1,
				maxAttempts: 3,
			},
		})).toBe(false);
	});

	it("turns historical migration, execution and sibling markers into record-only evidence", () => {
		expect(normalizeWriterContractMigrationForRepair({
			repairable: true,
			repairAttempt: 3,
			writerContractVersion: 1,
		})).toEqual({
			repairable: false,
			repairAttempt: 3,
			writerContractVersion: WRITER_OUTPUT_CONTRACT_VERSION,
		});
		expect(normalizeWriterExecutionFailureForRepair({
			agentId: "agent-1",
			repairable: true,
			executionRecoveryAttempt: 4,
		})).toEqual({
			agentId: "agent-1",
			repairable: false,
			executionRecoveryAttempt: 4,
		});
		expect(markWriterSiblingCancellationRepairable({
			repairable: true,
			repairProblems: ["prior"],
		}, "sibling cancelled")).toEqual({
			repairable: false,
			repairProblems: ["prior", "sibling cancelled"],
		});
	});
});

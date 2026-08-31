import { describe, expect, it } from "vitest";
import type {
	CodexDeliveryEvidence,
	CodexExpectedDelivery,
} from "@tapcanvas/codex-task-protocol";
import { verifyCodexDelivery } from "./codex-delivery-verifier";

const expectedDelivery: CodexExpectedDelivery = {
	kind: "workspace_change_with_verified_preview",
	workspaceId: "web",
	requiredEvidence: ["codex_turn", "tests", "build", "preview"],
};

const completedAt = "2026-07-31T08:00:05.000Z";
const command = (
	name: "install" | "test" | "build" | "preview",
	exitCode = 0,
) => ({
	name,
	executor: "vercel-sandbox" as const,
	exitCode,
	startedAt: "2026-07-31T08:00:00.000Z",
	completedAt,
	logSha256: "a".repeat(64),
	logTail: "ok",
});

function completeEvidence(): CodexDeliveryEvidence {
	return {
		source: {
			sha256: "b".repeat(64),
			archiveBytes: 128,
		},
		codex: {
			threadId: "thread-1",
			turnId: "turn-1",
			status: "completed",
			outcome: "workspace_changed",
			changedFiles: ["src/App.tsx"],
			summary: "implemented",
		},
		build: {
			executor: "vercel-sandbox",
			executionId: "sandbox-1",
			commands: [
				command("install"),
				command("test"),
				command("build"),
				command("preview"),
			],
		},
		preview: {
			previewId: "preview-1234567890",
			url: "https://preview.example.test",
			expiresAt: "2026-07-31T09:00:00.000Z",
			isolatedOrigin: true,
		},
	};
}

describe("verifyCodexDelivery", () => {
	it("only satisfies a task with Codex, test, build and preview evidence", () => {
		const result = verifyCodexDelivery({
			expectedDelivery,
			deliveryEvidence: completeEvidence(),
			nowIso: completedAt,
		});
		expect(result.status).toBe("satisfied");
		expect(result.missingCriteria).toEqual([]);
	});

	it("does not treat a completed Codex text turn as a delivered application", () => {
		const evidence = completeEvidence();
		evidence.build = null;
		evidence.preview = null;
		const result = verifyCodexDelivery({
			expectedDelivery,
			deliveryEvidence: evidence,
			nowIso: completedAt,
		});
		expect(result.status).toBe("failed");
		expect(result.missingCriteria).toEqual(["tests", "build", "preview"]);
	});

	it("rejects a non-zero test command even when build and preview exist", () => {
		const evidence = completeEvidence();
		if (!evidence.build) throw new Error("test fixture build missing");
		evidence.build.commands = [
			command("test", 1),
			command("build"),
			command("preview"),
		];
		const result = verifyCodexDelivery({
			expectedDelivery,
			deliveryEvidence: evidence,
			nowIso: completedAt,
		});
		expect(result.missingCriteria).toEqual(["tests"]);
	});

	it("rejects a completed Codex turn that changed no files", () => {
		const evidence = completeEvidence();
		if (!evidence.codex) throw new Error("test fixture Codex evidence missing");
		evidence.codex.changedFiles = [];
		const result = verifyCodexDelivery({
			expectedDelivery,
			deliveryEvidence: evidence,
			nowIso: completedAt,
		});
		expect(result.missingCriteria).toEqual(["codex_turn"]);
	});

	it("rejects an expired or unprobed preview", () => {
		const evidence = completeEvidence();
		if (!evidence.preview || !evidence.build) {
			throw new Error("test fixture preview evidence missing");
		}
		evidence.preview.expiresAt = completedAt;
		evidence.build.commands = evidence.build.commands.filter(
			(item) => item.name !== "preview",
		);
		const result = verifyCodexDelivery({
			expectedDelivery,
			deliveryEvidence: evidence,
			nowIso: completedAt,
		});
		expect(result.missingCriteria).toEqual(["preview"]);
	});

	it.each(["needs_input", "response_only"] as const)(
		"accepts a structured %s turn without file or build evidence",
		(outcome) => {
			const evidence = completeEvidence();
			if (!evidence.codex) throw new Error("test fixture Codex evidence missing");
			evidence.codex.outcome = outcome;
			evidence.codex.changedFiles = [];
			evidence.codex.summary = "Please choose the target layout.";
			evidence.build = null;
			evidence.preview = null;
			const responseDelivery: CodexExpectedDelivery = {
				kind: "codex_response",
				workspaceId: "web",
				requiredEvidence: ["codex_turn"],
			};

			const result = verifyCodexDelivery({
				expectedDelivery: responseDelivery,
				deliveryEvidence: evidence,
				nowIso: completedAt,
			});

			expect(result.status).toBe("satisfied");
			expect(result.missingCriteria).toEqual([]);
		},
	);

	it("rejects a response-only outcome when App Server observed file changes", () => {
		const evidence = completeEvidence();
		if (!evidence.codex) throw new Error("test fixture Codex evidence missing");
		evidence.codex.outcome = "response_only";
		const responseDelivery: CodexExpectedDelivery = {
			kind: "codex_response",
			workspaceId: "web",
			requiredEvidence: ["codex_turn"],
		};

		const result = verifyCodexDelivery({
			expectedDelivery: responseDelivery,
			deliveryEvidence: evidence,
			nowIso: completedAt,
		});

		expect(result.missingCriteria).toEqual(["codex_turn"]);
	});
});

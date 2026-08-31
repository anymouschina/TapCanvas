import { describe, expect, it } from "vitest";
import type { CodexTask } from "@tapcanvas/codex-task-protocol";
import {
	CodexSessionTurnError,
	resolveCodexSessionTurn,
} from "./codex-session-turn";

type ParentTask = Pick<
	CodexTask,
	| "id"
	| "sessionId"
	| "turnSequence"
	| "state"
	| "bridgeId"
	| "workspaceId"
	| "context"
	| "deliveryEvidence"
>;

function parentFixture(overrides: Partial<ParentTask> = {}): ParentTask {
	return {
		id: "task-parent",
		sessionId: "session-existing",
		turnSequence: 2,
		state: "awaiting_user_input",
		bridgeId: "bridge-1",
		workspaceId: "workspace-1",
		context: {
			snapshotId: "snapshot-parent",
			projectId: "project-1",
			flowId: "flow-1",
			chapterId: null,
			canvasRevision: 3,
			selectedNodeIds: [],
			selectedNodeKinds: [],
			projectName: "Project One",
			flowName: "Flow One",
			nodeCount: 0,
			edgeCount: 0,
			sha256: "a".repeat(64),
			createdAt: "2026-07-31T08:00:00.000Z",
		},
		deliveryEvidence: {
			source: null,
			codex: {
				threadId: "thread-persistent",
				turnId: "turn-parent",
				status: "completed",
				outcome: "needs_input",
				changedFiles: [],
				summary: "Choose a layout",
			},
			build: null,
			preview: null,
		},
		...overrides,
	};
}

const baseInput = {
	userId: "user-1",
	bridgeId: "bridge-1",
	workspaceId: "workspace-1",
	sessionId: "session-existing",
	parentTaskId: "task-parent",
	context: {
		projectId: "project-1",
		flowId: "flow-1",
		chapterId: null,
	},
};

describe("resolveCodexSessionTurn", () => {
	it("creates a deterministic first turn without pretending to resume", async () => {
		const turn = await resolveCodexSessionTurn({
			...baseInput,
			sessionId: null,
			parentTaskId: null,
			getTask: async () => null,
			createSessionId: () => "session-new",
		});

		expect(turn).toEqual({
			sessionId: "session-new",
			parentTaskId: null,
			turnSequence: 1,
			resumeThreadId: null,
		});
	});

	it("resumes the verified thread and increments the turn sequence", async () => {
		const turn = await resolveCodexSessionTurn({
			...baseInput,
			getTask: async () => parentFixture(),
		});

		expect(turn).toEqual({
			sessionId: "session-existing",
			parentTaskId: "task-parent",
			turnSequence: 3,
			resumeThreadId: "thread-persistent",
		});
	});

	it.each([
		{
			name: "active parent",
			parent: parentFixture({ state: "codex_running" }),
			code: "codex_session_parent_active",
		},
		{
			name: "different workspace",
			parent: parentFixture({ workspaceId: "workspace-2" }),
			code: "codex_session_workspace_changed",
		},
		{
			name: "different canvas scope",
			parent: parentFixture({
				context: {
					...parentFixture().context,
					flowId: "flow-2",
				},
			}),
			code: "codex_session_canvas_scope_changed",
		},
		{
			name: "missing verified thread",
			parent: parentFixture({
				deliveryEvidence: {
					...parentFixture().deliveryEvidence,
					codex: null,
				},
			}),
			code: "codex_session_thread_unavailable",
		},
	])("rejects $name", async ({ parent, code }) => {
		try {
			await resolveCodexSessionTurn({
				...baseInput,
				getTask: async () => parent,
			});
			throw new Error("expected session resolution to fail");
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(CodexSessionTurnError);
			if (!(error instanceof CodexSessionTurnError)) throw error;
			expect(error.code).toBe(code);
			expect(error.status).toBe(409);
		}
	});
});

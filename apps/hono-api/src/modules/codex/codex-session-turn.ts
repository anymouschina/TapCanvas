import { randomUUID } from "node:crypto";
import {
	isCodexTerminalTaskState,
	type CodexTask,
} from "@tapcanvas/codex-task-protocol";

type CodexSessionParentTask = Pick<
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

export type CodexSessionTurn = {
	sessionId: string;
	parentTaskId: string | null;
	turnSequence: number;
	resumeThreadId: string | null;
};

export class CodexSessionTurnError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly status: 404 | 409,
		public readonly details: Record<string, unknown> | null = null,
	) {
		super(message);
		this.name = "CodexSessionTurnError";
	}
}

export async function resolveCodexSessionTurn(input: {
	getTask: (
		userId: string,
		taskId: string,
	) => Promise<CodexSessionParentTask | null>;
	userId: string;
	bridgeId: string;
	workspaceId: string;
	sessionId: string | null;
	parentTaskId: string | null;
	context: {
		projectId: string;
		flowId: string | null;
		chapterId: string | null;
	};
	createSessionId?: () => string;
}): Promise<CodexSessionTurn> {
	if (!input.sessionId || !input.parentTaskId) {
		return {
			sessionId: (input.createSessionId ?? randomUUID)(),
			parentTaskId: null,
			turnSequence: 1,
			resumeThreadId: null,
		};
	}

	const parent = await input.getTask(input.userId, input.parentTaskId);
	if (!parent || parent.sessionId !== input.sessionId) {
		throw new CodexSessionTurnError(
			"Codex 会话的上一回合不存在或不属于当前用户",
			"codex_session_parent_not_found",
			404,
		);
	}
	if (!isCodexTerminalTaskState(parent.state)) {
		throw new CodexSessionTurnError(
			"Codex 会话上一回合尚未结束，不能创建后续回合",
			"codex_session_parent_active",
			409,
			{ parentTaskId: parent.id, state: parent.state },
		);
	}
	if (
		parent.bridgeId !== input.bridgeId ||
		parent.workspaceId !== input.workspaceId
	) {
		throw new CodexSessionTurnError(
			"Codex 会话不能跨 Bridge 或 workspace 恢复",
			"codex_session_workspace_changed",
			409,
		);
	}
	if (
		parent.context.projectId !== input.context.projectId ||
		parent.context.flowId !== input.context.flowId ||
		parent.context.chapterId !== input.context.chapterId
	) {
		throw new CodexSessionTurnError(
			"Codex 会话不能跨项目、flow 或 chapter 恢复",
			"codex_session_canvas_scope_changed",
			409,
		);
	}
	const resumeThreadId = parent.deliveryEvidence.codex?.threadId ?? null;
	if (!resumeThreadId) {
		throw new CodexSessionTurnError(
			"上一回合没有可验证的 Codex threadId，禁止伪装为连续会话；请显式新建会话",
			"codex_session_thread_unavailable",
			409,
		);
	}
	return {
		sessionId: parent.sessionId,
		parentTaskId: parent.id,
		turnSequence: parent.turnSequence + 1,
		resumeThreadId,
	};
}

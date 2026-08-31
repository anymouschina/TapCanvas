import type {
	CodexDeliveryEvidence,
	CodexDeliveryVerification,
	CodexExpectedDelivery,
	CodexExpectedDeliveryCriterion,
} from "@tapcanvas/codex-task-protocol";

type MissingCriterion =
	CodexDeliveryVerification["missingCriteria"][number];

function requiresEvidence(
	expectedDelivery: CodexExpectedDelivery,
	criterion: CodexExpectedDeliveryCriterion,
): boolean {
	const required: readonly CodexExpectedDeliveryCriterion[] =
		expectedDelivery.requiredEvidence;
	return required.includes(criterion);
}

function hasSuccessfulCommand(
	evidence: CodexDeliveryEvidence,
	name: "test" | "build" | "preview",
): boolean {
	return Boolean(
		evidence.build?.commands.some(
			(command) => command.name === name && command.exitCode === 0,
		),
	);
}

function hasValidLivePreview(
	evidence: CodexDeliveryEvidence,
	nowIso: string,
): boolean {
	const preview = evidence.preview;
	if (
		!preview ||
		preview.isolatedOrigin !== true ||
		!preview.previewId.trim() ||
		!hasSuccessfulCommand(evidence, "preview")
	) {
		return false;
	}
	let url: URL;
	try {
		url = new URL(preview.url);
	} catch {
		return false;
	}
	const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
	if (
		url.protocol !== "https:" &&
		!(url.protocol === "http:" && loopback.has(url.hostname))
	) {
		return false;
	}
	const expiresAt = Date.parse(preview.expiresAt);
	const checkedAt = Date.parse(nowIso);
	return (
		Number.isFinite(expiresAt) &&
		Number.isFinite(checkedAt) &&
		expiresAt > checkedAt
	);
}

/**
 * 通用交付验收器：只根据真实执行证据判断，不读取 prompt 文案、不猜用户语义。
 *
 * expectedDelivery 由任务创建契约确定，deliveryEvidence 只能由宿主机 bridge 的
 * Codex App Server 事件与隔离构建结果写入。这里不把“有回复文本”当作完成证据。
 */
export function verifyCodexDelivery(input: {
	expectedDelivery: CodexExpectedDelivery;
	deliveryEvidence: CodexDeliveryEvidence;
	nowIso: string;
}): CodexDeliveryVerification {
	const missingCriteria: MissingCriterion[] = [];
	const { deliveryEvidence: evidence } = input;

	if (requiresEvidence(input.expectedDelivery, "codex_turn")) {
		const codex = evidence.codex;
		const validWorkspaceChange =
			input.expectedDelivery.kind ===
				"workspace_change_with_verified_preview" &&
			codex?.status === "completed" &&
			codex.outcome === "workspace_changed" &&
			codex.changedFiles.length > 0;
		const validResponse =
			input.expectedDelivery.kind === "codex_response" &&
			codex?.status === "completed" &&
			(codex.outcome === "needs_input" ||
				codex.outcome === "response_only") &&
			codex.changedFiles.length === 0 &&
			codex.summary.trim().length > 0;
		if (!validWorkspaceChange && !validResponse) {
			missingCriteria.push("codex_turn");
		}
	}
	if (
		requiresEvidence(input.expectedDelivery, "tests") &&
		!hasSuccessfulCommand(evidence, "test")
	) {
		missingCriteria.push("tests");
	}
	if (
		requiresEvidence(input.expectedDelivery, "build") &&
		(!evidence.build || !hasSuccessfulCommand(evidence, "build"))
	) {
		missingCriteria.push("build");
	}
	if (
		requiresEvidence(input.expectedDelivery, "preview") &&
		!hasValidLivePreview(evidence, input.nowIso)
	) {
		missingCriteria.push("preview");
	}

	return {
		status: missingCriteria.length === 0 ? "satisfied" : "failed",
		checkedAt: input.nowIso,
		missingCriteria,
		rationale:
			missingCriteria.length === 0
				? input.expectedDelivery.kind === "codex_response"
					? "Codex 回合返回了结构化、无文件副作用的真实回复证据。"
					: "Codex 回合、测试、构建与隔离预览均有可验证的真实执行证据。"
				: `缺少交付证据：${missingCriteria.join(", ")}`,
	};
}

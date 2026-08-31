import { createHash } from "node:crypto";
import {
	buildShotTableAnalysisJsonSchema,
	inspectShotTableAnalysisJson,
	normalizeShotTableAnalysisDetailed,
	SHOT_TABLE_ANALYSIS_SCHEMA_NAME,
	type ShotTableAnalysisDetailedResult,
	type ShotTableAnalysisPathSegment,
	type ShotTableAnalysisViolation,
	type ShotTableData,
	VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS,
} from "@tapcanvas/shot-table-protocol";
import { AppError } from "../../middleware/error";
import { VIDEO_ANALYSIS_EXECUTION_LIMITS } from "../billing/video-analysis-upfront-pricing";
import type { ResponsesOutputEnvelope } from "./agents-llm-protocol";

const TARGETED_REPAIR_SCHEMA_NAME = "tapcanvas_shot_table_field_repair_v1";
const TARGETED_REPAIR_LIMIT = 24;
const TARGETED_REPAIR_MAX_OUTPUT_TOKENS = 8_192;

export type VideoAnalysisRepairKind = "targeted_fields" | "full_regeneration";
export type VideoAnalysisAttemptKind = "primary" | VideoAnalysisRepairKind;

export type VideoAnalysisValidationIssue = {
	code: string;
	path: ShotTableAnalysisPathSegment[];
	message: string;
};

export type VideoAnalysisExecutionAttempt = {
	sequence: number;
	kind: VideoAnalysisAttemptKind;
	responseId: string;
	previousResponseId: string | null;
	responseModel: string;
	outputSha256: string;
	outputLength: number;
	validation: "accepted" | "rejected";
	issues: VideoAnalysisValidationIssue[];
};

export type VideoAnalysisExecutionTrace = {
	proxyTaskId: string;
	requestedModel: string;
	repaired: boolean;
	repairKind: VideoAnalysisRepairKind | null;
	attempts: VideoAnalysisExecutionAttempt[];
};

export type ShotTableAnalysisRecoveryResult = {
	table: ShotTableData;
	execution: VideoAnalysisExecutionTrace;
};

export type ShotTableRepairRequest = {
	kind: VideoAnalysisRepairKind;
	body: Record<string, unknown>;
};

type TargetedRepair = {
	id: string;
	path: ShotTableAnalysisPathSegment[];
	message: string;
};

type SendRepairRequest = (
	request: ShotTableRepairRequest,
) => Promise<ResponsesOutputEnvelope>;

const issueFromViolation = (
	entry: ShotTableAnalysisViolation,
): VideoAnalysisValidationIssue => ({
	code: entry.code,
	path: [...entry.path],
	message: entry.message,
});

const genericIssue = (
	code: string,
	message: string,
	path: readonly ShotTableAnalysisPathSegment[] = [],
): VideoAnalysisValidationIssue => ({ code, message, path: [...path] });

const outputSha256 = (text: string): string =>
	createHash("sha256").update(text).digest("hex");

const pathKey = (path: readonly ShotTableAnalysisPathSegment[]): string =>
	JSON.stringify(path);

const formatPath = (path: readonly ShotTableAnalysisPathSegment[]): string =>
	path.length === 0
		? "/"
		: `/${path.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;

const readTargetedRepairs = (
	inspection: Extract<ShotTableAnalysisDetailedResult, { ok: false }>,
): TargetedRepair[] | null => {
	if (inspection.document === null) return null;
	if (inspection.violations.length === 0 || inspection.violations.length > TARGETED_REPAIR_LIMIT) {
		return null;
	}
	const seen = new Set<string>();
	const targets: TargetedRepair[] = [];
	for (const entry of inspection.violations) {
		if (
			entry.expected !== "string"
			|| (entry.code !== "missing_field" && entry.code !== "expected_string")
			|| entry.path.length < 2
		) {
			return null;
		}
		const key = pathKey(entry.path);
		if (seen.has(key)) return null;
		seen.add(key);
		targets.push({
			id: `R${String(targets.length + 1).padStart(3, "0")}`,
			path: [...entry.path],
			message: entry.message,
		});
	}
	return targets;
};

export const buildTargetedShotTableRepairRequest = (input: {
	model: string;
	previousResponseId: string;
	targets: readonly TargetedRepair[];
}): Record<string, unknown> => {
	if (input.targets.length === 0 || input.targets.length > TARGETED_REPAIR_LIMIT) {
		throw new Error(`targeted repair requires 1-${TARGETED_REPAIR_LIMIT} exact paths`);
	}
	const repairIds = input.targets.map((target) => target.id);
	const properties = Object.fromEntries(input.targets.map((target) => [
		target.id,
		{
			type: "string",
			description: `${formatPath(target.path)}：${target.message}`,
		},
	]));
	const targetList = input.targets.map((target) => ({
		id: target.id,
		path: formatPath(target.path),
		problem: target.message,
	}));
	return {
		model: input.model,
		previous_response_id: input.previousResponseId,
		store: true,
		max_output_tokens: TARGETED_REPAIR_MAX_OUTPUT_TOKENS,
		input: [{
			type: "message",
			role: "user",
			content: [{
				type: "input_text",
				text: [
					"上一响应已经完成视频事实提取，但以下字符串字段违反了输出合同。",
					"只根据同一视频与上一响应，为每个 repair id 返回对应字符串；不得改写、补充或重复其他字段。",
					"无法从视频确认的值必须返回空字符串，禁止编造。",
					JSON.stringify(targetList),
				].join("\n"),
			}],
		}],
		text: {
			format: {
				type: "json_schema",
				name: TARGETED_REPAIR_SCHEMA_NAME,
				strict: true,
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						repairs: {
							type: "object",
							additionalProperties: false,
							properties,
							required: repairIds,
						},
					},
					required: ["repairs"],
				},
			},
		},
	};
};

export const buildFullShotTableRegenerationRequest = (input: {
	model: string;
	previousResponseId: string;
	issues: readonly VideoAnalysisValidationIssue[];
}): Record<string, unknown> => ({
	model: input.model,
	previous_response_id: input.previousResponseId,
	store: true,
	max_output_tokens: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxOutputTokens,
	input: [{
		type: "message",
		role: "user",
		content: [{
			type: "input_text",
			text: [
				"上一响应的 JSON 结构损坏，无法安全做字段级修复。",
				"请基于同一视频与同一事实提取任务，完整重发一次符合原 JSON Schema 的对象。",
				"不得增加视频中无法确认的事实；无法确认的字符串返回空字符串。只返回 JSON 对象。",
				JSON.stringify(input.issues),
			].join("\n"),
		}],
	}],
	text: {
		format: {
			type: "json_schema",
			name: SHOT_TABLE_ANALYSIS_SCHEMA_NAME,
			strict: true,
			schema: buildShotTableAnalysisJsonSchema(VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS),
		},
	},
});

const cloneJsonValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.map(([key, entry]) => [key, cloneJsonValue(entry)]),
		);
	}
	return value;
};

const setStringAtPath = (
	document: unknown,
	path: readonly ShotTableAnalysisPathSegment[],
	value: string,
): void => {
	if (path.length === 0) throw new Error("repair path cannot target the document root");
	let cursor = document;
	for (let index = 0; index < path.length - 1; index += 1) {
		const segment = path[index];
		if (typeof segment === "number") {
			if (!Array.isArray(cursor) || segment < 0 || segment >= cursor.length) {
				throw new Error(`repair path is not reachable: ${formatPath(path)}`);
			}
			cursor = cursor[segment];
			continue;
		}
		if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
			throw new Error(`repair path is not reachable: ${formatPath(path)}`);
		}
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	const leaf = path[path.length - 1];
	if (typeof leaf === "number") {
		if (!Array.isArray(cursor) || leaf < 0 || leaf >= cursor.length) {
			throw new Error(`repair leaf is not reachable: ${formatPath(path)}`);
		}
		cursor[leaf] = value;
		return;
	}
	if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
		throw new Error(`repair leaf is not reachable: ${formatPath(path)}`);
	}
	(cursor as Record<string, unknown>)[leaf] = value;
};

const parseTargetedRepairValues = (
	text: string,
	targets: readonly TargetedRepair[],
): { ok: true; values: Map<string, string> } | { ok: false; issues: VideoAnalysisValidationIssue[] } => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		return {
			ok: false,
			issues: [genericIssue(
				"repair_json_invalid",
				`字段修复响应不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
			)],
		};
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, issues: [genericIssue("repair_root_invalid", "字段修复响应不是对象。")] };
	}
	const root = parsed as Record<string, unknown>;
	const rootKeys = Object.keys(root);
	if (rootKeys.length !== 1 || rootKeys[0] !== "repairs") {
		return { ok: false, issues: [genericIssue("repair_root_fields_invalid", "字段修复响应必须且只能包含 repairs。") ] };
	}
	const repairs = root.repairs;
	if (!repairs || typeof repairs !== "object" || Array.isArray(repairs)) {
		return { ok: false, issues: [genericIssue("repair_values_invalid", "字段修复响应的 repairs 不是对象。", ["repairs"])] };
	}
	const repairRecord = repairs as Record<string, unknown>;
	const expectedIds = new Set(targets.map((target) => target.id));
	const issues: VideoAnalysisValidationIssue[] = [];
	for (const id of Object.keys(repairRecord)) {
		if (!expectedIds.has(id)) {
			issues.push(genericIssue("repair_unexpected_id", `字段修复响应包含未声明 id：${id}。`, ["repairs", id]));
		}
	}
	const values = new Map<string, string>();
	for (const target of targets) {
		if (!Object.prototype.hasOwnProperty.call(repairRecord, target.id)) {
			issues.push(genericIssue("repair_id_missing", `字段修复响应缺少 ${target.id}。`, ["repairs", target.id]));
			continue;
		}
		const value = repairRecord[target.id];
		if (typeof value !== "string") {
			issues.push(genericIssue("repair_value_not_string", `${target.id} 不是字符串。`, ["repairs", target.id]));
			continue;
		}
		values.set(target.id, value);
	}
	return issues.length > 0 ? { ok: false, issues } : { ok: true, values };
};

const validateEnvelopeProvenance = (input: {
	envelope: ResponsesOutputEnvelope;
	model: string;
	kind: VideoAnalysisAttemptKind;
	expectedPreviousResponseId: string | null;
}): void => {
	const issues: VideoAnalysisValidationIssue[] = [];
	if (!input.envelope.id) issues.push(genericIssue("response_id_missing", "Responses 响应缺少 id。"));
	if (!input.envelope.model) {
		issues.push(genericIssue("response_model_missing", "Responses 响应缺少实际模型。"));
	} else if (input.envelope.model !== input.model) {
		issues.push(genericIssue(
			"response_model_mismatch",
			`Responses 实际模型 ${input.envelope.model} 与请求模型 ${input.model} 不一致。`,
		));
	}
	if (input.envelope.status !== "completed") {
		issues.push(genericIssue(
			"response_status_invalid",
			`Responses 状态必须为 completed，实际为 ${input.envelope.status ?? "缺失"}。`,
		));
	}
	if (input.envelope.store !== true) {
		issues.push(genericIssue("response_store_unverified", "Responses 响应未证明 store=true。"));
	}
	if (input.envelope.previousResponseId !== input.expectedPreviousResponseId) {
		issues.push(genericIssue(
			"previous_response_id_mismatch",
			`Responses previous_response_id 与本次 ${input.kind} 请求不一致。`,
		));
	}
	if (issues.length === 0) return;
	throw new AppError("视频分析响应的模型或上下文继承证据无效", {
		status: 502,
		code: "video_analysis_response_provenance_invalid",
		details: {
			kind: input.kind,
			requestedModel: input.model,
			expectedPreviousResponseId: input.expectedPreviousResponseId,
			response: {
				id: input.envelope.id,
				model: input.envelope.model,
				status: input.envelope.status,
				previousResponseId: input.envelope.previousResponseId,
				store: input.envelope.store,
				outputLength: input.envelope.text.length,
				outputSha256: outputSha256(input.envelope.text),
			},
			issues,
		},
	});
};

const createAttempt = (input: {
	sequence: number;
	kind: VideoAnalysisAttemptKind;
	envelope: ResponsesOutputEnvelope;
	validation: "accepted" | "rejected";
	issues: readonly VideoAnalysisValidationIssue[];
}): VideoAnalysisExecutionAttempt => ({
	sequence: input.sequence,
	kind: input.kind,
	responseId: input.envelope.id ?? "",
	previousResponseId: input.envelope.previousResponseId,
	responseModel: input.envelope.model ?? "",
	outputSha256: outputSha256(input.envelope.text),
	outputLength: input.envelope.text.length,
	validation: input.validation,
	issues: input.issues.map((entry) => ({ ...entry, path: [...entry.path] })),
});

const buildTrace = (input: {
	proxyTaskId: string;
	model: string;
	repairKind: VideoAnalysisRepairKind | null;
	attempts: readonly VideoAnalysisExecutionAttempt[];
}): VideoAnalysisExecutionTrace => ({
	proxyTaskId: input.proxyTaskId,
	requestedModel: input.model,
	repaired: input.repairKind !== null,
	repairKind: input.repairKind,
	attempts: input.attempts.map((attempt) => ({
		...attempt,
		issues: attempt.issues.map((entry) => ({ ...entry, path: [...entry.path] })),
	})),
});

const throwRepairFailure = (input: {
	proxyTaskId: string;
	model: string;
	repairKind: VideoAnalysisRepairKind;
	attempts: readonly VideoAnalysisExecutionAttempt[];
	cause?: unknown;
}): never => {
	const causeMessage = input.cause instanceof Error
		? input.cause.message
		: input.cause === undefined
			? ""
			: String(input.cause);
	throw new AppError(
		`视频分析结构修复失败（任务 ${input.proxyTaskId}）${causeMessage ? `：${causeMessage}` : ""}`,
		{
			status: 502,
			code: "video_analysis_structured_repair_invalid",
			details: {
				execution: buildTrace({
					proxyTaskId: input.proxyTaskId,
					model: input.model,
					repairKind: input.repairKind,
					attempts: input.attempts,
				}),
				...(input.cause instanceof AppError
					? { cause: { code: input.cause.code, message: input.cause.message, details: input.cause.details } }
					: causeMessage
						? { cause: { message: causeMessage } }
						: {}),
			},
		},
	);
};

export async function recoverShotTableAnalysisOutput(input: {
	proxyTaskId: string;
	model: string;
	primary: ResponsesOutputEnvelope;
	expectedDurationSeconds: number;
	sendRepair: SendRepairRequest;
}): Promise<ShotTableAnalysisRecoveryResult> {
	if (!Number.isFinite(input.expectedDurationSeconds) || input.expectedDurationSeconds <= 0) {
		throw new Error("expectedDurationSeconds must be a positive finite number");
	}
	validateEnvelopeProvenance({
		envelope: input.primary,
		model: input.model,
		kind: "primary",
		expectedPreviousResponseId: null,
	});
	const primaryInspection = inspectShotTableAnalysisJson(
		input.primary.text,
		VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS,
		{ expectedDurationSeconds: input.expectedDurationSeconds },
	);
	if (primaryInspection.ok) {
		const attempt = createAttempt({
			sequence: 1,
			kind: "primary",
			envelope: input.primary,
			validation: "accepted",
			issues: [],
		});
		return {
			table: primaryInspection.table,
			execution: buildTrace({
				proxyTaskId: input.proxyTaskId,
				model: input.model,
				repairKind: null,
				attempts: [attempt],
			}),
		};
	}

	const primaryIssues = primaryInspection.violations.map(issueFromViolation);
	const primaryAttempt = createAttempt({
		sequence: 1,
		kind: "primary",
		envelope: input.primary,
		validation: "rejected",
		issues: primaryIssues,
	});
	const targets = readTargetedRepairs(primaryInspection);
	const repairKind: VideoAnalysisRepairKind = targets ? "targeted_fields" : "full_regeneration";
	if (primaryInspection.violations.some((entry) => entry.code === "column_contract_invalid")) {
		throwRepairFailure({
			proxyTaskId: input.proxyTaskId,
			model: input.model,
			repairKind,
			attempts: [primaryAttempt],
			cause: "本地分镜列合同无效，模型重试无法修复。",
		});
	}
	const previousResponseId = input.primary.id;
	if (!previousResponseId) {
		throwRepairFailure({
			proxyTaskId: input.proxyTaskId,
			model: input.model,
			repairKind,
			attempts: [primaryAttempt],
			cause: "主响应缺少 previous_response_id 所需的响应 id。",
		});
	}

	const body = targets
		? buildTargetedShotTableRepairRequest({
				model: input.model,
				previousResponseId,
				targets,
			})
		: buildFullShotTableRegenerationRequest({
				model: input.model,
				previousResponseId,
				issues: primaryIssues,
			});
	let repairEnvelope: ResponsesOutputEnvelope;
	try {
		repairEnvelope = await input.sendRepair({ kind: repairKind, body });
		validateEnvelopeProvenance({
			envelope: repairEnvelope,
			model: input.model,
			kind: repairKind,
			expectedPreviousResponseId: previousResponseId,
		});
	} catch (error: unknown) {
		throwRepairFailure({
			proxyTaskId: input.proxyTaskId,
			model: input.model,
			repairKind,
			attempts: [primaryAttempt],
			cause: error,
		});
	}

	if (targets) {
		const parsedRepairs = parseTargetedRepairValues(repairEnvelope.text, targets);
		if (!parsedRepairs.ok) {
			const repairAttempt = createAttempt({
				sequence: 2,
				kind: repairKind,
				envelope: repairEnvelope,
				validation: "rejected",
				issues: parsedRepairs.issues,
			});
			throwRepairFailure({
				proxyTaskId: input.proxyTaskId,
				model: input.model,
				repairKind,
				attempts: [primaryAttempt, repairAttempt],
			});
		}
		const patched = cloneJsonValue(primaryInspection.document);
		try {
			for (const target of targets) {
				const value = parsedRepairs.values.get(target.id);
				if (typeof value !== "string") throw new Error(`missing validated repair ${target.id}`);
				setStringAtPath(patched, target.path, value);
			}
		} catch (error: unknown) {
			const repairAttempt = createAttempt({
				sequence: 2,
				kind: repairKind,
				envelope: repairEnvelope,
				validation: "rejected",
				issues: [genericIssue(
					"repair_path_application_failed",
					error instanceof Error ? error.message : String(error),
				)],
			});
			throwRepairFailure({
				proxyTaskId: input.proxyTaskId,
				model: input.model,
				repairKind,
				attempts: [primaryAttempt, repairAttempt],
			});
		}
		const verified = normalizeShotTableAnalysisDetailed(
			patched,
			VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS,
			{ expectedDurationSeconds: input.expectedDurationSeconds },
		);
		if (!verified.ok) {
			const repairAttempt = createAttempt({
				sequence: 2,
				kind: repairKind,
				envelope: repairEnvelope,
				validation: "rejected",
				issues: verified.violations.map(issueFromViolation),
			});
			throwRepairFailure({
				proxyTaskId: input.proxyTaskId,
				model: input.model,
				repairKind,
				attempts: [primaryAttempt, repairAttempt],
			});
		}
		const repairAttempt = createAttempt({
			sequence: 2,
			kind: repairKind,
			envelope: repairEnvelope,
			validation: "accepted",
			issues: [],
		});
		return {
			table: verified.table,
			execution: buildTrace({
				proxyTaskId: input.proxyTaskId,
				model: input.model,
				repairKind,
				attempts: [primaryAttempt, repairAttempt],
			}),
		};
	}

	const regenerated = inspectShotTableAnalysisJson(
		repairEnvelope.text,
		VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS,
		{ expectedDurationSeconds: input.expectedDurationSeconds },
	);
	if (!regenerated.ok) {
		const repairAttempt = createAttempt({
			sequence: 2,
			kind: repairKind,
			envelope: repairEnvelope,
			validation: "rejected",
			issues: regenerated.violations.map(issueFromViolation),
		});
		throwRepairFailure({
			proxyTaskId: input.proxyTaskId,
			model: input.model,
			repairKind,
			attempts: [primaryAttempt, repairAttempt],
		});
	}
	const repairAttempt = createAttempt({
		sequence: 2,
		kind: repairKind,
		envelope: repairEnvelope,
		validation: "accepted",
		issues: [],
	});
	return {
		table: regenerated.table,
		execution: buildTrace({
			proxyTaskId: input.proxyTaskId,
			model: input.model,
			repairKind,
			attempts: [primaryAttempt, repairAttempt],
		}),
	};
}

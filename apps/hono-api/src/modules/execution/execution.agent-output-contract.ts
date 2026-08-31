import {
	WORKFLOW_AGENT_OUTPUT_ENCODINGS,
	WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME,
	WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION,
	type WorkflowAgentOutputEncoding,
} from "@tapcanvas/workflow-kernel-protocol";
import {
	validateStructuredClipExecutionContract,
	countDialogueChars,
	type StructuredClip,
} from "../task/video-orchestrator.clip-shots";
import {
	DEFAULT_DIALOGUE_CHARS_PER_SEC,
	DIALOGUE_PACE_CEILING,
	parseDialoguePaceRate,
} from "../task/video-orchestrator.dialogue-capacity";
import {
	inspectWorkflowBeatObjectContinuity,
	parseWorkflowClipAssetObjectContracts,
	validateWorkflowBeatObjectContinuity,
} from "./execution.video-workflow-continuity";
import {
	collectSpokenSpeakerNames,
	combineSpokenScript,
	parseNarrativeAudioPlan,
	validateNarrativeAudioPlacement,
	type SpokenScriptLine,
} from "../task/video-orchestrator.spoken-script";

export type { WorkflowAgentOutputEncoding } from "@tapcanvas/workflow-kernel-protocol";

export type WorkflowAgentOutputContractResult =
	| Readonly<{
		ok: true;
		text: string;
		diagnostics?: readonly WorkflowAgentOutputDiagnostic[];
	}>
	| Readonly<{ ok: false; errorMessage: string }>;

export type WorkflowAgentOutputDiagnostic = Readonly<{
	code: "model_authored_consistency";
	message: string;
}>;

export type WorkflowAgentJsonArrayContract = Readonly<{
	minimumArrayLength?: number;
	expectedArrayLength?: number;
	itemRequiredStringFields?: readonly string[];
	itemStringFormats?: Readonly<Record<string, WorkflowAgentStringFormat>>;
	itemRequiredNumberFields?: readonly string[];
	itemRequiredNonEmptyArrayFields?: readonly string[];
	itemExactNumberFields?: Readonly<Record<string, number>>;
	itemStringAllowedValues?: Readonly<Record<string, readonly string[]>>;
	itemStringArrayAllowedValues?: Readonly<Record<string, readonly string[]>>;
	itemRequiredNonEmptyArrayFieldsByIdentity?: Readonly<{
		identityField: string;
		values: Readonly<Record<string, readonly string[]>>;
	}>;
	itemExactStringFieldsByIdentity?: Readonly<{
		identityField: string;
		values: Readonly<Record<string, Readonly<Record<string, string>>>>;
	}>;
	itemAllowedFields?: readonly string[];
}>;

export const WORKFLOW_AGENT_STRING_FORMATS = ["asset-role-v1"] as const;
export type WorkflowAgentStringFormat = typeof WORKFLOW_AGENT_STRING_FORMATS[number];

const WORKFLOW_ASSET_ROLE_KINDS = [
	"character",
	"scene",
	"prop",
	"vfx",
	"palette",
	"composition",
] as const;

const WORKFLOW_ASSET_REFERENCE_ROLES = [
	"none",
	"identity",
	"wardrobe",
	"prop",
	"environment",
	"palette",
	"composition",
	"vfx",
] as const;

type WorkflowAssetRoleKind = typeof WORKFLOW_ASSET_ROLE_KINDS[number];

export const WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY = "single_submission_record_and_fail" as const;
export const WORKFLOW_STRUCTURED_OUTPUT_SINGLE_INFERENCE_POLICY =
	"single_inference_no_tools_record_and_fail" as const;

function equalDurationAtContractPrecision(left: number, right: number): boolean {
	return Number(left.toFixed(6)) === Number(right.toFixed(6));
}


export type WorkflowAgentJsonObjectContract = Readonly<{
	contractName?: string;
	contractVersion?: string;
	requiredStringFields?: readonly string[];
	// 顶层调用方冻结字符串事实。用于来源身份、artifact 身份等不可由
	// Agent 改写的运行时事实；值必须同时属于 requiredStringFields 与
	// allowedFields，agents-cli 与 Hono 端口校验执行同一精确比较。
	exactStringFields?: Readonly<Record<string, string>>;
	requiredNumberFields?: readonly string[];
	requiredObjectFields?: readonly string[];
	requiredArrayFields?: readonly string[];
	// 数组字段的精确长度约束（如视频工作流冻结时长计划对应的 beats 数）。
	// 命中即强制；模型必须在唯一一次提交中满足，runtime 只记录并验收。
	expectedArrayLengths?: Readonly<Record<string, number>>;
	// 顶层数组每项必须包含的非空字符串字段；只做结构校验，不解释语义。
	arrayItemRequiredStringFields?: Readonly<Record<string, readonly string[]>>;
	// 顶层数组每项必须包含的字符串数组字段；允许空数组，但禁止省略、
	// 非数组值和空白字符串元素。
	arrayItemRequiredStringArrayFields?: Readonly<Record<string, readonly string[]>>;
	// 顶层数组每项必须包含的非空字符串数组字段；只做结构校验，不推断数组内容。
	arrayItemRequiredNonEmptyStringArrayFields?: Readonly<Record<string, readonly string[]>>;
	// 顶层数组每项的严格字段集合。它是通用 transport 投影，不解释字段正文；
	// 用于把章级规划限制为下游真实消费的执行事实，避免模型重复输出无消费者的
	// 分析段落并把一个纯文本节点膨胀成数万 token。
	arrayItemAllowedFields?: Readonly<Record<string, readonly string[]>>;
	// 仅当存在唯一 requiredArrayField（顶层单数组对象形态）时生效：
	// 数组每个元素必须包含的非空数组路径（如 clip 的 assetObjectContracts）。
	// 在 agent 输出合同层强制，避免模型省略资产引用后在 prompt-package 等
	// 确定性校验处整 run 失败。
	itemRequiredNonEmptyArrayFields?: readonly string[];
	// 顶层数组逐项冻结数字事实；数组下标即调用方冻结的物理顺序。
	// 例如 beats[0].durationSeconds=30、beats[1].durationSeconds=10。
	arrayItemExactNumberFields?: Readonly<
		Record<string, readonly Readonly<Record<string, number>>[]>
	>;
	// 顶层数组每一项的数字字段必须属于调用方提供的有限集合。用于把
	// 供应商实时枚举（例如允许的单 Clip 时长）带入 Agent 首次提交合同；
	// 只校验确定性数字事实，不解释内容语义或替 Agent 选择具体值。
	arrayItemNumberAllowedValues?: Readonly<
		Record<string, Readonly<Record<string, readonly number[]>>>
	>;
	// 顶层数组逐项冻结字符串事实，例如 clips[0].exitState。
	arrayItemExactStringFields?: Readonly<
		Record<string, readonly Readonly<Record<string, string>>[]>
	>;
	// 顶层数组逐项冻结有序字符串数组事实，例如 clips[0].characterRoleNames。
	arrayItemExactStringArrayFields?: Readonly<
		Record<string, readonly Readonly<Record<string, readonly string[]>>[]>
	>;
	// 交付项必须声明且仅声明冻结资产身份：declarationPaths 收集每项声明的
	// assetId。配置形态用 expectedAssetPlansFromPort 指明从哪个输入端口读取
	// assetPlans；运行时由节点执行器解析后注入 expected（精确身份集合）。
	// 只做确定性事实校验。
	itemExactAssetIds?: Readonly<
		| {
			declarationPaths: readonly string[];
			expectedAssetPlansFromPort: string;
		}
		| {
			declarationPaths: readonly string[];
			expected: readonly string[];
		}
	>;
	allowedFields: readonly string[];
}>;

export const VIDEO_WRITER_ARTIFACT_CONTRACT_NAME = "tapcanvas.video-writer-artifact";
export const VIDEO_WRITER_ARTIFACT_CONTRACT_VERSION = "14";
export const BEAT_SHEET_ARTIFACT_CONTRACT_NAME = WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME;
export const BEAT_SHEET_ARTIFACT_CONTRACT_VERSION = WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION;

const BEAT_SHEET_TOP_LEVEL_FIELDS = [
	"protocolVersion",
	"sourceId",
	"sourceFingerprint",
	"sourceCoveragePlan",
	"sourceFidelityAudit",
	"chapterArc",
	"objectRegistry",
	"assetPlans",
	"beats",
] as const;

const BEAT_SHEET_OBJECT_REGISTRY_FIELDS = [
	"objectId",
	"kind",
	"name",
	"physicalIdentityKey",
	"referenceImageNodeIds",
	"referenceAssetIds",
	"referenceRole",
	"forbiddenTransfer",
	"identityInvariant",
	"scale",
] as const;

const BEAT_SHEET_OBJECT_STATE_FIELDS = [
	"objectId",
	"startState",
	"spatialRelation",
	"driver",
	"stateChange",
	"endState",
] as const;

const BEAT_SHEET_EXECUTION_BEAT_FIELDS = [
	"clipId",
	"clipIndex",
	"durationSeconds",
	"sourceSpan",
	"narrativeIntent",
	"visualIntent",
	"dominantFunction",
	"causalEntry",
	"irreversibleResult",
	"handoffToNext",
	"startKeyframe",
	"endKeyframe",
	"exitState",
	"characters",
	"speakers",
	"dialogueScript",
	"narrativeAudioPlan",
	"dialoguePaceRate",
	"storyEvents",
	"objectStates",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function corruptTextPath(value: unknown, path = "$", visited = new Set<object>()): string | null {
	if (typeof value === "string") {
		for (let index = 0; index < value.length; index += 1) {
			const code = value.charCodeAt(index);
			if (code === 0xfffd || code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
				return path;
			}
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;
	if (visited.has(value)) return null;
	visited.add(value);
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			const nested = corruptTextPath(value[index], `${path}[${index}]`, visited);
			if (nested) return nested;
		}
		return null;
	}
	for (const [field, nestedValue] of Object.entries(value)) {
		const nested = corruptTextPath(nestedValue, `${path}.${field}`, visited);
		if (nested) return nested;
	}
	return null;
}

export function parseWorkflowAgentOutputEncoding(value: unknown): WorkflowAgentOutputEncoding | null {
	return WORKFLOW_AGENT_OUTPUT_ENCODINGS.find((encoding) => encoding === value) ?? null;
}

function parseFieldList(value: unknown): readonly string[] | null | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length === 0 || value.length > 64) return null;
	const fields = value.map((field) => typeof field === "string" ? field.trim() : "");
	if (fields.some((field) => !field)) return null;
	return [...new Set(fields)];
}

function parseItemStringFormats(
	value: unknown,
): Readonly<Record<string, WorkflowAgentStringFormat>> | null | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return null;
	const entries = Object.entries(value);
	if (entries.length === 0 || entries.length > 64) return null;
	const normalized: Array<[string, WorkflowAgentStringFormat]> = [];
	for (const [rawField, rawFormat] of entries) {
		const field = rawField.trim();
		const format = WORKFLOW_AGENT_STRING_FORMATS.find((candidate) => candidate === rawFormat);
		if (!field || !format) return null;
		normalized.push([field, format]);
	}
	return Object.fromEntries(normalized);
}

function parseItemStringArrayAllowedValues(
	value: unknown,
): Readonly<Record<string, readonly string[]>> | null | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return null;
	const entries = Object.entries(value);
	if (entries.length === 0 || entries.length > 64) return null;
	const normalized: Array<[string, readonly string[]]> = [];
	for (const [rawField, rawValues] of entries) {
		const field = rawField.trim();
		if (!field || !Array.isArray(rawValues) || rawValues.length === 0 || rawValues.length > 256) return null;
		const values = [...new Set(rawValues.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
		if (values.length === 0) return null;
		normalized.push([field, values]);
	}
	return Object.fromEntries(normalized);
}

function parseItemStringAllowedValues(
	value: unknown,
): Readonly<Record<string, readonly string[]>> | null | undefined {
	return parseItemStringArrayAllowedValues(value);
}

function parseItemExactStringFieldsByIdentity(
	value: unknown,
): WorkflowAgentJsonArrayContract["itemExactStringFieldsByIdentity"] | null | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return null;
	const identityField = typeof value.identityField === "string" ? value.identityField.trim() : "";
	if (!identityField || !isRecord(value.values)) return null;
	const identityEntries = Object.entries(value.values);
	if (identityEntries.length === 0 || identityEntries.length > 256) return null;
	const normalizedValues: Record<string, Record<string, string>> = {};
	for (const [rawIdentity, rawFields] of identityEntries) {
		const identity = rawIdentity.trim();
		if (!identity || !isRecord(rawFields)) return null;
		const fieldEntries = Object.entries(rawFields);
		if (fieldEntries.length === 0 || fieldEntries.length > 16) return null;
		const normalizedFields: Record<string, string> = {};
		for (const [rawField, rawValue] of fieldEntries) {
			const field = rawField.trim();
			const exactValue = typeof rawValue === "string" ? rawValue.trim() : "";
			if (!field || !exactValue) return null;
			normalizedFields[field] = exactValue;
		}
		normalizedValues[identity] = normalizedFields;
	}
	return { identityField, values: normalizedValues };
}

function parseItemRequiredNonEmptyArrayFieldsByIdentity(
	value: unknown,
): WorkflowAgentJsonArrayContract["itemRequiredNonEmptyArrayFieldsByIdentity"] | null | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return null;
	const identityField = typeof value.identityField === "string" ? value.identityField.trim() : "";
	if (!identityField || !isRecord(value.values)) return null;
	const identityEntries = Object.entries(value.values);
	if (identityEntries.length === 0 || identityEntries.length > 256) return null;
	const normalizedValues: Record<string, readonly string[]> = {};
	for (const [rawIdentity, rawFields] of identityEntries) {
		const identity = rawIdentity.trim();
		const fields = parseFieldList(rawFields);
		if (!identity || !fields) return null;
		normalizedValues[identity] = fields;
	}
	return { identityField, values: normalizedValues };
}

function inspectStringFormat(value: string, format: WorkflowAgentStringFormat): string | null {
	if (format === "asset-role-v1") {
		const separatorIndex = value.indexOf("://");
		if (separatorIndex <= 0 || separatorIndex + 3 >= value.length) {
			return "must use kind://canonical-name";
		}
		const kind = value.slice(0, separatorIndex);
		const canonicalName = value.slice(separatorIndex + 3).trim();
		if (!(WORKFLOW_ASSET_ROLE_KINDS as readonly string[]).includes(kind) || !canonicalName) {
			return `must use one of ${WORKFLOW_ASSET_ROLE_KINDS.join("/")} before :// and a non-empty canonical name`;
		}
	}
	return null;
}

/**
 * Typed workflow artifacts own their deterministic wire grammar. Applying those
 * facts here keeps immutable/stale authoring snapshots from weakening the runtime
 * contract and lets the Agent see the complete executable grammar before its
 * single submission.
 */
export function applyWorkflowArtifactJsonArrayContract(
	artifactType: string,
	contract: WorkflowAgentJsonArrayContract | null,
): WorkflowAgentJsonArrayContract | null {
	if (!contract || artifactType !== "tapcanvas.asset-plans/v1") return contract;
	return {
		...contract,
		itemStringFormats: {
			...contract.itemStringFormats,
			role: "asset-role-v1",
		},
	};
}

/**
 * Compose caller-frozen identity facts into an already parsed array contract.
 * When the authoring contract uses an allow-list, every deterministic field
 * introduced by the runtime must become part of that same allow-list. Keeping
 * this composition in one place prevents a valid runtime fact from making the
 * downstream Agent contract internally contradictory.
 */
export function applyWorkflowAgentExactStringFieldsByIdentity(
	contract: WorkflowAgentJsonArrayContract,
	exactFieldsByIdentity: NonNullable<WorkflowAgentJsonArrayContract["itemExactStringFieldsByIdentity"]>,
): WorkflowAgentJsonArrayContract {
	const exactFieldNames = Object.values(exactFieldsByIdentity.values)
		.flatMap((fields) => Object.keys(fields));
	return {
		...contract,
		itemExactStringFieldsByIdentity: exactFieldsByIdentity,
		...(contract.itemAllowedFields
			? {
				itemAllowedFields: [...new Set([
					...contract.itemAllowedFields,
					exactFieldsByIdentity.identityField,
					...exactFieldNames,
				])],
			}
			: {}),
	};
}

export function applyWorkflowAgentArrayItemExactNumberFields(
	contract: WorkflowAgentJsonObjectContract,
	arrayField: string,
	itemContracts: readonly Readonly<Record<string, number>>[],
): WorkflowAgentJsonObjectContract {
	const field = arrayField.trim();
	if (!field || itemContracts.length === 0 || !contract.requiredArrayFields?.includes(field)) {
		throw new Error(`Workflow Agent exact array-number contract requires declared non-empty array field ${field || "<empty>"}`);
	}
	const configuredLength = contract.expectedArrayLengths?.[field];
	if (configuredLength !== undefined && configuredLength !== itemContracts.length) {
		throw new Error(`Workflow Agent exact array-number contract conflicts with expected length for ${field}`);
	}
	const configuredItems = contract.arrayItemExactNumberFields?.[field];
	if (configuredItems && JSON.stringify(configuredItems) !== JSON.stringify(itemContracts)) {
		throw new Error(`Workflow Agent exact array-number contract conflicts with frozen values for ${field}`);
	}
	return {
		...contract,
		expectedArrayLengths: {
			...contract.expectedArrayLengths,
			[field]: itemContracts.length,
		},
		arrayItemExactNumberFields: {
			...contract.arrayItemExactNumberFields,
			[field]: itemContracts.map((item) => ({ ...item })),
		},
	};
}

export function applyWorkflowAgentArrayItemExactStringFields(
	contract: WorkflowAgentJsonObjectContract,
	arrayField: string,
	itemContracts: readonly Readonly<Record<string, string>>[],
): WorkflowAgentJsonObjectContract {
	const field = arrayField.trim();
	if (!field || itemContracts.length === 0 || !contract.requiredArrayFields?.includes(field)) {
		throw new Error(`Workflow Agent exact array-string contract requires declared non-empty array field ${field || "<empty>"}`);
	}
	const configuredLength = contract.expectedArrayLengths?.[field];
	if (configuredLength !== undefined && configuredLength !== itemContracts.length) {
		throw new Error(`Workflow Agent exact array-string contract conflicts with expected length for ${field}`);
	}
	return {
		...contract,
		expectedArrayLengths: { ...contract.expectedArrayLengths, [field]: itemContracts.length },
		arrayItemExactStringFields: {
			...contract.arrayItemExactStringFields,
			[field]: itemContracts.map((item) => ({ ...item })),
		},
	};
}

export function applyWorkflowAgentArrayItemExactStringArrayFields(
	contract: WorkflowAgentJsonObjectContract,
	arrayField: string,
	itemContracts: readonly Readonly<Record<string, readonly string[]>>[],
): WorkflowAgentJsonObjectContract {
	const field = arrayField.trim();
	if (!field || itemContracts.length === 0 || !contract.requiredArrayFields?.includes(field)) {
		throw new Error(`Workflow Agent exact array-string-array contract requires declared non-empty array field ${field || "<empty>"}`);
	}
	const configuredLength = contract.expectedArrayLengths?.[field];
	if (configuredLength !== undefined && configuredLength !== itemContracts.length) {
		throw new Error(`Workflow Agent exact array-string-array contract conflicts with expected length for ${field}`);
	}
	return {
		...contract,
		expectedArrayLengths: { ...contract.expectedArrayLengths, [field]: itemContracts.length },
		arrayItemExactStringArrayFields: {
			...contract.arrayItemExactStringArrayFields,
			[field]: itemContracts.map((item) => Object.fromEntries(
				Object.entries(item).map(([key, values]) => [key, [...values]]),
			)),
		},
	};
}

export function applyWorkflowArtifactJsonObjectContract(
	artifactType: string,
	contract: WorkflowAgentJsonObjectContract | null,
): WorkflowAgentJsonObjectContract | null {
	if (!contract) return contract;
	if (artifactType === "tapcanvas.beat-sheet/v2" || artifactType === "tapcanvas.launch-beat-sheet/v1") {
		const baseContract = { ...contract };
		delete baseContract.itemRequiredNonEmptyArrayFields;
		delete baseContract.arrayItemRequiredStringArrayFields;
		delete baseContract.arrayItemRequiredNonEmptyStringArrayFields;
		const isLaunchBeatSheet = artifactType === "tapcanvas.launch-beat-sheet/v1";
		const requiresAssetPlans = contract.requiredArrayFields?.includes("assetPlans") === true;
		return {
			...baseContract,
			requiredStringFields: ["protocolVersion"],
			requiredNumberFields: undefined,
			requiredObjectFields: ["sourceCoveragePlan", "chapterArc"],
			requiredArrayFields: ["objectRegistry", ...(requiresAssetPlans ? ["assetPlans"] : []), "beats"],
			arrayItemRequiredStringFields: {
				objectRegistry: ["objectId", "kind", "name", "identityInvariant"],
				...(requiresAssetPlans ? { assetPlans: ["role", "prompt", "negativePrompt"] } : {}),
				beats: ["startKeyframe", "endKeyframe", "dominantFunction", "causalEntry", "irreversibleResult", "handoffToNext"],
			},
			arrayItemRequiredStringArrayFields: undefined,
			arrayItemRequiredNonEmptyStringArrayFields: requiresAssetPlans
				? { assetPlans: ["identityAnchors", "prohibitedDrift"] }
				: undefined,
			contractName: BEAT_SHEET_ARTIFACT_CONTRACT_NAME,
			contractVersion: BEAT_SHEET_ARTIFACT_CONTRACT_VERSION,
			// Runtime admission adds exact source lineage values from the frozen
			// input. Replay revalidation does not reconstruct input bindings, but it
			// must still recognize those already-admitted lineage fields as part of
			// the same artifact contract instead of invalidating a successful run.
			// BeatSheet 是执行合同，不是分析报告。只保留下游真正消费的顶层与
			// per-beat 事实；五块戏剧分析仍由 Agent 在同链完成，但不重复序列化。
			allowedFields: [...BEAT_SHEET_TOP_LEVEL_FIELDS],
			arrayItemAllowedFields: {
				...contract.arrayItemAllowedFields,
				objectRegistry: [...BEAT_SHEET_OBJECT_REGISTRY_FIELDS],
				...(requiresAssetPlans ? {
					assetPlans: ["role", "prompt", "negativePrompt", "identityAnchors", "prohibitedDrift"],
				} : {}),
				beats: [...BEAT_SHEET_EXECUTION_BEAT_FIELDS],
			},
			...(isLaunchBeatSheet
				? {
					expectedArrayLengths: {
						...contract.expectedArrayLengths,
						beats: 1,
					},
					...(contract.exactStringFields ? { exactStringFields: contract.exactStringFields } : {}),
				}
				: {
					exactStringFields: {
						...contract.exactStringFields,
						protocolVersion: "tapcanvas.beat-sheet/v2",
					},
				}),
		};
	}
	if (artifactType !== "tapcanvas.clip-prompts/v2") return contract;
	return {
		...contract,
		contractName: VIDEO_WRITER_ARTIFACT_CONTRACT_NAME,
		contractVersion: VIDEO_WRITER_ARTIFACT_CONTRACT_VERSION,
		requiredStringFields: (contract.requiredStringFields ?? []).filter(
			(field) => field !== "selfQaNote",
		),
		requiredObjectFields: (contract.requiredObjectFields ?? []).filter(
			(field) => field !== "creativeReview" && field !== "sourceFidelityAudit",
		),
		itemRequiredNonEmptyArrayFields: ["shots"],
		...(contract.itemExactAssetIds
			? { itemExactAssetIds: { ...contract.itemExactAssetIds, declarationPaths: ["assetObjectContracts"] } }
			: {}),
	};
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

type BeatSheetCompactProjectionResult =
	| Readonly<{ ok: true; value: Record<string, unknown> }>
	| Readonly<{ ok: false; errorMessage: string }>;

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value)
		&& value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

/**
 * Expand the Agent-authored chapter object registry into the existing typed
 * per-beat object contract consumed by downstream nodes. Stable identity and
 * invariant facts are authored once at chapter scope; each beat carries only
 * its state delta. The projection is structural and never infers an object,
 * role, identity or story fact.
 */
function projectBeatSheetCompactObjectRegistry(
	root: Record<string, unknown>,
): BeatSheetCompactProjectionResult {
	if (!Array.isArray(root.objectRegistry) || root.objectRegistry.length === 0) {
		return { ok: false, errorMessage: "objectRegistry must be a non-empty array" };
	}
	const allowedRegistryFields = new Set<string>(BEAT_SHEET_OBJECT_REGISTRY_FIELDS);
	const registryById = new Map<string, Record<string, unknown>>();
	for (let index = 0; index < root.objectRegistry.length; index += 1) {
		const rawObject = root.objectRegistry[index];
		const path = `objectRegistry[${index}]`;
		if (!isRecord(rawObject)) return { ok: false, errorMessage: `${path} must be an object` };
		const unexpectedField = Object.keys(rawObject).find((field) => !allowedRegistryFields.has(field));
		if (unexpectedField) {
			return { ok: false, errorMessage: `${path} contains unexpected field ${unexpectedField}` };
		}
		const objectId = nonEmptyString(rawObject.objectId);
		const kind = nonEmptyString(rawObject.kind);
		const name = nonEmptyString(rawObject.name);
		const referenceRole = nonEmptyString(rawObject.referenceRole);
		const identityInvariant = nonEmptyString(rawObject.identityInvariant);
		if (!objectId) return { ok: false, errorMessage: `${path}.objectId must be non-empty` };
		if (registryById.has(objectId)) return { ok: false, errorMessage: `${path}.objectId must be unique` };
		if (!kind || !WORKFLOW_ASSET_ROLE_KINDS.includes(kind as WorkflowAssetRoleKind)) {
			return { ok: false, errorMessage: `${path}.kind must use character/scene/prop/vfx/palette/composition` };
		}
		if (!name) return { ok: false, errorMessage: `${path}.name must be non-empty` };
		if (kind === "character") {
			if (!nonEmptyString(rawObject.physicalIdentityKey)) {
				return { ok: false, errorMessage: `${path}.physicalIdentityKey must be non-empty for character objects` };
			}
		} else if (rawObject.physicalIdentityKey !== null) {
			return { ok: false, errorMessage: `${path}.physicalIdentityKey must be null for non-character objects` };
		}
		if (!isStringArray(rawObject.referenceImageNodeIds)) {
			return { ok: false, errorMessage: `${path}.referenceImageNodeIds must be a string array` };
		}
		if (rawObject.referenceAssetIds !== undefined && !isStringArray(rawObject.referenceAssetIds)) {
			return { ok: false, errorMessage: `${path}.referenceAssetIds must be a string array when present` };
		}
		if (!referenceRole || !WORKFLOW_ASSET_REFERENCE_ROLES.includes(
			referenceRole as typeof WORKFLOW_ASSET_REFERENCE_ROLES[number],
		)) {
			return { ok: false, errorMessage: `${path}.referenceRole must use none/identity/wardrobe/prop/environment/palette/composition/vfx` };
		}
		if (!identityInvariant) return { ok: false, errorMessage: `${path}.identityInvariant must be non-empty` };
		for (const field of ["forbiddenTransfer", "scale"] as const) {
			if (rawObject[field] !== undefined && !nonEmptyString(rawObject[field])) {
				return { ok: false, errorMessage: `${path}.${field} must be non-empty when present` };
			}
		}
		const { objectId: _objectId, ...objectContractBase } = rawObject;
		registryById.set(objectId, objectContractBase);
	}
	if (!Array.isArray(root.beats) || root.beats.length === 0) {
		return { ok: false, errorMessage: "beats must be a non-empty array" };
	}
	const allowedStateFields = new Set<string>(BEAT_SHEET_OBJECT_STATE_FIELDS);
	const allowedBeatFields = new Set<string>(BEAT_SHEET_EXECUTION_BEAT_FIELDS);
	const beats: unknown[] = [];
	for (let beatIndex = 0; beatIndex < root.beats.length; beatIndex += 1) {
		const rawBeat = root.beats[beatIndex];
		if (!isRecord(rawBeat)) {
			return { ok: false, errorMessage: `beats[${beatIndex}] must be an object` };
		}
		const unexpectedBeatField = Object.keys(rawBeat).find((field) => !allowedBeatFields.has(field));
		if (unexpectedBeatField) {
			return { ok: false, errorMessage: `beats[${beatIndex}] contains unexpected field ${unexpectedBeatField}` };
		}
		if (!Array.isArray(rawBeat.objectStates) || rawBeat.objectStates.length === 0) {
			return { ok: false, errorMessage: `beats[${beatIndex}].objectStates must be a non-empty array` };
		}
		const declaredObjectIds = new Set<string>();
		const assetObjectContracts: Record<string, unknown>[] = [];
		for (let stateIndex = 0; stateIndex < rawBeat.objectStates.length; stateIndex += 1) {
			const rawState = rawBeat.objectStates[stateIndex];
			const path = `beats[${beatIndex}].objectStates[${stateIndex}]`;
			if (!isRecord(rawState)) return { ok: false, errorMessage: `${path} must be an object` };
			const unexpectedField = Object.keys(rawState).find((field) => !allowedStateFields.has(field));
			if (unexpectedField) {
				return { ok: false, errorMessage: `${path} contains unexpected field ${unexpectedField}` };
			}
			const objectId = nonEmptyString(rawState.objectId);
			if (!objectId) return { ok: false, errorMessage: `${path}.objectId must be non-empty` };
			if (declaredObjectIds.has(objectId)) {
				return { ok: false, errorMessage: `${path}.objectId must be unique within the beat` };
			}
			const objectContractBase = registryById.get(objectId);
			if (!objectContractBase) return { ok: false, errorMessage: `${path}.objectId references unknown registry object ${objectId}` };
			for (const field of BEAT_SHEET_OBJECT_STATE_FIELDS.slice(1)) {
				if (!nonEmptyString(rawState[field])) {
					return { ok: false, errorMessage: `${path}.${field} must be non-empty` };
				}
			}
			declaredObjectIds.add(objectId);
			const { objectId: _stateObjectId, ...stateFields } = rawState;
			assetObjectContracts.push({ ...objectContractBase, ...stateFields });
		}
		beats.push({ ...rawBeat, assetObjectContracts });
	}
	return { ok: true, value: { ...root, beats } };
}

function stripBeatSheetCompactObjectFields(root: Record<string, unknown>): Record<string, unknown> {
	const projectedRoot = { ...root };
	delete projectedRoot.objectRegistry;
	if (!Array.isArray(projectedRoot.beats)) return projectedRoot;
	projectedRoot.beats = projectedRoot.beats.map((rawBeat) => {
		if (!isRecord(rawBeat)) return rawBeat;
		const projectedBeat = { ...rawBeat };
		delete projectedBeat.objectStates;
		return projectedBeat;
	});
	return projectedRoot;
}

/**
 * v19 carries each semantic fact once. The Agent authors ordered storyEvents,
 * the compact object registry and per-beat objectStates; this projection builds
 * only byte-for-byte derivable transport indexes before strict validation.
 */
function projectBeatSheetV19CompilerOwnedInputFields(
	root: Record<string, unknown>,
): Record<string, unknown> {
	let projectedRoot = root;
	let changed = false;
	// Identity linkage is Agent-authored in v19 and required by the provider
	// submit schema. Do not turn missing or invalid execution facts into host
	// defaults: strict validation must expose the malformed artifact.
	if (!Array.isArray(projectedRoot.beats)) return projectedRoot;

	const characterNameByObjectId = new Map<string, string>();
	if (Array.isArray(projectedRoot.objectRegistry)) {
		for (const rawObject of projectedRoot.objectRegistry) {
			if (!isRecord(rawObject) || rawObject.kind !== "character") continue;
			const objectId = nonEmptyString(rawObject.objectId);
			const name = nonEmptyString(rawObject.name);
			if (objectId && name) characterNameByObjectId.set(objectId, name);
		}
	}
	const beats = projectedRoot.beats.map((rawBeat) => {
		if (!isRecord(rawBeat)) return rawBeat;
		const characters = Array.isArray(rawBeat.objectStates)
			? [...new Set(rawBeat.objectStates.flatMap((rawState) => {
				if (!isRecord(rawState)) return [];
				const objectId = nonEmptyString(rawState.objectId);
				const name = objectId ? characterNameByObjectId.get(objectId) : undefined;
				return name ? [name] : [];
			}))]
			: [];
		if (JSON.stringify(rawBeat.characters) === JSON.stringify(characters)) return rawBeat;
		changed = true;
		return { ...rawBeat, characters };
	});
	if (changed) projectedRoot = { ...projectedRoot, beats };
	return projectedRoot;
}

function projectBeatSheetCompilerOwnedFields(
	root: Record<string, unknown>,
	exactStringFields: Readonly<Record<string, string>> = {},
): Record<string, unknown> {
	let projectedRoot = root;
	let rootChanged = false;
	for (const [field, expected] of Object.entries(exactStringFields)) {
		if (projectedRoot[field] === expected) continue;
		projectedRoot = { ...projectedRoot, [field]: expected };
		rootChanged = true;
	}
	if (!Array.isArray(projectedRoot.beats)) return projectedRoot;
	const rootBeats = projectedRoot.beats;

	const sourceCoveragePlan = isRecord(projectedRoot.sourceCoveragePlan) ? projectedRoot.sourceCoveragePlan : null;
	const speechLedger = sourceCoveragePlan && Array.isArray(sourceCoveragePlan.speechLedger)
		? sourceCoveragePlan.speechLedger
		: null;
	if (!speechLedger) return projectedRoot;
	const dialogueByClipIndex = Array.from(
		{ length: rootBeats.length },
		(): SpokenScriptLine[] => [],
	);
	const seenLineIds = new Set<string>();
	const finalClipIndex = rootBeats.length - 1;
	if (finalClipIndex < 0) return projectedRoot;
	for (const rawLine of speechLedger) {
		if (!isRecord(rawLine)) return root;
		const lineId = nonEmptyString(rawLine.lineId);
		const speakerName = nonEmptyString(rawLine.speakerName);
		const text = nonEmptyString(rawLine.text);
		const clipIndex = rawLine.clipIndex;
		const delivery = rawLine.delivery;
		if (!lineId || !speakerName || !text
			|| seenLineIds.has(lineId)
			|| !Number.isInteger(clipIndex)
			|| Number(clipIndex) < 0
			|| Number(clipIndex) > finalClipIndex
			|| (delivery !== "on_screen" && delivery !== "off_screen" && delivery !== "voice_over")) {
			return root;
		}
		seenLineIds.add(lineId);
		dialogueByClipIndex[Number(clipIndex)]!.push({ lineId, speakerName, text, delivery });
	}
	let changed = rootChanged;
	const clipIdentityScope = nonEmptyString(projectedRoot.sourceFingerprint)
		?? nonEmptyString(projectedRoot.sourceId)
		?? "tapcanvas.beat-sheet/v2";
	const beats = rootBeats.map((candidate, clipIndex) => {
		if (!isRecord(candidate)) return candidate;
		const projectedDialogue = dialogueByClipIndex[clipIndex]!;
		let projectedCandidate: Record<string, unknown> = candidate;
		const clipId = `${clipIdentityScope}:clip:${String(clipIndex)}`;
		if (candidate.clipId !== clipId) {
			projectedCandidate = { ...projectedCandidate, clipId };
			changed = true;
		}
		if (JSON.stringify(candidate.dialogueScript) !== JSON.stringify(projectedDialogue)) {
			projectedCandidate = { ...projectedCandidate, dialogueScript: projectedDialogue };
			changed = true;
		}
		if (candidate.clipIndex !== clipIndex) {
			projectedCandidate = { ...projectedCandidate, clipIndex };
			changed = true;
		}
		const dialogueScript: SpokenScriptLine[] = [];
		for (const rawLine of projectedDialogue) {
			if (!isRecord(rawLine)) return projectedCandidate;
			const lineId = nonEmptyString(rawLine.lineId);
			const speakerName = nonEmptyString(rawLine.speakerName);
			const text = nonEmptyString(rawLine.text);
			const delivery = rawLine.delivery;
			if (!lineId || !speakerName || !text
				|| (delivery !== "on_screen" && delivery !== "off_screen" && delivery !== "voice_over")) {
				return projectedCandidate;
			}
			dialogueScript.push({ lineId, speakerName, text, delivery });
		}
		const narrativeAudioErrors: string[] = [];
		const narrativeAudioPlan = parseNarrativeAudioPlan(
			candidate.narrativeAudioPlan,
			"BeatSheet.narrativeAudioPlan",
			narrativeAudioErrors,
		);
		validateNarrativeAudioPlacement(
			dialogueScript,
			narrativeAudioPlan,
			"BeatSheet.narrativeAudioPlan",
			narrativeAudioErrors,
		);
		if (narrativeAudioErrors.length > 0) return projectedCandidate;
		const speakers = collectSpokenSpeakerNames(combineSpokenScript(dialogueScript, narrativeAudioPlan));
		const current = Array.isArray(candidate.speakers)
			? [...new Set(candidate.speakers.map(nonEmptyString).filter((speaker): speaker is string => speaker !== null))]
			: [];
		if (JSON.stringify(current) === JSON.stringify(speakers)) return projectedCandidate;
		changed = true;
		return { ...projectedCandidate, speakers };
	});
	const compiledRoot = changed
		? {
			...projectedRoot,
			beats,
		}
		: root;
	return compiledRoot;
}

/**
 * Reject only BeatSheet structure that downstream executors cannot decode.
 * Model-authored pacing, source ordering, capacity and semantic continuity are
 * evaluated by the full inspector below as diagnostics, never as workflow
 * blockers or field-level repair targets.
 */
function inspectBeatSheetExecutionBlocker(root: Record<string, unknown>): string | null {
	const corruptedPath = corruptTextPath(root);
	if (corruptedPath) return `${corruptedPath} contains corrupt Unicode replacement/control text`;
	if (!isRecord(root.chapterArc)) return "chapterArc must be an object";
	if (!Array.isArray(root.beats) || root.beats.length === 0) return "beats must be a non-empty array";
	const sourceCoveragePlan = isRecord(root.sourceCoveragePlan) ? root.sourceCoveragePlan : null;
	if (!sourceCoveragePlan || !Array.isArray(sourceCoveragePlan.speechLedger)) {
		return "sourceCoveragePlan.speechLedger must be an array";
	}
	const seenSpeechLineIds = new Set<string>();
	for (const [lineIndex, rawLine] of sourceCoveragePlan.speechLedger.entries()) {
		const path = `sourceCoveragePlan.speechLedger[${lineIndex}]`;
		if (!isRecord(rawLine)) return `${path} must be an object`;
		const lineId = nonEmptyString(rawLine.lineId);
		if (!lineId) return `${path}.lineId must be non-empty`;
		if (seenSpeechLineIds.has(lineId)) return `${path}.lineId must be unique`;
		seenSpeechLineIds.add(lineId);
		if (!nonEmptyString(rawLine.speakerName)) return `${path}.speakerName must be non-empty`;
		if (!nonEmptyString(rawLine.text)) return `${path}.text must be non-empty`;
		if (!Number.isInteger(rawLine.clipIndex)
			|| Number(rawLine.clipIndex) < 0
			|| Number(rawLine.clipIndex) >= root.beats.length) {
			return `${path}.clipIndex must reference an existing beat`;
		}
		if (rawLine.delivery !== "on_screen"
			&& rawLine.delivery !== "off_screen"
			&& rawLine.delivery !== "voice_over") {
			return `${path}.delivery must be on_screen/off_screen/voice_over`;
		}
	}
	for (const [beatIndex, rawBeat] of root.beats.entries()) {
		const path = `beats[${beatIndex}]`;
		if (!isRecord(rawBeat)) return `${path} must be an object`;
		if (typeof rawBeat.durationSeconds !== "number"
			|| !Number.isFinite(rawBeat.durationSeconds)
			|| rawBeat.durationSeconds <= 0) {
			return `${path}.durationSeconds must be positive`;
		}
		if (!Array.isArray(rawBeat.dialogueScript)) return `${path}.dialogueScript must be an array`;
		for (const [lineIndex, rawLine] of rawBeat.dialogueScript.entries()) {
			const linePath = `${path}.dialogueScript[${lineIndex}]`;
			if (!isRecord(rawLine)) return `${linePath} must be an object`;
			if (!nonEmptyString(rawLine.lineId)) return `${linePath}.lineId must be non-empty`;
			if (!nonEmptyString(rawLine.speakerName)) return `${linePath}.speakerName must be non-empty`;
			if (!nonEmptyString(rawLine.text)) return `${linePath}.text must be non-empty`;
			if (rawLine.delivery !== "on_screen"
				&& rawLine.delivery !== "off_screen"
				&& rawLine.delivery !== "voice_over") {
				return `${linePath}.delivery must be on_screen/off_screen/voice_over`;
			}
		}
		if (rawBeat.narrativeAudioPlan !== undefined) {
			if (!isRecord(rawBeat.narrativeAudioPlan)
				|| !Array.isArray(rawBeat.narrativeAudioPlan.lines)) {
				return `${path}.narrativeAudioPlan.lines must be an array`;
			}
			const narrativeLineIds = new Set<string>();
			for (const [lineIndex, rawLine] of rawBeat.narrativeAudioPlan.lines.entries()) {
				const linePath = `${path}.narrativeAudioPlan.lines[${lineIndex}]`;
				if (!isRecord(rawLine)) return `${linePath} must be an object`;
				const lineId = nonEmptyString(rawLine.lineId);
				if (!lineId) return `${linePath}.lineId must be non-empty`;
				if (narrativeLineIds.has(lineId)) return `${linePath}.lineId must be unique`;
				narrativeLineIds.add(lineId);
				if (!nonEmptyString(rawLine.speakerName)) return `${linePath}.speakerName must be non-empty`;
				if (!nonEmptyString(rawLine.text)) return `${linePath}.text must be non-empty`;
				if (rawLine.delivery !== undefined
					&& rawLine.delivery !== "on_screen"
					&& rawLine.delivery !== "off_screen"
					&& rawLine.delivery !== "voice_over") {
					return `${linePath}.delivery must be on_screen/off_screen/voice_over`;
				}
				if (rawLine.afterSourceLineId !== null && !nonEmptyString(rawLine.afterSourceLineId)) {
					return `${linePath}.afterSourceLineId must be a non-empty string or null`;
				}
				if (!Array.isArray(rawLine.sourceEvidence)
					|| rawLine.sourceEvidence.some((value) => typeof value !== "string")) {
					return `${linePath}.sourceEvidence must be a string array`;
				}
			}
		}
		if (!Array.isArray(rawBeat.storyEvents) || rawBeat.storyEvents.length === 0) {
			return `${path}.storyEvents must be a non-empty array`;
		}
		for (const [eventIndex, rawEvent] of rawBeat.storyEvents.entries()) {
			const eventPath = `${path}.storyEvents[${eventIndex}]`;
			if (!isRecord(rawEvent)) return `${eventPath} must be an object`;
			if (!nonEmptyString(rawEvent.sourceBeatId)) return `${eventPath}.sourceBeatId must be non-empty`;
			if (!nonEmptyString(rawEvent.event)) return `${eventPath}.event must be non-empty`;
			if (!nonEmptyString(rawEvent.entryState)) return `${eventPath}.entryState must be non-empty`;
			if (!nonEmptyString(rawEvent.exitState)) return `${eventPath}.exitState must be non-empty`;
			if (typeof rawEvent.startSeconds !== "number"
				|| !Number.isFinite(rawEvent.startSeconds)
				|| typeof rawEvent.endSeconds !== "number"
				|| !Number.isFinite(rawEvent.endSeconds)
				|| rawEvent.endSeconds <= rawEvent.startSeconds) {
				return `${eventPath} must use a finite positive time interval`;
			}
		}
	}
	try {
		validateWorkflowBeatObjectContinuity(root.beats.filter(isRecord));
	} catch (error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}
	return null;
}

function inspectBeatSheetArtifact(root: Record<string, unknown>): string | null {
	const corruptedPath = corruptTextPath(root);
	if (corruptedPath) return `${corruptedPath} contains corrupt Unicode replacement/control text`;
	const chapterArc = isRecord(root.chapterArc) ? root.chapterArc : null;
	if (!chapterArc) return "chapterArc must be an object";
	for (const field of ["storyPromise", "protagonistThroughline", "primaryPayoff", "endingHook"] as const) {
		if (!nonEmptyString(chapterArc[field])) return `chapterArc.${field} must be non-empty`;
	}
	const audit = isRecord(root.sourceFidelityAudit) ? root.sourceFidelityAudit : null;
	if (!audit || !Array.isArray(audit.sourceBeatLedger) || audit.sourceBeatLedger.length === 0) {
		return "sourceFidelityAudit.sourceBeatLedger must be a non-empty array";
	}
	const ledger: Array<Readonly<{ id: string; durationSeconds: number }>> = [];
	for (const [index, candidate] of audit.sourceBeatLedger.entries()) {
		if (!isRecord(candidate)) return `sourceFidelityAudit.sourceBeatLedger[${index}] must be an object`;
		const id = nonEmptyString(candidate.sourceBeatId);
		const summary = nonEmptyString(candidate.summary);
		if (!id) return `sourceFidelityAudit.sourceBeatLedger[${index}].sourceBeatId must be non-empty`;
		if (!summary) return `sourceFidelityAudit.sourceBeatLedger[${index}].summary must be non-empty`;
		if (candidate.sourceOrder !== index) return `sourceFidelityAudit.sourceBeatLedger[${index}].sourceOrder must equal ${index}`;
		if (typeof candidate.durationSeconds !== "number" || !Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds <= 0) {
			return `sourceFidelityAudit.sourceBeatLedger[${index}].durationSeconds must be positive`;
		}
		ledger.push({ id, durationSeconds: candidate.durationSeconds });
	}
	if (new Set(ledger.map((item) => item.id)).size !== ledger.length) {
		return "sourceFidelityAudit.sourceBeatLedger sourceBeatId values must be unique";
	}
	const sourceCoveragePlan = isRecord(root.sourceCoveragePlan) ? root.sourceCoveragePlan : null;
	if (!sourceCoveragePlan || !Array.isArray(sourceCoveragePlan.speechLedger)) {
		return "sourceCoveragePlan.speechLedger must be an array; use [] only when the authoritative source has no speech";
	}
	if (!Array.isArray(root.beats) || root.beats.length === 0) return "beats must be a non-empty array";
	const expectedSpeech: Array<Readonly<{ lineId: string; speakerName: string; text: string }>> = [];
	for (const [lineIndex, rawLine] of sourceCoveragePlan.speechLedger.entries()) {
		if (!isRecord(rawLine)) return `sourceCoveragePlan.speechLedger[${lineIndex}] must be an object`;
		const lineId = nonEmptyString(rawLine.lineId);
		const speakerName = nonEmptyString(rawLine.speakerName);
		const text = nonEmptyString(rawLine.text);
		const clipIndex = rawLine.clipIndex;
		const delivery = rawLine.delivery;
		if (!lineId) return `sourceCoveragePlan.speechLedger[${lineIndex}].lineId must be non-empty`;
		if (!speakerName) return `sourceCoveragePlan.speechLedger[${lineIndex}].speakerName must be non-empty`;
		if (!text) return `sourceCoveragePlan.speechLedger[${lineIndex}].text must preserve non-empty verbatim source text`;
		if (!Number.isInteger(clipIndex) || Number(clipIndex) < 0 || Number(clipIndex) >= root.beats.length) {
			return `sourceCoveragePlan.speechLedger[${lineIndex}].clipIndex must reference an existing beat`;
		}
		if (delivery !== "on_screen" && delivery !== "off_screen" && delivery !== "voice_over") {
			return `sourceCoveragePlan.speechLedger[${lineIndex}].delivery must be on_screen/off_screen/voice_over`;
		}
		expectedSpeech.push({ lineId, speakerName, text });
	}
	const ledgerIndex = new Map(ledger.map((item, index) => [item.id, index] as const));
	const allocatedDuration = new Map<string, number>(ledger.map((item) => [item.id, 0]));
	let totalPhysicalDuration = 0;
	let previousSourceOrder = -1;
	let previousExitState: string | null = null;
	const actualSpeech: Array<Readonly<{ lineId: string; speakerName: string; text: string }>> = [];
	for (const [beatIndex, candidate] of root.beats.entries()) {
		if (!isRecord(candidate)) return `beats[${beatIndex}] must be an object`;
		if (candidate.clipIndex !== beatIndex) return `beats[${beatIndex}].clipIndex must equal ${beatIndex}`;
		for (const field of ["dominantFunction", "causalEntry", "irreversibleResult", "handoffToNext"] as const) {
			if (!nonEmptyString(candidate[field])) return `beats[${beatIndex}].${field} must be non-empty`;
		}
		if (!Array.isArray(candidate.dialogueScript)) return `beats[${beatIndex}].dialogueScript must be an array`;
		const beatDialogueScript: SpokenScriptLine[] = [];
		{
			for (const [lineIndex, rawLine] of candidate.dialogueScript.entries()) {
				if (!isRecord(rawLine)) return `beats[${beatIndex}].dialogueScript[${lineIndex}] must be an object`;
				const lineId = nonEmptyString(rawLine.lineId);
				const speakerName = nonEmptyString(rawLine.speakerName);
				const text = nonEmptyString(rawLine.text);
				if (!lineId) return `beats[${beatIndex}].dialogueScript[${lineIndex}].lineId must be non-empty`;
				if (!speakerName) return `beats[${beatIndex}].dialogueScript[${lineIndex}].speakerName must be non-empty`;
				if (!text) return `beats[${beatIndex}].dialogueScript[${lineIndex}].text must be non-empty`;
				if (rawLine.delivery !== "on_screen" && rawLine.delivery !== "off_screen" && rawLine.delivery !== "voice_over") {
					return `beats[${beatIndex}].dialogueScript[${lineIndex}].delivery must be on_screen/off_screen/voice_over`;
				}
				beatDialogueScript.push({
					lineId,
					speakerName,
					text,
					delivery: rawLine.delivery,
				});
				actualSpeech.push({ lineId, speakerName, text });
			}
		}
		const narrativeAudioErrors: string[] = [];
		const narrativeAudioPlan = parseNarrativeAudioPlan(
			candidate.narrativeAudioPlan,
			`beats[${beatIndex}].narrativeAudioPlan`,
			narrativeAudioErrors,
		);
		validateNarrativeAudioPlacement(
			beatDialogueScript,
			narrativeAudioPlan,
			`beats[${beatIndex}].narrativeAudioPlan`,
			narrativeAudioErrors,
		);
		if (narrativeAudioErrors.length > 0) return narrativeAudioErrors.join("; ");
		const beatSpokenScript = combineSpokenScript(beatDialogueScript, narrativeAudioPlan);
		const expectedBeatSpeakers = collectSpokenSpeakerNames(beatSpokenScript);
		const actualBeatSpeakers = Array.isArray(candidate.speakers)
			? [...new Set(candidate.speakers.map(nonEmptyString).filter((speaker): speaker is string => speaker !== null))]
			: [];
		if (JSON.stringify(actualBeatSpeakers) !== JSON.stringify(expectedBeatSpeakers)) {
			return `beats[${beatIndex}].speakers must exactly equal the ordered unique speakers from dialogueScript+narrativeAudioPlan; expected=${JSON.stringify(expectedBeatSpeakers)}:actual=${JSON.stringify(actualBeatSpeakers)}`;
		}
		if (typeof candidate.durationSeconds !== "number" || !Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds <= 0) {
			return `beats[${beatIndex}].durationSeconds must be positive`;
		}
		const declaredPaceRate = parseDialoguePaceRate(candidate.dialoguePaceRate);
		if (candidate.dialoguePaceRate !== undefined && declaredPaceRate === null) {
			return `beats[${beatIndex}].dialoguePaceRate must be a positive numeric chars-per-second fact`;
		}
		const effectivePaceRate = Math.min(
			declaredPaceRate ?? DEFAULT_DIALOGUE_CHARS_PER_SEC,
			DIALOGUE_PACE_CEILING,
		);
		const minimumDialogueSeconds = beatSpokenScript.reduce((total, line) => (
			total + Math.ceil((countDialogueChars(line.text) / effectivePaceRate) * 2) / 2
		), 0);
		if (minimumDialogueSeconds > candidate.durationSeconds) {
			return `beats[${beatIndex}] cannot carry its frozen spoken script: durationSeconds=${candidate.durationSeconds}, dialoguePaceRate=${effectivePaceRate}, minimumDialogueSeconds=${minimumDialogueSeconds}; lowering dialoguePaceRate increases minimumDialogueSeconds and is not a repair. Keep every line verbatim and in order, then increase durationSeconds or move complete ordered speechLedger lines across beat boundaries in the same Agent task; do not use pace as a blind fit knob`;
		}
		totalPhysicalDuration += candidate.durationSeconds;
		if (!Array.isArray(candidate.storyEvents) || candidate.storyEvents.length === 0) {
			return `beats[${beatIndex}].storyEvents must be a non-empty array`;
		}
		let cursor = 0;
		let firstEntryState: string | null = null;
		let lastExitState: string | null = null;
		for (const [eventIndex, eventCandidate] of candidate.storyEvents.entries()) {
			if (!isRecord(eventCandidate)) return `beats[${beatIndex}].storyEvents[${eventIndex}] must be an object`;
			const sourceBeatId = nonEmptyString(eventCandidate.sourceBeatId);
			const event = nonEmptyString(eventCandidate.event);
			const entryState = nonEmptyString(eventCandidate.entryState);
			const exitState = nonEmptyString(eventCandidate.exitState);
			const startSeconds = eventCandidate.startSeconds;
			const endSeconds = eventCandidate.endSeconds;
			if (!sourceBeatId) return `beats[${beatIndex}].storyEvents[${eventIndex}].sourceBeatId must be non-empty`;
			if (!event) return `beats[${beatIndex}].storyEvents[${eventIndex}].event must be non-empty`;
			if (!entryState) return `beats[${beatIndex}].storyEvents[${eventIndex}].entryState must be non-empty`;
			if (!exitState) return `beats[${beatIndex}].storyEvents[${eventIndex}].exitState must be non-empty`;
			const sourceOrder = ledgerIndex.get(sourceBeatId);
			if (sourceOrder === undefined) return `beats[${beatIndex}].storyEvents[${eventIndex}] references unknown sourceBeatId ${sourceBeatId}`;
			if (sourceOrder < previousSourceOrder || sourceOrder > previousSourceOrder + 1) {
				return `beats[${beatIndex}].storyEvents[${eventIndex}] must preserve contiguous source beat order`;
			}
			if (typeof startSeconds !== "number" || typeof endSeconds !== "number"
				|| !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
				|| startSeconds !== cursor || endSeconds <= startSeconds) {
				return `beats[${beatIndex}].storyEvents[${eventIndex}] must form a contiguous positive local timeline`;
			}
			if (eventIndex > 0 && entryState !== lastExitState) {
				return `beats[${beatIndex}].storyEvents[${eventIndex}].entryState must equal the previous event exitState`;
			}
			firstEntryState ??= entryState;
			lastExitState = exitState;
			cursor = endSeconds;
			previousSourceOrder = sourceOrder;
			allocatedDuration.set(sourceBeatId, (allocatedDuration.get(sourceBeatId) ?? 0) + endSeconds - startSeconds);
		}
		if (cursor !== candidate.durationSeconds) return `beats[${beatIndex}].storyEvents must exactly fill durationSeconds`;
		if (beatIndex > 0 && firstEntryState !== previousExitState) {
			return `beats[${beatIndex}] first story event must continue the previous physical Clip exitState`;
		}
		if (nonEmptyString(candidate.exitState) !== lastExitState) {
			return `beats[${beatIndex}].exitState must equal the final story event exitState`;
		}
		if (Object.prototype.hasOwnProperty.call(candidate, "temporalFrameTrack")) {
			return `beats[${beatIndex}].temporalFrameTrack is writer-owned and must be omitted from the chapter BeatSheet`;
		}
		previousExitState = lastExitState;
	}
	const sourceDurationTotal = ledger.reduce((total, item) => total + item.durationSeconds, 0);
	if (!equalDurationAtContractPrecision(sourceDurationTotal, totalPhysicalDuration)) return "sourceBeatLedger durations must equal total physical Clip duration";
	for (const item of ledger) {
		if (!equalDurationAtContractPrecision(allocatedDuration.get(item.id) ?? 0, item.durationSeconds)) {
			return `storyEvents allocated duration for ${item.id} must equal sourceBeatLedger durationSeconds`;
		}
	}
	if (JSON.stringify(actualSpeech) !== JSON.stringify(expectedSpeech)) {
		return `BeatSheet dialogueScript must reconstruct sourceCoveragePlan.speechLedger exactly; expected=${JSON.stringify(expectedSpeech)}:actual=${JSON.stringify(actualSpeech)}`;
	}
	const continuityDiagnostic = inspectWorkflowBeatObjectContinuity(root.beats.filter(isRecord)).diagnostics[0];
	if (continuityDiagnostic) return continuityDiagnostic.message;
	return null;
}

export function parseWorkflowAgentJsonArrayContract(value: unknown): WorkflowAgentJsonArrayContract | null {
	if (!isRecord(value)) return null;
	const minimumArrayLength = value.minimumArrayLength;
	if (minimumArrayLength !== undefined && (
		typeof minimumArrayLength !== "number"
		|| !Number.isInteger(minimumArrayLength)
		|| minimumArrayLength < 0
	)) return null;
	const expectedArrayLength = value.expectedArrayLength;
	if (expectedArrayLength !== undefined && (
		typeof expectedArrayLength !== "number"
		|| !Number.isInteger(expectedArrayLength)
		|| expectedArrayLength <= 0
	)) return null;
	if (
		minimumArrayLength !== undefined
		&& expectedArrayLength !== undefined
		&& minimumArrayLength > expectedArrayLength
	) return null;
	const itemRequiredStringFields = parseFieldList(value.itemRequiredStringFields);
	const itemStringFormats = parseItemStringFormats(value.itemStringFormats);
	const itemRequiredNumberFields = parseFieldList(value.itemRequiredNumberFields);
	const itemRequiredNonEmptyArrayFields = parseFieldList(value.itemRequiredNonEmptyArrayFields);
	const itemAllowedFields = parseFieldList(value.itemAllowedFields);
	const itemStringAllowedValues = parseItemStringAllowedValues(value.itemStringAllowedValues);
	const itemStringArrayAllowedValues = parseItemStringArrayAllowedValues(value.itemStringArrayAllowedValues);
	const itemRequiredNonEmptyArrayFieldsByIdentity = parseItemRequiredNonEmptyArrayFieldsByIdentity(
		value.itemRequiredNonEmptyArrayFieldsByIdentity,
	);
	const itemExactStringFieldsByIdentity = parseItemExactStringFieldsByIdentity(value.itemExactStringFieldsByIdentity);
	if (
		itemRequiredStringFields === null
		|| itemStringFormats === null
		|| itemRequiredNumberFields === null
		|| itemRequiredNonEmptyArrayFields === null
		|| itemAllowedFields === null
		|| itemStringAllowedValues === null
		|| itemStringArrayAllowedValues === null
		|| itemRequiredNonEmptyArrayFieldsByIdentity === null
		|| itemExactStringFieldsByIdentity === null
	) return null;

	let itemExactNumberFields: Record<string, number> | undefined;
	if (value.itemExactNumberFields !== undefined) {
		if (!isRecord(value.itemExactNumberFields)) return null;
		const entries = Object.entries(value.itemExactNumberFields);
		if (entries.length === 0 || entries.length > 64) return null;
		const normalizedEntries: Array<[string, number]> = [];
		for (const [rawField, rawNumber] of entries) {
			const field = rawField.trim();
			if (!field || typeof rawNumber !== "number" || !Number.isFinite(rawNumber)) return null;
			normalizedEntries.push([field, rawNumber]);
		}
		itemExactNumberFields = Object.fromEntries(normalizedEntries);
	}
	const requiredFields = new Set([
		...(itemRequiredStringFields ?? []),
		...(itemRequiredNumberFields ?? []),
		...(itemRequiredNonEmptyArrayFields ?? []),
		...Object.keys(itemStringAllowedValues ?? {}),
		...Object.keys(itemStringArrayAllowedValues ?? {}),
	]);
	if (Object.keys(itemStringFormats ?? {}).some((field) => !itemRequiredStringFields?.includes(field))) return null;
	if (Object.keys(itemExactNumberFields ?? {}).some((field) => !requiredFields.has(field))) return null;
	if (itemAllowedFields) {
		const allowedFields = new Set(itemAllowedFields);
		if ([...requiredFields].some((field) => !allowedFields.has(field))) return null;
		if (itemExactStringFieldsByIdentity) {
			if (!allowedFields.has(itemExactStringFieldsByIdentity.identityField)) return null;
			const exactFields = Object.values(itemExactStringFieldsByIdentity.values).flatMap((fields) => Object.keys(fields));
			if (exactFields.some((field) => !allowedFields.has(field))) return null;
		}
		if (itemRequiredNonEmptyArrayFieldsByIdentity) {
			if (!allowedFields.has(itemRequiredNonEmptyArrayFieldsByIdentity.identityField)) return null;
			const conditionalFields = Object.values(itemRequiredNonEmptyArrayFieldsByIdentity.values).flat();
			if (conditionalFields.some((field) => !allowedFields.has(field))) return null;
		}
	}
	if (
		expectedArrayLength === undefined
		&& !itemRequiredStringFields
		&& !itemStringFormats
		&& !itemRequiredNumberFields
		&& !itemRequiredNonEmptyArrayFields
		&& !itemExactNumberFields
		&& !itemStringAllowedValues
		&& !itemStringArrayAllowedValues
		&& !itemRequiredNonEmptyArrayFieldsByIdentity
		&& !itemExactStringFieldsByIdentity
		&& !itemAllowedFields
	) return null;
	return {
		...(minimumArrayLength === undefined ? {} : { minimumArrayLength }),
		...(expectedArrayLength === undefined ? {} : { expectedArrayLength }),
		...(itemRequiredStringFields ? { itemRequiredStringFields } : {}),
		...(itemStringFormats ? { itemStringFormats } : {}),
		...(itemRequiredNumberFields ? { itemRequiredNumberFields } : {}),
		...(itemRequiredNonEmptyArrayFields ? { itemRequiredNonEmptyArrayFields } : {}),
		...(itemExactNumberFields ? { itemExactNumberFields } : {}),
		...(itemStringAllowedValues ? { itemStringAllowedValues } : {}),
		...(itemStringArrayAllowedValues ? { itemStringArrayAllowedValues } : {}),
		...(itemRequiredNonEmptyArrayFieldsByIdentity ? { itemRequiredNonEmptyArrayFieldsByIdentity } : {}),
		...(itemExactStringFieldsByIdentity ? { itemExactStringFieldsByIdentity } : {}),
		...(itemAllowedFields ? { itemAllowedFields } : {}),
	};
}

export function parseWorkflowAgentJsonObjectContract(value: unknown): WorkflowAgentJsonObjectContract | null {
	if (!isRecord(value)) return null;
	if (Object.prototype.hasOwnProperty.call(value, "failurePolicy")
		|| Object.prototype.hasOwnProperty.call(value, "collectionCorrectionFields")
		|| Object.prototype.hasOwnProperty.call(value, "arrayItemMergeKeyFields")) return null;
	const contractName = typeof value.contractName === "string" ? value.contractName.trim() : "";
	const contractVersion = typeof value.contractVersion === "string" ? value.contractVersion.trim() : "";
	if (Boolean(contractName) !== Boolean(contractVersion)) return null;
	const requiredStringFields = parseFieldList(value.requiredStringFields);
	const requiredNumberFields = parseFieldList(value.requiredNumberFields);
	const requiredObjectFields = parseFieldList(value.requiredObjectFields);
	const requiredArrayFields = parseFieldList(value.requiredArrayFields);
	const allowedFields = parseFieldList(value.allowedFields);
	if (
		requiredStringFields === null
		|| requiredNumberFields === null
		|| requiredObjectFields === null
		|| requiredArrayFields === null
		|| !allowedFields
	) return null;
	const requiredFields = [
		...(requiredStringFields ?? []),
		...(requiredNumberFields ?? []),
		...(requiredObjectFields ?? []),
		...(requiredArrayFields ?? []),
	];
	if (requiredFields.length === 0 || new Set(requiredFields).size !== requiredFields.length) return null;
	const allowed = new Set(allowedFields);
	if (requiredFields.some((field) => !allowed.has(field))) return null;
	let exactStringFields: Record<string, string> | undefined;
	if (value.exactStringFields !== undefined) {
		if (!isRecord(value.exactStringFields)) return null;
		const entries = Object.entries(value.exactStringFields);
		if (entries.length === 0 || entries.length > 64) return null;
		const requiredStrings = new Set(requiredStringFields ?? []);
		const normalized: Record<string, string> = {};
		for (const [rawField, rawValue] of entries) {
			const field = rawField.trim();
			const exactValue = typeof rawValue === "string" ? rawValue.trim() : "";
			if (!field || !exactValue || !requiredStrings.has(field) || !allowed.has(field)) return null;
			normalized[field] = exactValue;
		}
		exactStringFields = normalized;
	}
	let expectedArrayLengths: Record<string, number> | undefined;
	if (value.expectedArrayLengths !== undefined) {
		if (!isRecord(value.expectedArrayLengths)) return null;
		const entries = Object.entries(value.expectedArrayLengths);
		if (entries.length === 0 || entries.length > 64) return null;
		const normalized: Record<string, number> = {};
		for (const [rawField, rawLength] of entries) {
			const field = rawField.trim();
			if (!field || typeof rawLength !== "number" || !Number.isInteger(rawLength) || rawLength <= 0) return null;
			normalized[field] = rawLength;
		}
		const arrayFields = new Set(requiredArrayFields ?? []);
		if (Object.keys(normalized).some((field) => !arrayFields.has(field) || !allowed.has(field))) return null;
		expectedArrayLengths = normalized;
	}
	let arrayItemExactNumberFields: Record<string, readonly Readonly<Record<string, number>>[]> | undefined;
	let arrayItemNumberAllowedValues: Record<string, Readonly<Record<string, readonly number[]>>> | undefined;
	const parseArrayItemRequiredFields = (
		rawValue: unknown,
	): Readonly<Record<string, readonly string[]>> | null | undefined => {
		if (rawValue === undefined) return undefined;
		if (!isRecord(rawValue)) return null;
		const entries = Object.entries(rawValue);
		if (entries.length === 0 || entries.length > 64) return null;
		const arrayFields = new Set(requiredArrayFields ?? []);
		const normalized: Record<string, readonly string[]> = {};
		for (const [rawArrayField, rawFields] of entries) {
			const arrayField = rawArrayField.trim();
			const fields = parseFieldList(rawFields);
			if (!arrayField || !arrayFields.has(arrayField) || !allowed.has(arrayField) || !fields) return null;
			normalized[arrayField] = fields;
		}
		return normalized;
	};
	const arrayItemRequiredStringFields = parseArrayItemRequiredFields(value.arrayItemRequiredStringFields);
	const arrayItemRequiredStringArrayFields = parseArrayItemRequiredFields(
		value.arrayItemRequiredStringArrayFields,
	);
	const arrayItemRequiredNonEmptyStringArrayFields = parseArrayItemRequiredFields(
		value.arrayItemRequiredNonEmptyStringArrayFields,
	);
	const arrayItemAllowedFields = parseArrayItemRequiredFields(value.arrayItemAllowedFields);
	if (arrayItemRequiredStringFields === null
		|| arrayItemRequiredStringArrayFields === null
		|| arrayItemRequiredNonEmptyStringArrayFields === null
		|| arrayItemAllowedFields === null) return null;
	if (value.arrayItemExactNumberFields !== undefined) {
		if (!isRecord(value.arrayItemExactNumberFields)) return null;
		const entries = Object.entries(value.arrayItemExactNumberFields);
		if (entries.length === 0 || entries.length > 64) return null;
		const normalized: Record<string, readonly Readonly<Record<string, number>>[]> = {};
		const arrayFields = new Set(requiredArrayFields ?? []);
		for (const [rawArrayField, rawItemContracts] of entries) {
			const arrayField = rawArrayField.trim();
			if (
				!arrayField
				|| !arrayFields.has(arrayField)
				|| !allowed.has(arrayField)
				|| !Array.isArray(rawItemContracts)
				|| rawItemContracts.length === 0
				|| rawItemContracts.length > 256
				|| expectedArrayLengths?.[arrayField] !== rawItemContracts.length
			) return null;
			const itemContracts: Array<Readonly<Record<string, number>>> = [];
			for (const rawItemContract of rawItemContracts) {
				if (!isRecord(rawItemContract)) return null;
				const numberEntries = Object.entries(rawItemContract);
				if (numberEntries.length === 0 || numberEntries.length > 16) return null;
				const exactNumbers: Record<string, number> = {};
				for (const [rawField, rawNumber] of numberEntries) {
					const field = rawField.trim();
					if (!field || typeof rawNumber !== "number" || !Number.isFinite(rawNumber)) return null;
					exactNumbers[field] = rawNumber;
				}
				itemContracts.push(exactNumbers);
			}
			normalized[arrayField] = itemContracts;
		}
		arrayItemExactNumberFields = normalized;
	}
	if (value.arrayItemNumberAllowedValues !== undefined) {
		if (!isRecord(value.arrayItemNumberAllowedValues)) return null;
		const entries = Object.entries(value.arrayItemNumberAllowedValues);
		if (entries.length === 0 || entries.length > 64) return null;
		const normalized: Record<string, Readonly<Record<string, readonly number[]>>> = {};
		const arrayFields = new Set(requiredArrayFields ?? []);
		for (const [rawArrayField, rawFieldValues] of entries) {
			const arrayField = rawArrayField.trim();
			if (!arrayField || !arrayFields.has(arrayField) || !allowed.has(arrayField) || !isRecord(rawFieldValues)) return null;
			const fieldEntries = Object.entries(rawFieldValues);
			if (fieldEntries.length === 0 || fieldEntries.length > 16) return null;
			const normalizedFieldValues: Record<string, readonly number[]> = {};
			for (const [rawField, rawAllowedValues] of fieldEntries) {
				const field = rawField.trim();
				if (!field || !Array.isArray(rawAllowedValues) || rawAllowedValues.length === 0 || rawAllowedValues.length > 64) return null;
				const allowedValues = rawAllowedValues.filter(
					(value): value is number => typeof value === "number" && Number.isFinite(value),
				);
				if (allowedValues.length !== rawAllowedValues.length || new Set(allowedValues).size !== allowedValues.length) return null;
				normalizedFieldValues[field] = allowedValues;
			}
			normalized[arrayField] = normalizedFieldValues;
		}
		arrayItemNumberAllowedValues = normalized;
	}
	let arrayItemExactStringFields: Record<string, readonly Readonly<Record<string, string>>[]> | undefined;
	if (value.arrayItemExactStringFields !== undefined) {
		if (!isRecord(value.arrayItemExactStringFields)) return null;
		const normalized: Record<string, readonly Readonly<Record<string, string>>[]> = {};
		const arrayFields = new Set(requiredArrayFields ?? []);
		for (const [rawArrayField, rawItemContracts] of Object.entries(value.arrayItemExactStringFields)) {
			const arrayField = rawArrayField.trim();
			if (!arrayField || !arrayFields.has(arrayField) || !allowed.has(arrayField) || !Array.isArray(rawItemContracts)
				|| rawItemContracts.length === 0 || rawItemContracts.length > 256
				|| expectedArrayLengths?.[arrayField] !== rawItemContracts.length) return null;
			const itemContracts: Array<Readonly<Record<string, string>>> = [];
			for (const rawItemContract of rawItemContracts) {
				if (!isRecord(rawItemContract)) return null;
				const entries = Object.entries(rawItemContract);
				if (entries.length === 0 || entries.length > 16) return null;
				const exactStrings: Record<string, string> = {};
				for (const [rawField, rawString] of entries) {
					const field = rawField.trim();
					const exactString = typeof rawString === "string" ? rawString.trim() : "";
					if (!field || !exactString) return null;
					exactStrings[field] = exactString;
				}
				itemContracts.push(exactStrings);
			}
			normalized[arrayField] = itemContracts;
		}
		if (Object.keys(normalized).length === 0) return null;
		arrayItemExactStringFields = normalized;
	}
	let arrayItemExactStringArrayFields: Record<string, readonly Readonly<Record<string, readonly string[]>>[]> | undefined;
	if (value.arrayItemExactStringArrayFields !== undefined) {
		if (!isRecord(value.arrayItemExactStringArrayFields)) return null;
		const normalized: Record<string, readonly Readonly<Record<string, readonly string[]>>[]> = {};
		const arrayFields = new Set(requiredArrayFields ?? []);
		for (const [rawArrayField, rawItemContracts] of Object.entries(value.arrayItemExactStringArrayFields)) {
			const arrayField = rawArrayField.trim();
			if (!arrayField || !arrayFields.has(arrayField) || !allowed.has(arrayField) || !Array.isArray(rawItemContracts)
				|| rawItemContracts.length === 0 || rawItemContracts.length > 256
				|| expectedArrayLengths?.[arrayField] !== rawItemContracts.length) return null;
			const itemContracts: Array<Readonly<Record<string, readonly string[]>>> = [];
			for (const rawItemContract of rawItemContracts) {
				if (!isRecord(rawItemContract)) return null;
				const entries = Object.entries(rawItemContract);
				if (entries.length === 0 || entries.length > 16) return null;
				const exactArrays: Record<string, readonly string[]> = {};
				for (const [rawField, rawStrings] of entries) {
					const field = rawField.trim();
					if (!field || !Array.isArray(rawStrings) || rawStrings.length === 0 || rawStrings.length > 256) return null;
					const strings = rawStrings.map((item) => typeof item === "string" ? item.trim() : "");
					if (strings.some((item) => !item)) return null;
					exactArrays[field] = strings;
				}
				itemContracts.push(exactArrays);
			}
			normalized[arrayField] = itemContracts;
		}
		if (Object.keys(normalized).length === 0) return null;
		arrayItemExactStringArrayFields = normalized;
	}
	// itemRequiredNonEmptyArrayFields 仅对「顶层单数组对象」形态有意义：
	// 必须有且仅有一个 requiredArrayFields，且数组元素路径不属于顶层 allowedFields。
	const itemRequiredNonEmptyArrayFields = parseFieldList(value.itemRequiredNonEmptyArrayFields);
	if (itemRequiredNonEmptyArrayFields === null) return null;
	if (itemRequiredNonEmptyArrayFields !== undefined) {
		if ((requiredArrayFields?.length ?? 0) !== 1) return null;
		if (itemRequiredNonEmptyArrayFields.some((path) => allowed.has(path))) return null;
	}
	let itemExactAssetIds: WorkflowAgentJsonObjectContract["itemExactAssetIds"] | undefined;
	if (value.itemExactAssetIds !== undefined) {
		if (!isRecord(value.itemExactAssetIds)) return null;
		const exactRecord = value.itemExactAssetIds;
		const declarationPaths = parseFieldList(exactRecord.declarationPaths);
		const expectedAssetPlansFromPort = typeof exactRecord.expectedAssetPlansFromPort === "string"
			? exactRecord.expectedAssetPlansFromPort.trim()
			: "";
		if (!declarationPaths || !expectedAssetPlansFromPort) return null;
		if (declarationPaths.length > 8) return null;
		if ((requiredArrayFields?.length ?? 0) !== 1) return null;
		if (declarationPaths.some((path) => allowed.has(path))) return null;
		itemExactAssetIds = { declarationPaths, expectedAssetPlansFromPort };
	}
	return {
		...(contractName ? { contractName, contractVersion } : {}),
		...(requiredStringFields ? { requiredStringFields } : {}),
		...(exactStringFields ? { exactStringFields } : {}),
		...(requiredNumberFields ? { requiredNumberFields } : {}),
		...(requiredObjectFields ? { requiredObjectFields } : {}),
		...(requiredArrayFields ? { requiredArrayFields } : {}),
		...(expectedArrayLengths ? { expectedArrayLengths } : {}),
		...(arrayItemRequiredStringFields ? { arrayItemRequiredStringFields } : {}),
		...(arrayItemRequiredStringArrayFields ? { arrayItemRequiredStringArrayFields } : {}),
		...(arrayItemRequiredNonEmptyStringArrayFields ? { arrayItemRequiredNonEmptyStringArrayFields } : {}),
		...(arrayItemAllowedFields ? { arrayItemAllowedFields } : {}),
		...(arrayItemExactNumberFields ? { arrayItemExactNumberFields } : {}),
		...(arrayItemNumberAllowedValues ? { arrayItemNumberAllowedValues } : {}),
		...(arrayItemExactStringFields ? { arrayItemExactStringFields } : {}),
		...(arrayItemExactStringArrayFields ? { arrayItemExactStringArrayFields } : {}),
		...(itemRequiredNonEmptyArrayFields ? { itemRequiredNonEmptyArrayFields } : {}),
		...(itemExactAssetIds ? { itemExactAssetIds } : {}),
		allowedFields,
	};
}

/**
 * 从输入端口首值解析冻结资产计划身份集合：value.assetPlans[].assetId。
 * 端口缺失、无 assetPlans 或任一已声明计划缺少稳定 assetId 时显式抛错。
 * 空 assetPlans 是合法的冻结事实：纯 T2V 的 media_delivery 同样必须把“本镜
 * 不绑定任何资产”带进 exact contract，禁止为了通过合同伪造图片资产，也不能
 * 把空集合误判成运行时配置缺失。
 */
export function resolvePlannedAssetIdsFromPort(
	inputs: Readonly<Record<string, readonly unknown[]>>,
	port: string,
): string[] {
	const raw = inputs[port]?.[0];
	if (!isRecord(raw) || !Array.isArray(raw.assetPlans)) {
		throw new Error(
			`Workflow agent exact asset contract requires input port ${port} to carry an assetPlans array`,
		);
	}
	const assetIds: string[] = [];
	for (const [index, plan] of raw.assetPlans.entries()) {
		if (!isRecord(plan)) throw new Error(`assetPlans[${index}] must be an object`);
		const assetId = typeof plan.assetId === "string" ? plan.assetId.trim() : "";
		if (!assetId) throw new Error(`assetPlans[${index}] requires a stable assetId`);
		assetIds.push(assetId);
	}
	const unique = [...new Set(assetIds)];
	return unique;
}

/**
 * 收集交付项在声明路径（每个路径为含 assetId 的对象数组）上声明的资产身份，
 * 与冻结 expected 精确集合比较。只做确定性事实校验，与 agents-cli 合同一致。
 */
export function inspectDeclaredAssetIdsMatch(
	items: readonly unknown[],
	declarationPaths: readonly string[],
	expected: readonly string[],
): string | null {
	const expectedSet = new Set(expected);
	for (const [index, item] of items.entries()) {
		if (!isRecord(item)) return `item ${index + 1} must be an object`;
		const declared = new Set<string>();
		for (const path of declarationPaths) {
			const nested = path.split(".").reduce<unknown>((current, part) => {
				if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
				return (current as Record<string, unknown>)[part];
			}, item);
			if (!Array.isArray(nested)) continue;
			for (const entry of nested) {
				if (!isRecord(entry)) continue;
				const assetId = typeof entry.assetId === "string" ? entry.assetId.trim() : "";
				if (assetId) declared.add(assetId);
			}
		}
		const missing = expected.filter((assetId) => !declared.has(assetId));
		if (missing.length > 0) return `item ${index + 1} is missing declared assetIds: ${missing.join(",")}`;
		const extra = [...declared].filter((assetId) => !expectedSet.has(assetId));
		if (extra.length > 0) return `item ${index + 1} declares unexpected assetIds: ${extra.join(",")}`;
	}
	return null;
}

function inspectVideoWriterArtifact(value: Record<string, unknown>): string | null {
	// Optional authoring notes/audits are non-blocking evidence. Only the
	// executable Clip array participates in transport-integrity validation.
	const corruptedPath = corruptTextPath({ clips: value.clips });
	if (corruptedPath) return `${corruptedPath} contains corrupt Unicode replacement/control text`;
	if (!Array.isArray(value.clips) || value.clips.length === 0) return "clips must be a non-empty array";
	for (const [clipIndex, rawClip] of value.clips.entries()) {
		if (!isRecord(rawClip)) return `clips[${clipIndex}] must be an object`;
		if (!nonEmptyString(rawClip.clipId)) return `clips[${clipIndex}].clipId must be non-empty`;
		if (!Number.isInteger(rawClip.clipIndex) || Number(rawClip.clipIndex) < 0) {
			return `clips[${clipIndex}].clipIndex must be a non-negative integer`;
		}
		if (!Array.isArray(rawClip.shots) || rawClip.shots.length === 0) {
			return `clips[${clipIndex}].shots must be a non-empty array`;
		}
		const invalidShotIndex = rawClip.shots.findIndex((shot) => (
			!isRecord(shot)
			|| typeof shot.durationSeconds !== "number"
			|| !Number.isFinite(shot.durationSeconds)
			|| shot.durationSeconds <= 0
		));
		if (invalidShotIndex >= 0) return `clips[${clipIndex}].shots[${invalidShotIndex}].durationSeconds must be positive`;
		if (!Array.isArray(rawClip.sourceEventCoverage) || rawClip.sourceEventCoverage.length === 0) {
			return `clips[${clipIndex}].sourceEventCoverage must be a non-empty array`;
		}
		const executionIssues = validateStructuredClipExecutionContract(
			rawClip as StructuredClip & Record<string, unknown>,
		);
		if (executionIssues.length > 0) {
			const firstIssue = executionIssues[0];
			return `clips[${clipIndex}].${firstIssue?.path ?? "shots"} ${firstIssue?.problem ?? "is invalid"}`;
		}
		if (!Array.isArray(rawClip.temporalFrameTrack) || rawClip.temporalFrameTrack.length < Math.ceil(Number(rawClip.durationSeconds))) {
			return `clips[${clipIndex}].temporalFrameTrack must contain at least one window per started second`;
		}
		if (!Array.isArray(rawClip.temporalFrameCoverage) || rawClip.temporalFrameCoverage.length !== rawClip.temporalFrameTrack.length) {
			return `clips[${clipIndex}].temporalFrameCoverage must contain one entry per temporal frame window`;
		}
		let objectContracts;
		try {
			objectContracts = parseWorkflowClipAssetObjectContracts(
				rawClip.assetObjectContracts,
				`clips[${clipIndex}].assetObjectContracts`,
			);
		} catch (error: unknown) {
			return error instanceof Error ? error.message : String(error);
		}
		const assetIds = new Set<string>();
		for (const [assetIndex, contract] of objectContracts.entries()) {
			const assetId = contract.assetId ?? "";
			if (assetId && assetIds.has(assetId)) {
				return `clips[${clipIndex}].assetObjectContracts[${assetIndex}].assetId must be unique`;
			}
			if (assetId) assetIds.add(assetId);
		}
	}
	return null;
}

/**
 * Deterministic output-port validation for Agent nodes. This validates only the
 * declared transport shape; creative quality remains owned by agents-cli.
 */
export function validateWorkflowAgentOutput(input: Readonly<{
	encoding: WorkflowAgentOutputEncoding;
	artifactType: string;
	rawText: string;
	jsonArrayContract?: WorkflowAgentJsonArrayContract | null;
	jsonObjectContract?: WorkflowAgentJsonObjectContract | null;
}>): WorkflowAgentOutputContractResult {
	const rawText = input.rawText.trim();
	if (!rawText) return { ok: false, errorMessage: "Agent output text is empty" };
	if (input.encoding === "plain_text") return { ok: true, text: rawText };
	if (input.encoding === "json_object") {
		let parsedValue: unknown;
		try {
			parsedValue = JSON.parse(rawText);
		} catch {
			return { ok: false, errorMessage: "Agent json_object output must be one JSON object without Markdown fences or surrounding prose" };
		}
		if (!isRecord(parsedValue)) return { ok: false, errorMessage: "Agent json_object output must be a JSON object" };
		let parsed = parsedValue;
		const contract = input.jsonObjectContract;
		if (!contract) return { ok: false, errorMessage: "Agent json_object output requires an explicit structural contract" };
		let diagnostics: readonly WorkflowAgentOutputDiagnostic[] = [];
		if (
			contract.contractName === BEAT_SHEET_ARTIFACT_CONTRACT_NAME
			&& (
				input.artifactType === "tapcanvas.beat-sheet/v2"
				|| input.artifactType === "tapcanvas.launch-beat-sheet/v1"
			)
		) {
			if (contract.contractVersion === BEAT_SHEET_ARTIFACT_CONTRACT_VERSION) {
				parsed = projectBeatSheetV19CompilerOwnedInputFields(parsed);
			}
			const compactProjection = projectBeatSheetCompactObjectRegistry(parsed);
			if (!compactProjection.ok) {
				return {
					ok: false,
					errorMessage: `Agent BeatSheet compact object ledger is invalid: ${compactProjection.errorMessage}`,
				};
			}
			parsed = compactProjection.value;
		}
		if (contract.contractName === BEAT_SHEET_ARTIFACT_CONTRACT_NAME
			&& contract.contractVersion === BEAT_SHEET_ARTIFACT_CONTRACT_VERSION) {
			parsed = projectBeatSheetCompilerOwnedFields(parsed, contract.exactStringFields);
		}
		const unexpectedField = Object.keys(parsed).find((field) => !contract.allowedFields.includes(field));
		if (unexpectedField) return { ok: false, errorMessage: `Agent json_object output contains unexpected field ${unexpectedField}` };
		const missingStringField = contract.requiredStringFields?.find(
			(field) => typeof parsed[field] !== "string" || !(parsed[field] as string).trim(),
		);
		if (missingStringField) return { ok: false, errorMessage: `Agent json_object output requires non-empty string field ${missingStringField}` };
		const mismatchedExactString = Object.entries(contract.exactStringFields ?? {}).find(
			([field, expected]) => typeof parsed[field] !== "string" || (parsed[field] as string).trim() !== expected,
		);
		if (mismatchedExactString) {
			return {
				ok: false,
				errorMessage: `Agent json_object output field ${mismatchedExactString[0]} must exactly preserve the frozen string fact`,
			};
		}
		const missingNumberField = contract.requiredNumberFields?.find(
			(field) => typeof parsed[field] !== "number" || !Number.isFinite(parsed[field] as number),
		);
		if (missingNumberField) return { ok: false, errorMessage: `Agent json_object output requires finite number field ${missingNumberField}` };
		const missingObjectField = contract.requiredObjectFields?.find((field) => !isRecord(parsed[field]));
		if (missingObjectField) return { ok: false, errorMessage: `Agent json_object output requires object field ${missingObjectField}` };
		const missingArrayField = contract.requiredArrayFields?.find((field) => !Array.isArray(parsed[field]));
		if (missingArrayField) return { ok: false, errorMessage: `Agent json_object output requires array field ${missingArrayField}` };
		const mismatchedArrayLength = Object.entries(contract.expectedArrayLengths ?? {}).find(
			([field, expected]) => !Array.isArray(parsed[field]) || (parsed[field] as unknown[]).length !== expected,
		)?.[0];
		if (mismatchedArrayLength) {
			const expected = contract.expectedArrayLengths?.[mismatchedArrayLength];
			return {
				ok: false,
				errorMessage: `Agent json_object output array field ${mismatchedArrayLength} must contain exactly ${String(expected)} items`,
			};
		}
		for (const [arrayField, requiredFields] of Object.entries(contract.arrayItemRequiredStringFields ?? {})) {
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			for (let index = 0; index < items.length; index += 1) {
				const item = items[index];
				if (!isRecord(item)) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} must be an object` };
				const missing = requiredFields.find((field) => typeof item[field] !== "string" || !(item[field] as string).trim());
				if (missing) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} requires non-empty string field ${missing}` };
			}
		}
		for (const [arrayField, requiredFields] of Object.entries(contract.arrayItemRequiredStringArrayFields ?? {})) {
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			for (let index = 0; index < items.length; index += 1) {
				const item = items[index];
				if (!isRecord(item)) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} must be an object` };
				const missing = requiredFields.find((field) => {
					const fieldValue = item[field];
					return !Array.isArray(fieldValue)
						|| fieldValue.some((entry) => typeof entry !== "string" || !entry.trim());
				});
				if (missing) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} requires string array field ${missing}` };
			}
		}
		for (const [arrayField, requiredFields] of Object.entries(contract.arrayItemRequiredNonEmptyStringArrayFields ?? {})) {
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			for (let index = 0; index < items.length; index += 1) {
				const item = items[index];
				if (!isRecord(item)) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} must be an object` };
				const missing = requiredFields.find((field) => {
					const fieldValue = item[field];
					return !Array.isArray(fieldValue) || fieldValue.length === 0
						|| fieldValue.some((entry) => typeof entry !== "string" || !entry.trim());
				});
				if (missing) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} requires non-empty string array field ${missing}` };
			}
		}
		for (const [arrayField, allowedItemFields] of Object.entries(contract.arrayItemAllowedFields ?? {})) {
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			const allowedItemFieldSet = new Set(allowedItemFields);
			if (contract.contractName === BEAT_SHEET_ARTIFACT_CONTRACT_NAME && arrayField === "beats") {
				// The outward v16 wire contract is compact. Only this validator's
				// deterministic projection adds the legacy downstream field after raw
				// input has already been checked against the compact beat allow-list.
				allowedItemFieldSet.add("assetObjectContracts");
			}
			for (let index = 0; index < items.length; index += 1) {
				const item = items[index];
				if (!isRecord(item)) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} must be an object` };
				const unexpected = Object.keys(item).find((field) => !allowedItemFieldSet.has(field));
				if (unexpected) {
					return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} contains unexpected field ${unexpected}` };
				}
			}
		}
		for (const [arrayField, itemContracts] of Object.entries(contract.arrayItemExactNumberFields ?? {})) {
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			for (let index = 0; index < itemContracts.length; index += 1) {
				const item = items[index];
				if (!isRecord(item)) {
					return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} must be an object` };
				}
				const mismatchedNumber = Object.entries(itemContracts[index] ?? {}).find(
					([field, expected]) => item[field] !== expected,
				);
				if (mismatchedNumber) {
					const [field, expected] = mismatchedNumber;
					return {
						ok: false,
						errorMessage: `Agent json_object output ${arrayField} item ${index + 1} field ${field} must equal ${String(expected)}`,
					};
				}
			}
		}
		for (const [arrayField, fieldAllowedValues] of Object.entries(contract.arrayItemNumberAllowedValues ?? {})) {
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			for (let index = 0; index < items.length; index += 1) {
				const item = items[index];
				if (!isRecord(item)) {
					return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} must be an object` };
				}
				const mismatch = Object.entries(fieldAllowedValues).find(
					([field, allowedValues]) => typeof item[field] !== "number"
						|| !Number.isFinite(item[field] as number)
						|| !allowedValues.includes(item[field] as number),
				);
				if (mismatch) {
					const [field, allowedValues] = mismatch;
					return {
						ok: false,
						errorMessage: `Agent json_object output ${arrayField} item ${index + 1} field ${field} must use one of: ${allowedValues.join(",")}`,
					};
				}
			}
		}
		for (const [arrayField, itemContracts] of Object.entries(contract.arrayItemExactStringFields ?? {})) {
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			for (let index = 0; index < itemContracts.length; index += 1) {
				const item = items[index];
				if (!isRecord(item)) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} must be an object` };
				const mismatch = Object.entries(itemContracts[index] ?? {}).find(
					([field, expected]) => typeof item[field] !== "string" || (item[field] as string).trim() !== expected,
				);
				if (mismatch) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} field ${mismatch[0]} must exactly preserve the frozen string fact` };
			}
		}
		for (const [arrayField, itemContracts] of Object.entries(contract.arrayItemExactStringArrayFields ?? {})) {
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			for (let index = 0; index < itemContracts.length; index += 1) {
				const item = items[index];
				if (!isRecord(item)) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} must be an object` };
				const mismatch = Object.entries(itemContracts[index] ?? {}).find(([field, expected]) => {
					const actual = item[field];
					return !Array.isArray(actual) || actual.length !== expected.length
						|| actual.some((value, valueIndex) => typeof value !== "string" || value.trim() !== expected[valueIndex]);
				});
				if (mismatch) return { ok: false, errorMessage: `Agent json_object output ${arrayField} item ${index + 1} field ${mismatch[0]} must exactly preserve the frozen ordered identities` };
			}
		}
		// 顶层单数组形态下的资产精确声明校验（如 clip writer 的 clips[].assets）。
		// expected 已由调用方在运行时按输入端口冻结，这里做确定性集合比较。
		const exactAssetIds = contract.itemExactAssetIds && "expected" in contract.itemExactAssetIds
			? {
				declarationPaths: contract.itemExactAssetIds.declarationPaths,
				expected: contract.itemExactAssetIds.expected,
			}
			: null;
		if (exactAssetIds && contract.requiredArrayFields?.length === 1) {
			const arrayField = contract.requiredArrayFields[0];
			const items = Array.isArray(parsed[arrayField]) ? parsed[arrayField] as unknown[] : [];
			const mismatch = inspectDeclaredAssetIdsMatch(
				items,
				exactAssetIds.declarationPaths,
				exactAssetIds.expected,
			);
			if (mismatch) {
				return { ok: false, errorMessage: `Agent json_object output ${arrayField} asset declarations must exactly match the validated plan; ${mismatch}` };
			}
		}
		if (contract.contractName === VIDEO_WRITER_ARTIFACT_CONTRACT_NAME) {
			if (contract.contractVersion !== VIDEO_WRITER_ARTIFACT_CONTRACT_VERSION) {
				return { ok: false, errorMessage: `Agent json_object output uses unsupported ${contract.contractName} version ${contract.contractVersion ?? "missing"}` };
			}
			const artifactMismatch = inspectVideoWriterArtifact(parsed);
			if (artifactMismatch) return { ok: false, errorMessage: `Agent video writer artifact is invalid: ${artifactMismatch}` };
		}
		if (contract.contractName === BEAT_SHEET_ARTIFACT_CONTRACT_NAME) {
			if (contract.contractVersion !== BEAT_SHEET_ARTIFACT_CONTRACT_VERSION) {
				return { ok: false, errorMessage: `Agent json_object output uses unsupported ${contract.contractName} version ${contract.contractVersion ?? "missing"}` };
			}
			const executionBlocker = inspectBeatSheetExecutionBlocker(parsed);
			if (executionBlocker) {
				return { ok: false, errorMessage: `Agent BeatSheet artifact cannot be executed: ${executionBlocker}` };
			}
			const artifactMismatch = inspectBeatSheetArtifact(parsed);
			if (artifactMismatch) {
				diagnostics = [{
					code: "model_authored_consistency",
					message: artifactMismatch,
				}];
			}
		}
		return {
			ok: true,
			text: JSON.stringify(
				contract.contractName === BEAT_SHEET_ARTIFACT_CONTRACT_NAME
					? stripBeatSheetCompactObjectFields(parsed)
					: parsed,
			),
			...(diagnostics.length > 0 ? { diagnostics } : {}),
		};
	}
	if (input.encoding === "json_array") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawText);
		} catch {
			return {
				ok: false,
				errorMessage: "Agent json_array output must be one JSON array without Markdown fences or surrounding prose",
			};
		}
		const minimumArrayLength = input.jsonArrayContract?.minimumArrayLength ?? 1;
		if (!Array.isArray(parsed) || parsed.length < minimumArrayLength) {
			return {
				ok: false,
				errorMessage: minimumArrayLength === 0
					? "Agent json_array output must be one JSON array"
					: `Agent json_array output requires at least ${minimumArrayLength} item${minimumArrayLength === 1 ? "" : "s"}`,
			};
		}
		const contract = input.jsonArrayContract;
		if (contract?.expectedArrayLength !== undefined && parsed.length !== contract.expectedArrayLength) {
			return { ok: false, errorMessage: `Agent json_array output requires exactly ${contract.expectedArrayLength} items` };
		}
		const allowedFields = contract?.itemAllowedFields ? new Set(contract.itemAllowedFields) : null;
		for (let index = 0; index < parsed.length; index += 1) {
			const item = parsed[index];
			if (!contract || (
				!contract.itemRequiredStringFields
				&& !contract.itemStringFormats
				&& !contract.itemRequiredNumberFields
				&& !contract.itemRequiredNonEmptyArrayFields
				&& !contract.itemExactNumberFields
				&& !contract.itemStringAllowedValues
				&& !contract.itemStringArrayAllowedValues
				&& !contract.itemRequiredNonEmptyArrayFieldsByIdentity
				&& !contract.itemExactStringFieldsByIdentity
				&& !allowedFields
			)) continue;
			if (!isRecord(item)) return { ok: false, errorMessage: `Agent json_array item ${index + 1} must be an object` };
			const missingStringField = contract.itemRequiredStringFields?.find(
				(field) => typeof item[field] !== "string" || !(item[field] as string).trim(),
			);
			if (missingStringField) return { ok: false, errorMessage: `Agent json_array item ${index + 1} requires non-empty string field ${missingStringField}` };
			const invalidStringFormat = Object.entries(contract.itemStringFormats ?? {}).find(
				([field, format]) => typeof item[field] !== "string" || inspectStringFormat((item[field] as string).trim(), format) !== null,
			);
			if (invalidStringFormat) {
				const [field, format] = invalidStringFormat;
				const reason = typeof item[field] === "string"
					? inspectStringFormat((item[field] as string).trim(), format)
					: "must be a string";
				return { ok: false, errorMessage: `Agent json_array item ${index + 1} field ${field} ${reason}` };
			}
			const missingNumberField = contract.itemRequiredNumberFields?.find(
				(field) => typeof item[field] !== "number" || !Number.isFinite(item[field] as number),
			);
			if (missingNumberField) return { ok: false, errorMessage: `Agent json_array item ${index + 1} requires finite number field ${missingNumberField}` };
			const missingArrayField = contract.itemRequiredNonEmptyArrayFields?.find(
				(field) => !Array.isArray(item[field]) || (item[field] as unknown[]).length === 0,
			);
			if (missingArrayField) return { ok: false, errorMessage: `Agent json_array item ${index + 1} requires non-empty array field ${missingArrayField}` };
			const mismatchedNumberField = Object.entries(contract.itemExactNumberFields ?? {}).find(
				([field, expected]) => item[field] !== expected,
			)?.[0];
			if (mismatchedNumberField) return { ok: false, errorMessage: `Agent json_array item ${index + 1} has mismatched exact number field ${mismatchedNumberField}` };
			const mismatchedString = Object.entries(contract.itemStringAllowedValues ?? {}).find(
				([field, allowed]) => typeof item[field] !== "string" || !allowed.includes((item[field] as string).trim()),
			);
			if (mismatchedString) {
				const [field, allowed] = mismatchedString;
				return { ok: false, errorMessage: `Agent json_array item ${index + 1} field ${field} must use one of: ${allowed.join(",")}` };
			}
			const mismatchedStringArray = Object.entries(contract.itemStringArrayAllowedValues ?? {}).find(
				([field, allowed]) => !Array.isArray(item[field])
					|| (item[field] as unknown[]).length === 0
					|| (item[field] as unknown[]).some((value) => typeof value !== "string" || !allowed.includes(value.trim())),
			);
			if (mismatchedStringArray) {
				const [field, allowed] = mismatchedStringArray;
				return { ok: false, errorMessage: `Agent json_array item ${index + 1} field ${field} must be a non-empty string array using only: ${allowed.join(",")}` };
			}
			const exactByIdentity = contract.itemExactStringFieldsByIdentity;
			if (exactByIdentity) {
				const identity = typeof item[exactByIdentity.identityField] === "string"
					? (item[exactByIdentity.identityField] as string).trim()
					: "";
				const expectedFields = exactByIdentity.values[identity];
				if (expectedFields) {
					const mismatch = Object.entries(expectedFields).find(
						([field, expected]) => typeof item[field] !== "string" || (item[field] as string).trim() !== expected,
					)?.[0];
					if (mismatch) {
						return { ok: false, errorMessage: `Agent json_array item ${index + 1} identity ${identity} requires exact string field ${mismatch}` };
					}
				}
			}
			const requiredArraysByIdentity = contract.itemRequiredNonEmptyArrayFieldsByIdentity;
			if (requiredArraysByIdentity) {
				const identity = typeof item[requiredArraysByIdentity.identityField] === "string"
					? (item[requiredArraysByIdentity.identityField] as string).trim()
					: "";
				const requiredFieldsForIdentity = requiredArraysByIdentity.values[identity] ?? [];
				const missingConditionalArray = requiredFieldsForIdentity.find(
					(field) => !Array.isArray(item[field]) || (item[field] as unknown[]).length === 0,
				);
				if (missingConditionalArray) {
					return {
						ok: false,
						errorMessage: `Agent json_array item ${index + 1} identity ${identity} requires non-empty array field ${missingConditionalArray}`,
					};
				}
			}
			const unexpectedField = allowedFields ? Object.keys(item).find((field) => !allowedFields.has(field)) : undefined;
			if (unexpectedField) return { ok: false, errorMessage: `Agent json_array item ${index + 1} contains unexpected field ${unexpectedField}` };
		}
		return { ok: true, text: JSON.stringify(parsed) };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		return {
			ok: false,
			errorMessage: "Agent json_artifact output must be one JSON object without Markdown fences or surrounding prose",
		};
	}
	if (!isRecord(parsed)) {
		return { ok: false, errorMessage: "Agent json_artifact output must be a JSON object" };
	}
	const unexpectedField = Object.keys(parsed).find(
		(field) => field !== "artifactType" && field !== "text",
	);
	if (unexpectedField) {
		return {
			ok: false,
			errorMessage: `Agent json_artifact output contains unexpected field ${unexpectedField}`,
		};
	}
	const artifactType = typeof parsed.artifactType === "string" ? parsed.artifactType.trim() : "";
	if (artifactType !== input.artifactType) {
		return {
			ok: false,
			errorMessage: `Agent json_artifact output declared ${artifactType || "no artifactType"}; expected ${input.artifactType}`,
		};
	}
	const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
	if (!text) {
		return { ok: false, errorMessage: "Agent json_artifact output requires a non-empty text field" };
	}
	return { ok: true, text };
}

import { createHash } from "node:crypto";

import { parseAgentExecutionProvenance } from "../task/agent-execution-provenance";

export type VideoPromptAssemblySourceStatus = "applied" | "not_used" | "pending" | "unavailable";

export type VideoPromptAssemblySource = Readonly<{
	id: string;
	label: string;
	kind:
		| "user_contract"
		| "generation_contract"
		| "project_fact"
		| "clip_fact"
		| "skill"
		| "skill_reference"
		| "writer_output"
		| "compiler"
		| "asset_binding";
	ref: string;
	status: VideoPromptAssemblySourceStatus;
	summary: string;
}>;

export type VideoPromptAssemblyStep = Readonly<{
	id: string;
	order: number;
	title: string;
	explanation: string;
	sourceIds: readonly string[];
}>;

export type VideoPromptAssemblyDiagnostic = Readonly<{
	version: 2;
	artifactKey: string;
	clipIndex: number;
	state: "complete" | "partial" | "pending";
	assemblySummary: string;
	steps: readonly VideoPromptAssemblyStep[];
	sources: readonly VideoPromptAssemblySource[];
	contractSnapshot: Readonly<{
		sourceSpanText: string | null;
		dialogueScriptJson: string;
		temporalContextJson: string | null;
		sceneStateJson: string | null;
		characterStatesJson: string | null;
		characterStateVersionsJson: string | null;
		startKeyframe: string | null;
		endKeyframe: string | null;
		previousExitState: string | null;
		exitState: string | null;
		writerOutputJson: string | null;
	}>;
	finalPrompt: Readonly<{
		label: string;
		characterCount: number;
		text: string;
		hash: string | null;
	}> | null;
}>;

const WRITER_SKILL = "tapcanvas-video-prompt-writer";
const WRITER_SKILL_REF = "apps/agents-cli/skills/tapcanvas-video-prompt-writer/SKILL.md";
const WRITER_INPUT_REF = "WorkflowIR.clip-writer-agent.inputs.clip-contexts";
const EXECUTION_COMPILER_REF = "apps/hono-api/src/modules/task/video-orchestrator.clip-shots.ts#compileStructuredClipForExecution";

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
	if (!value) return null;
	try {
		return readRecord(JSON.parse(value));
	} catch {
		return null;
	}
}

function countNestedReferenceIds(contracts: readonly unknown[]): number {
	const ids = new Set<string>();
	for (const value of contracts) {
		const contract = readRecord(value);
		const references = Array.isArray(contract?.referenceImageNodeIds)
			? contract.referenceImageNodeIds
			: [];
		for (const reference of references) {
			const id = readString(reference);
			if (id) ids.add(id);
		}
	}
	return ids.size;
}

function countMeaningfulLeafValues(value: unknown): number {
	if (typeof value === "string") return value.trim() ? 1 : 0;
	if (typeof value === "number" || typeof value === "boolean") return 1;
	if (Array.isArray(value)) {
		return value.reduce((count, item) => count + countMeaningfulLeafValues(item), 0);
	}
	const record = readRecord(value);
	if (!record) return 0;
	return Object.values(record).reduce<number>(
		(count, item) => count + countMeaningfulLeafValues(item),
		0,
	);
}

function jsonOrNull(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	return JSON.stringify(value, null, 2);
}

export function buildVideoPromptAssemblyDiagnostic(input: {
	artifactKey: string;
	artifactStatus: string;
	beatSheetJson: string | null | undefined;
	artifactPayloadJson: string | null | undefined;
}): VideoPromptAssemblyDiagnostic | null {
	const beatSheet = parseJsonRecord(input.beatSheetJson);
	const payload = parseJsonRecord(input.artifactPayloadJson);
	const clipIndex = Number(payload?.clipIndex);
	if (!beatSheet || !payload || !Number.isInteger(clipIndex) || clipIndex < 0) return null;

	const meta = readRecord(beatSheet.meta);
	const userIntentContract = readRecord(meta?.userIntentContract);
	const generationContract = readRecord(meta?.generationContract);
	const filmBible = readRecord(beatSheet.filmBible);
	const adaptationStrategy = readRecord(beatSheet.adaptationStrategy);
	const filmBibleFactCount = countMeaningfulLeafValues(filmBible);
	const adaptationStrategyFactCount = countMeaningfulLeafValues(adaptationStrategy);
	const beats = Array.isArray(beatSheet.beats) ? beatSheet.beats : [];
	const beat = readRecord(beats[clipIndex]);
	const previousBeat = clipIndex > 0 ? readRecord(beats[clipIndex - 1]) : null;
	const clip = readRecord(payload.clip);
	const writerProvenance = parseAgentExecutionProvenance(payload.writerExecutionProvenance);
	const requiredSkills = new Set([
		...(writerProvenance?.requiredSkills ?? []),
		...(writerProvenance?.loadedSkills ?? []),
	]);
	const writerSkillLoaded = requiredSkills.has(WRITER_SKILL);
	const hasExactResourceEvidence = writerProvenance?.loadedSkillResources !== undefined;
	const loadedReferences = (writerProvenance?.loadedSkillResources ?? [])
		.filter((resource) => resource.skill === WRITER_SKILL);
	const shots = Array.isArray(clip?.shots) ? clip.shots : [];
	const assetContracts = Array.isArray(beat?.assetObjectContracts)
		? beat.assetObjectContracts
		: Array.isArray(clip?.assetObjectContracts)
			? clip.assetObjectContracts
			: [];
	const promptText = readString(clip?.clipPrompt);
	const temporalContext = readRecord(beat?.temporalContext);
	const sceneState = readRecord(beat?.sceneState);
	const characterStates = readRecord(beat?.characterStates);
	const characterStateVersions = readRecord(beat?.characterStateVersions);
	const dialogueScript = Array.isArray(beat?.dialogueScript) ? beat.dialogueScript : [];
	const sourceSpanText = readString(beat?.sourceSpanText);
	const temporalRelation = readString(temporalContext?.relationToPrevious);
	const inheritsPreviousPhysicalState = !temporalContext ||
		temporalRelation === "continuous" ||
		temporalRelation === "continue_memory";
	const writerOutput = clip
		? Object.fromEntries(Object.entries(clip).filter(([key]) => key !== "clipPrompt"))
		: null;
	const promptHash = promptText
		? `sha256:${createHash("sha256").update(promptText).digest("hex")}`
		: null;
	const durationSeconds = Number(beat?.durationBudget ?? clip?.durationSeconds);
	const durationLabel = Number.isFinite(durationSeconds) ? `${durationSeconds}s` : "时长未记录";
	const generationModel = readString(generationContract?.videoModel) || readString(meta?.videoModel);
	const durationOptions = Array.isArray(generationContract?.durationOptions)
		? generationContract.durationOptions.filter((value) => typeof value === "number" && Number.isFinite(value))
		: [];

	const sources: VideoPromptAssemblySource[] = [
		{
			id: "user-intent",
			label: "用户意图合同",
			kind: "user_contract",
			ref: "BeatSheet.meta.userIntentContract",
			status: userIntentContract ? "applied" : "unavailable",
			summary: userIntentContract
				? `已验签；contractHash=${readString(userIntentContract.contractHash) || "已记录"}`
				: "本次 BeatSheet 未记录 UserIntentContract。",
		},
		{
			id: "generation-contract",
			label: "视频生成合同",
			kind: "generation_contract",
			ref: "BeatSheet.meta.generationContract",
			status: generationContract ? "applied" : "unavailable",
			summary: generationContract
				? `${generationModel || "模型已冻结"}${durationOptions.length ? `；合法时长 ${durationOptions.join("/")}s` : ""}`
				: "未找到冻结的供应商与时长合同。",
		},
		{
			id: "film-bible",
			label: "全片导演与连续性圣经",
			kind: "project_fact",
			ref: "BeatSheet.filmBible",
			status: filmBibleFactCount > 0 ? "applied" : "unavailable",
			summary: filmBibleFactCount > 0
				? `已消费 ${filmBibleFactCount} 个非空事实值。`
				: "filmBible 未记录。",
		},
		{
			id: "adaptation-strategy",
			label: "章级改编策略",
			kind: "project_fact",
			ref: "BeatSheet.adaptationStrategy",
			status: adaptationStrategyFactCount > 0 ? "applied" : "unavailable",
			summary: adaptationStrategyFactCount > 0
				? `按当前 clip 职责消费 ${adaptationStrategyFactCount} 个非空事实值。`
				: "章级改编策略未记录。",
		},
		{
			id: "previous-exit",
			label: "上一 Clip 退出态",
			kind: "clip_fact",
			ref: clipIndex === 0 ? "BeatSheet.beats[0].arcContract" : `BeatSheet.beats[${clipIndex - 1}].exitState`,
			status: clipIndex === 0
				? "applied"
				: !inheritsPreviousPhysicalState
					? "not_used"
					: readString(previousBeat?.exitState) ? "applied" : "unavailable",
			summary: clipIndex === 0
				? "首个 clip 从自身 startKeyframe / arcContract 建立开场。"
				: !inheritsPreviousPhysicalState
					? `时间层关系=${temporalRelation}；不继承相邻 clip 的姿态、空间、光线或临时人物状态。`
				: readString(previousBeat?.exitState) || "上一 clip 未声明 exitState。",
		},
		{
			id: "temporal-context",
			label: "时间层与状态作用域",
			kind: "clip_fact",
			ref: `BeatSheet.beats[${clipIndex}].temporalContext`,
			status: temporalContext ? "applied" : "unavailable",
			summary: temporalContext
				? `${readString(temporalContext.presentation)}；timeline=${readString(temporalContext.timelineId)}；stateScope=${readString(temporalContext.stateScope)}；relation=${temporalRelation}`
				: "当前 clip 未记录时间层；无法证明现实、回忆、预知或平行段的状态隔离。",
		},
		{
			id: "scene-state",
			label: "子场景入口与退出",
			kind: "clip_fact",
			ref: `BeatSheet.beats[${clipIndex}].sceneState`,
			status: sceneState ? "applied" : "unavailable",
			summary: sceneState
				? `${readString(sceneState.subscene)}；${readString(sceneState.interiorExterior)}；${readString(sceneState.timeOfDay)}`
				: "当前 clip 未记录具体子场景、内外景、时段、光线与空间入口。",
		},
		{
			id: "character-state-versions",
			label: "可见人物状态版本",
			kind: "clip_fact",
			ref: `BeatSheet.beats[${clipIndex}].characterStateVersions`,
			status: characterStateVersions ? "applied" : "unavailable",
			summary: characterStateVersions
				? `${Object.keys(characterStateVersions).length} 名角色具有逐 clip 可见状态。`
				: "当前 clip 未记录身体、妆造、伤势、孕态、污损或持有物的可见状态版本。",
		},
		{
			id: "current-beat",
			label: `Clip ${clipIndex} 冻结事实`,
			kind: "clip_fact",
			ref: `BeatSheet.beats[${clipIndex}]`,
			status: beat ? "applied" : "unavailable",
			summary: beat
				? `${durationLabel}；角色 ${Array.isArray(beat.characterRoleNames) ? beat.characterRoleNames.length : 0}；资产合同 ${assetContracts.length}。`
				: "当前 clip 在 BeatSheet 中不存在。",
		},
		{
			id: "writer-fact-envelope",
			label: "Workflow IR 冻结事实信封",
			kind: "compiler",
			ref: WRITER_INPUT_REF,
			status: "applied",
			summary: "只传当前 Clip 的冻结事实与机器输出协议；创作方法由 writer Skill 独占。",
		},
		{
			id: "writer-skill",
			label: "视频提示词 Writer Skill",
			kind: "skill",
			ref: WRITER_SKILL_REF,
			status: writerProvenance ? writerSkillLoaded ? "applied" : "unavailable" : "pending",
			summary: writerProvenance
				? writerSkillLoaded
					? `executionId=${writerProvenance.executionId}；model=${writerProvenance.model}`
					: "本轮 provenance 未证明加载 writer Skill。"
				: "等待 writer executionProvenance。",
		},
		...(loadedReferences.length > 0
			? loadedReferences.map((resource, index): VideoPromptAssemblySource => ({
				id: `writer-reference-${index + 1}`,
				label: "本轮领域 Reference",
				kind: "skill_reference",
				ref: `apps/agents-cli/skills/${resource.skill}/${resource.resource}`,
				status: "applied",
				summary: "由 writer 基于结构化 clip 事实自主选择并实际读取。",
			}))
			: [{
				id: "writer-reference-none",
				label: "本轮领域 Reference",
				kind: "skill_reference" as const,
				ref: `${WRITER_SKILL_REF}#领域-reference-按需加载`,
				status: !writerProvenance
					? "pending" as const
					: hasExactResourceEvidence
						? "not_used" as const
						: "unavailable" as const,
				summary: !writerProvenance
					? "等待 writer 回传实际 reference 读取记录。"
					: hasExactResourceEvidence
						? "本轮没有实际加载额外 reference；以 Skill 主合同为方法来源。"
						: "该历史运行早于精确 reference 收据，无法证明是否读取过额外文档。",
			}]),
		{
			id: "writer-output",
			label: "Writer 结构化 Shots",
			kind: "writer_output",
			ref: `authoring_artifacts.${input.artifactKey}.payload.clip.shots`,
			status: clip ? "applied" : input.artifactStatus === "running" ? "pending" : "unavailable",
			summary: clip ? `${shots.length} 个 shots；由 writer 首稿冻结。` : "尚未取得可冻结的结构化 clip。",
		},
		{
			id: "execution-compiler",
			label: "执行提示词编译器",
			kind: "compiler",
			ref: EXECUTION_COMPILER_REF,
			status: promptText ? "applied" : input.artifactStatus === "running" ? "pending" : "unavailable",
			summary: "只把结构化 shots 投影为视觉、对白、声音、连续性和退出态；不补写创作语义。",
		},
		{
			id: "asset-binding",
			label: "参考资产绑定",
			kind: "asset_binding",
			ref: `BeatSheet.beats[${clipIndex}].assetObjectContracts`,
			status: assetContracts.length > 0 ? "applied" : "not_used",
			summary: assetContracts.length > 0
				? `${assetContracts.length} 个 canonical 资产合同；${countNestedReferenceIds(assetContracts)} 个引用节点。最终 @图N 仅在供应商 content[] 冻结后绑定。`
				: "本 clip 没有声明视觉参考资产。",
		},
	];

	const referenceSourceIds = sources
		.filter((source) => source.kind === "skill_reference")
		.map((source) => source.id);
	const steps: VideoPromptAssemblyStep[] = [
		{
			id: "lock-contracts",
			order: 1,
			title: "锁定用户要求与视频生成边界",
			explanation: "用户 must / forbid / prefer 先于创作方法；模型、协议和合法时长来自冻结生成合同。",
			sourceIds: ["user-intent", "generation-contract"],
		},
		{
			id: "collect-facts",
			order: 2,
			title: "收集全片与当前 Clip 的真实事实",
			explanation: "全片圣经、章级策略、上一段退出态和当前 beat 共同形成 writer 的事实边界。",
			sourceIds: ["film-bible", "adaptation-strategy", "previous-exit", "temporal-context", "scene-state", "character-state-versions", "current-beat", "writer-fact-envelope"],
		},
		{
			id: "author-shots",
			order: 3,
			title: "Writer 自主设计结构化 Shots",
			explanation: "Writer 使用主 Skill；仅在确有领域需要时读取一份 reference，并在同一执行链完成镜头、动作、表演和声音设计。",
			sourceIds: ["writer-skill", ...referenceSourceIds],
		},
		{
			id: "freeze-output",
			order: 4,
			title: "冻结 Writer 的结构化产物",
			explanation: "服务端只校验 JSON 形状、clip 身份和确定性合同；shots 是创作真源。",
			sourceIds: ["writer-output"],
		},
		{
			id: "render-prompt",
			order: 5,
			title: "确定性渲染视频执行提示词",
			explanation: "编译器把 shots 渲染成最终阅读顺序，不用本地规则改写 writer 的创作判断。",
			sourceIds: ["execution-compiler"],
		},
		{
			id: "bind-assets",
			order: 6,
			title: "在提交边界绑定真实参考资产",
			explanation: "Writer 只写 canonical 资产名；真实 @图N 由最终 content[] 顺序决定，避免预估图序。",
			sourceIds: ["asset-binding"],
		},
	];

	const hasUnavailableSource = sources.some((source) => source.status === "unavailable");
	const state = input.artifactStatus === "running" || input.artifactStatus === "pending"
		? "pending"
		: promptText && writerProvenance && !hasUnavailableSource
			? "complete"
			: "partial";
	return {
		version: 2,
		artifactKey: input.artifactKey,
		clipIndex,
		state,
		assemblySummary: "用户合同 → 生成合同 → 全片/Clip 事实 → Writer Skill/Reference → 结构化 Shots → 确定性渲染 → 真实资产绑定",
		steps,
		sources,
		contractSnapshot: {
			sourceSpanText: sourceSpanText || null,
			dialogueScriptJson: JSON.stringify(dialogueScript, null, 2),
			temporalContextJson: jsonOrNull(temporalContext),
			sceneStateJson: jsonOrNull(sceneState),
			characterStatesJson: jsonOrNull(characterStates),
			characterStateVersionsJson: jsonOrNull(characterStateVersions),
			startKeyframe: readString(beat?.startKeyframe) || null,
			endKeyframe: readString(beat?.endKeyframe) || null,
			previousExitState: readString(previousBeat?.exitState) || null,
			exitState: readString(beat?.exitState) || null,
			writerOutputJson: jsonOrNull(writerOutput),
		},
		finalPrompt: promptText
			? {
				label: "结构化 Shots 的执行提示词投影（供应商 @图N 在最终提交边界绑定）",
				characterCount: promptText.length,
				text: promptText,
				hash: promptHash,
			}
			: null,
	};
}

import {
	CHAPTER_SCRIPT_PROTOCOL_VERSION,
	chapterScriptSchema,
	type AuthoredChapterSequence,
	type ChapterScript,
	type ChapterScriptBeat,
	type ChapterScriptScene,
	type ChapterScriptMemoryVoice,
	type ChapterSequenceAdaptationSpan,
	type ChapterSequenceSourceRange,
} from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import { isPerformanceMode, PERFORMANCE_MODES } from "../../../../../packages/schemas/performance-routing/index.mjs";
import type { WorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";
import { projectAuthoredSceneStaging, type AuthoredSceneStaging } from "./execution.chapter-script-staging";
import { retentionCatalog, type CatalogUnit } from "./execution.chapter-retention";
import { frozenChapterSources, type ChapterSequenceFrozenSource } from "./execution.chapter-sequence.contract";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { compileChapterScriptSequence, type PlannedChapterScriptBeat } from "./execution.chapter-script-projection";
import { parseWorkflowVideoDeliveryDurationPlan } from "./execution.video-workflow-contract";

/** Authors own ordered content and explicit clip grouping; models own shot and speech pacing. */
type JsonRecord = Record<string, unknown>;
type DurationPlan = ReturnType<typeof parseWorkflowVideoDeliveryDurationPlan>;
const MIN_ANCHOR_VOICED = 2;
const PREVIEW_CHARS = 40;

function record(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function preview(text: string, length = PREVIEW_CHARS): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length > length ? `${compact.slice(0, length)}…` : compact;
}

/** Structural anchor length; never used to infer speech timing or creative meaning. */
function anchorCharacterCount(text: string): number {
	return [...text].filter((character) => !/[\p{P}\p{S}\p{Z}\s]/u.test(character)).length;
}

// ---------------------------------------------------------------- contract

/** Describe frozen user and provider duration facts. */
function describeWindowPlan(plan: DurationPlan): string {
	const topology = plan.providerSubmissionTopology;
	const fixed = topology?.source === "user_clip_durations"
		? `供应商片段依次固定为 ${JSON.stringify(topology.minimumClipDurations)} 秒。`
		: `每个供应商片段 clips[].durationSeconds 必须选 [${plan.durationOptions.join(", ")}] 秒；这是整个执行片段的时长。`;
	const total = plan.targetDurationSeconds !== null ? `用户交付总时长为 ${plan.targetDurationSeconds} 秒，所有片段时长之和必须等于它。` : "用户未指定总时长，作者根据内容自主划分片段数量。";
	const count = topology?.source === "user_clip_count" ? `片段数量固定为 ${topology.expectedClipCount}。`
		: topology?.source === "model_max_duration" ? `供应商上限要求至少 ${topology.expectedClipCount} 个片段。` : "";
	return `${fixed}${total}${count}片段内镜头与发声节奏由视频模型适配，稿件不分配拍内时钟。`;
}

/** Bind the chapter author to the script protocol: ordered content and explicit provider clip ownership with frozen provider facts. */
export function bindChapterScriptAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
	deliveryContract: unknown,
): WorkflowAgentJsonObjectContract {
	const sources = frozenChapterSources(deliveryContract);
	const plan = parseWorkflowVideoDeliveryDurationPlan(deliveryContract);
	const schema = structuredClone(chapterScriptSchema) as JsonRecord;
	const properties = schema.properties as JsonRecord;
	const authoringRecord = properties.authoringRecord as JsonRecord;
	const sourceIds = (authoringRecord.properties as JsonRecord).sourceIds as JsonRecord;
	sourceIds.items = { ...(sourceIds.items as JsonRecord), enum: sources.map((source) => source.sourceId) };
	const sourceChars = sources.reduce((total, source) => total + source.content.length, 0);
	const catalog = retentionCatalog(sources);
	schema.description = [
		`冻结来源共 ${sources.length} 份、${sourceChars} 字。adaptation.until 是来源原文的结束锚点，按来源顺序绑定范围；decision 记录作者的改编取舍。`,
		"scenes 与 root clips 按播放顺序排列；scenes[].adapts 引用 adaptation.spanId，每拍 clipId 与可选 memoryVoice.clipId 引用所属 clips。",
		"layout、positions、moves 与 memoryVoice 可选；已声明的空间与人声事实会投影到下游。",
		describeWindowPlan(plan),
		"speech.says 可引用原文编号（如 U12），宿主逐字填入并保留来源身份；shows 与 conveys 记录来源引用。引用编号必须存在。",
		`原文编号（${catalog.length} 句，按原文顺序）：\n${catalog.map((unit) => `${unit.id}｜${unit.text}`).join("\n")}`,
	].join("\n");
	// The author writes no constant: the host stamps the protocol, so no exact string is pinned.
	const { exactStringFields: _inheritedExactStrings, ...base } = contract;
	return {
		...base,
		jsonSchema: schema,
		contractName: "tapcanvas.chapter-script",
		contractVersion: "3",
		requiredStringFields: ["wholeFilmIntent"],
		requiredNumberFields: [],
		requiredObjectFields: [],
		requiredArrayFields: ["adaptation", "scenes", "clips"],
		expectedArrayLengths: {},
		arrayItemExactNumberFields: {},
		arrayItemNumberAllowedValues: {},
		allowedFields: ["wholeFilmIntent", "sourceKind", "characters", "adaptation", "scenes", "clips", "authoringRecord"],
	};
}

// ---------------------------------------------------------------- adaptation

type ResolvedSpan = ChapterSequenceAdaptationSpan & Readonly<{ index: number }>;

const QUOTE_EDGES = /^[\s“”"'‘’「」『』《》（）()]+|[\s“”"'‘’「」『』《》（）()]+$/gu;

function anchorCandidates(until: string): string[] {
	const raw = until.trim();
	const stripped = raw.replace(QUOTE_EDGES, "");
	const candidates = [raw, stripped];
	// A slightly misremembered start still ends the span where the author meant:
	// fall back to ever shorter verbatim endings of the anchor.
	for (let length = stripped.length - 1; length > 0; length -= 1) {
		const suffix = stripped.slice(stripped.length - length);
		if (anchorCharacterCount(suffix) < MIN_ANCHOR_VOICED + 2) break;
		candidates.push(suffix);
	}
	return [...new Set(candidates.filter((candidate) => anchorCharacterCount(candidate) >= MIN_ANCHOR_VOICED))];
}

function paragraphEnd(content: string, from: number): number {
	const newline = content.indexOf("\n", from);
	let end = newline < 0 ? content.length : newline;
	while (end < content.length && /\s/u.test(content[end]!)) end += 1;
	return end;
}

function isBlank(text: string): boolean {
	return text.trim().length === 0;
}

/**
 * Partition the frozen sources into the author's ordered spans, aligned to paragraph ends.
 * Source identities and ranges remain deterministic; creative extent is author owned.
 */
export function resolveAdaptationSpans(
	adaptation: ChapterScript["adaptation"],
	sources: readonly ChapterSequenceFrozenSource[],
): readonly ResolvedSpan[] {
	let sourceIndex = 0;
	let offset = 0;
	const advancePastBlankSource = () => {
		while (sourceIndex < sources.length - 1 && isBlank(sources[sourceIndex]!.content.slice(offset))) {
			sourceIndex += 1;
			offset = 0;
		}
	};
	const spanIds = new Set<string>();
	const resolved = adaptation.map((span, index): ResolvedSpan => {
		if (!nonEmpty(span.spanId) || spanIds.has(span.spanId)) {
			throw new Error(`adaptation[${index}].spanId must be a unique non-empty id`);
		}
		if (!["dramatize", "condense", "cut"].includes(span.decision)) {
			throw new Error(`adaptation[${index}].decision must be dramatize, condense or cut`);
		}
		spanIds.add(span.spanId);
		advancePastBlankSource();
		const source = sources[sourceIndex]!;
		const remainder = source.content.slice(offset);
		if (isBlank(remainder)) {
			throw new Error(`adaptation[${index}] (${span.spanId}) starts after the end of every frozen source; remove it or merge it into the previous span`);
		}
		let matchEnd = -1;
		for (const candidate of anchorCandidates(span.until)) {
			const found = source.content.indexOf(candidate, offset);
			if (found >= 0) {
				matchEnd = found + candidate.length;
				break;
			}
		}
		if (matchEnd < 0) {
			throw new Error(`adaptation[${index}] (${span.spanId}).until ${JSON.stringify(preview(span.until))} is not verbatim source text after the previous span. `
				+ `The next unassigned source text starts with ${JSON.stringify(preview(remainder))}; copy the exact ending of this span's last sentence, and keep spans in source order (one source at a time).`);
		}
		const end = paragraphEnd(source.content, matchEnd);
		const range: ChapterSequenceSourceRange = {
			sourceIndex, startOffset: offset, endOffset: end, sourceId: source.sourceId, sourceFingerprint: source.sourceFingerprint,
		};
		offset = end;
		return { index, spanId: span.spanId, decision: span.decision, note: span.note, sourceRanges: [range] };
	});
	return resolved;
}

/** The frozen sources cut to the text the spans adapt: whole sources before the last span's, then its prefix. */
export function adaptedSources(
	spans: readonly ResolvedSpan[],
	sources: readonly ChapterSequenceFrozenSource[],
): readonly ChapterSequenceFrozenSource[] {
	const last = spans.at(-1)?.sourceRanges.at(-1);
	if (!last) return [];
	return sources.slice(0, last.sourceIndex + 1).map((source, index) => (
		index === last.sourceIndex ? { ...source, content: source.content.slice(0, last.endOffset) } : source
	));
}

/**
 * Resolve the author's references to the numbered source: a line with unit gets
 * the unit's exact text as a source_quote; shows records narration a beat acts and
 * conveys narration an authored line says in a character's words. The author never
 * copies prose, so the source cannot be miscopied or silently lost.
 */
/**
 * Resolve every beat's source unit references. Each wrong reference is reported with the
 * rest of the script's problems, so one revision fixes them all instead of one per round.
 */
function resolveSourceUnits(
	scenes: readonly ChapterScriptScene[],
	catalog: readonly CatalogUnit[],
	violations: ScriptViolations,
): readonly ChapterScriptScene[] {
	const byId = new Map(catalog.map((unit) => [unit.id, unit]));
	const resolved = scenes.map((scene, sceneIndex) => ({ ...scene, beats: (Array.isArray(scene.beats) ? scene.beats : []).map((raw, beatIndex) => {
		const beat = raw as ChapterScriptBeat & { unit?: unknown; shows?: unknown; conveys?: unknown };
		const label = beatLabel(scene.sceneId, sceneIndex, beatIndex);
		let next: ChapterScriptBeat = beat;
		if (beat.unit !== undefined) {
			const unit = typeof beat.unit === "string" ? byId.get(beat.unit) : undefined;
			if (!unit) {
				violations.add(`${label}.unit ${JSON.stringify(beat.unit)} is not a source unit; use an id from the numbered source (U1…U${catalog.length})`);
			} else {
				if (beat.kind !== "line") violations.add(`${label}.unit belongs on a line beat that says the sentence verbatim; an action or reaction beat plays narration with shows`);
				next = { ...beat, text: unit.text, textOrigin: "source_quote" } as ChapterScriptBeat;
			}
		}
		const narrationRefs = (field: "shows" | "conveys", ids: unknown) => {
			if (!Array.isArray(ids)) {
				violations.add(`${label}.${field} must list source unit ids`);
				return;
			}
			for (const id of ids) {
				const unit = typeof id === "string" ? byId.get(id) : undefined;
				if (!unit) {
					violations.add(`${label}.${field} names ${JSON.stringify(id)}, which is not a source unit`);
					continue;
				}
			}
		};
		if (beat.shows !== undefined) narrationRefs("shows", beat.shows);
		if (beat.conveys !== undefined) {
			narrationRefs("conveys", beat.conveys);
		}
		return next;
	}) }));
	return resolved;
}

// ---------------------------------------------------------------- beats

function beatLabel(sceneId: string, sceneIndex: number, beatIndex: number): string {
	return `scenes[${sceneIndex}] (${sceneId}).beats[${beatIndex}]`;
}

function planBeat(beat: ChapterScriptBeat, sceneId: string, sceneIndex: number, beatIndex: number): PlannedChapterScriptBeat {
	const label = beatLabel(sceneId, sceneIndex, beatIndex);
	if (!record(beat) || !nonEmpty(beat.text)) throw new Error(`${label}.text must describe the beat`);
	if (!isPerformanceMode(beat.performance)) {
		throw new Error(`${label}.performance must be one of ${PERFORMANCE_MODES.join(", ")}: the kind of performance this beat is, which decides the methods its Clip author receives`);
	}
	if (!nonEmpty(beat.clipId)) throw new Error(`${label}.clipId must name an authored provider clip`);
	if (beat.kind === "line") {
		if (!nonEmpty(beat.speaker) || !nonEmpty(beat.delivery) || !nonEmpty(beat.visual) || (beat.textOrigin !== "authored" && beat.textOrigin !== "source_quote")) {
			throw new Error(`${label} is a line: speaker, delivery, visual and textOrigin (authored or source_quote) are required`);
		}
		if (beat.voice !== "onscreen" && beat.voice !== "inner" && beat.voice !== "offscreen" && beat.voice !== "narration") {
			throw new Error(`${label}.voice must be onscreen (a visible character speaks), inner (inner monologue heard as voice-over), offscreen (the speaker is not in frame) or narration (the narrator reads the source's narration)`);
		}

	} else if (beat.kind !== "action" && beat.kind !== "reaction") {
		throw new Error(`${label}.kind must be action, reaction or line`);
	}
	return { sceneIndex, beatIndex, beat, onScreen: [], moves: [], staging: null };
}

const SOURCE_UNIT_ID = /^U[1-9][0-9]*$/;

/** Keep only the declared fields of the author's free-form notes; extra annotations are not part of the record. */
function readAuthoringRecord(value: unknown): unknown {
	if (!record(value)) return value;
	const actions = Array.isArray(value.actions)
		? value.actions.map((action) => record(action) ? { action: action.action, reason: action.reason, result: action.result } : action)
		: value.actions;
	return { ...value, actions };
}

/** A floor plan's spots carry mark/where/at only; any extra annotation on a spot is dropped. */
function readScriptLayout(value: unknown): unknown {
	if (!record(value) || !Array.isArray(value.marks)) return value;
	return { ...value, marks: value.marks.map((mark) => record(mark) ? { mark: mark.mark, where: mark.where, at: mark.at } : mark) };
}

/**
 * The author writes what each beat shows and, separately, who speaks; the host derives
 * the internal line/action beat. A speech's says is a numbered source sentence said
 * verbatim or the authored words, so no beat can be half a line.
 */
function readAuthoredBeat(value: unknown): unknown {
	if (!record(value)) return value;
	const { picture, speech, ...rest } = value;
	if (!record(speech)) return { ...rest, kind: "action", text: picture };
	const says = typeof speech.says === "string" ? speech.says.trim() : speech.says;
	const words = typeof says === "string" && SOURCE_UNIT_ID.test(says)
		? { unit: says }
		: { text: says, textOrigin: "authored" };
	return {
		...rest,
		kind: "line",
		visual: picture,
		speaker: speech.speaker,
		voice: speech.voice,
		delivery: speech.delivery,
		...words,
		...(speech.conveys === undefined ? {} : { conveys: speech.conveys }),
	};
}

function readMemoryVoice(value: unknown): ChapterScriptMemoryVoice | undefined {
	if (!record(value)) return undefined;
	const says = typeof value.says === "string" ? value.says.trim() : value.says;
	return { clipId: value.clipId, speaker: value.speaker, voice: value.voice, delivery: value.delivery,
		...(typeof says === "string" && SOURCE_UNIT_ID.test(says) ? { unit: says, text: "", textOrigin: "source_quote" } : { text: says, textOrigin: "authored" }),
		...(value.conveys === undefined ? {} : { conveys: value.conveys }) } as ChapterScriptMemoryVoice;
}

/** The author's chapter script carries no protocol stamp; the host owns it and the internal beat shape. */
export function readAuthoredChapterScript(value: unknown): ChapterScript {
	if (!record(value)) throw new Error("chapter script must be a JSON object");
	const issues = validateWorkflowToolArguments(chapterScriptSchema, value);
	if (issues.length > 0) throw new Error(`chapter script: ${issues.map((issue) => issue.message).join(" | ")}`);
	if (!Array.isArray(value.adaptation) || !Array.isArray(value.scenes)) {
		throw new Error("chapter script requires adaptation spans and at least one scene");
	}
	const scenes = Array.isArray(value.scenes)
		? value.scenes.map((scene) => {
			if (!record(scene)) return scene;
			const { memoryVoice, ...rest } = scene;
			return {
				...rest,
				...(record(memoryVoice) ? { timeLayer: "memory", memoryVoice: readMemoryVoice(memoryVoice) } : {}),
				...(scene.layout === undefined ? {} : { layout: readScriptLayout(scene.layout) }),
				beats: Array.isArray(scene.beats) ? scene.beats.map(readAuthoredBeat) : scene.beats,
			};
		})
		: value.scenes;
	return {
		...value,
		...(value.authoringRecord === undefined ? {} : { authoringRecord: readAuthoringRecord(value.authoringRecord) }),
		scenes,
		protocolVersion: CHAPTER_SCRIPT_PROTOCOL_VERSION,
	} as unknown as ChapterScript;
}

/**
 * Compile an authored chapter script into the ordered chapter-sequence/v4 content
 * consumed downstream. Only the current explicit clip grouping contract is accepted.
 */
/** Aggregate deterministic source-reference and protocol errors for same-chain repair. */
class ScriptViolations {
	private readonly messages: string[] = [];

	/** Run a check that produces a value; on a violation record it and fall back. */
	attempt<T>(run: () => T, fallback: T): T {
		try {
			return run();
		} catch (error) {
			this.messages.push(error instanceof Error ? error.message : String(error));
			return fallback;
		}
	}

	add(message: string): void {
		this.messages.push(message);
	}

	throwIfAny(): void {
		const messages = [...new Set(this.messages)];
		if (messages.length === 0) return;
		if (messages.length === 1) throw new Error(messages[0]);
		throw new Error(`${messages.length} independent problems in this script; fix all of them in one revision, each with its own instructions below, and keep everything else unchanged.\n${messages.map((message, index) => `[${index + 1}] ${message}`).join("\n")}`);
	}
}

export function compileChapterScript(authored: unknown, deliveryContract: unknown): AuthoredChapterSequence {
	const sources = frozenChapterSources(deliveryContract);
	const input = readAuthoredChapterScript(authored);
	const plan = parseWorkflowVideoDeliveryDurationPlan(deliveryContract);
	// Opening deliveries number only their adapted source extent.
	const openingOnly = plan.sourceExtent === "opening";
	const spans = resolveAdaptationSpans(input.adaptation, sources);
	const catalog = retentionCatalog(openingOnly ? adaptedSources(spans, sources) : sources);
	if (!Array.isArray(input.scenes)) throw new Error("chapter script requires adaptation spans and at least one scene");
	const violations = new ScriptViolations();
	const resolvedScenes = resolveSourceUnits(input.scenes, catalog, violations);
	const value: ChapterScript = { ...input, scenes: resolvedScenes };
	const spanById = new Map(spans.map((span) => [span.spanId, span]));
	const sceneIds = new Set<string>();
	const planned: PlannedChapterScriptBeat[] = [];
	if (!Array.isArray(value.adaptation) || !Array.isArray(value.scenes) || value.scenes.length === 0) {
		throw new Error("chapter script requires adaptation spans and at least one scene");
	}
	let placeState: Readonly<{ place: string; sceneId: string; staging: AuthoredSceneStaging }> | null = null;
	const sceneLedger: AuthoredSceneStaging[] = [];
	const sceneRanges = value.scenes.map((scene: ChapterScriptScene, sceneIndex: number) => {
		if (!nonEmpty(scene.sceneId) || sceneIds.has(scene.sceneId)) throw new Error(`scenes[${sceneIndex}].sceneId must be a unique non-empty id`);
		if (!Array.isArray(scene.beats) || scene.beats.length === 0) throw new Error(`scenes[${sceneIndex}] (${scene.sceneId}) must contain at least one beat`);
		if (!Array.isArray(scene.adapts) || scene.adapts.length === 0) throw new Error(`scenes[${sceneIndex}] (${scene.sceneId}).adapts must name the spans it adapts`);
		sceneIds.add(scene.sceneId);
		const ranges = scene.adapts.flatMap((spanId: string) => {
			const span = spanById.get(spanId);
			if (!span) throw new Error(`scenes[${sceneIndex}] (${scene.sceneId}).adapts names unknown span ${spanId}`);
			return span.sourceRanges;
		});
		// Presence and staging are the author's facts: the scene's cast and opening
		// positions, then each beat's entrances, moves and exits.
		const present = (Array.isArray(scene.cast) ? scene.cast : []).map((name: string) => name.trim()).filter(Boolean);
		const place = typeof scene.place === "string" ? scene.place.trim() : "";
		const memory = scene.timeLayer === "memory";
		const previous = !memory && place && scene.timeSkip !== true && placeState?.place === place ? placeState : null;
		const staging = projectAuthoredSceneStaging(scene, previous?.staging ?? null);
		sceneLedger.push({ ...staging, positions: new Map(staging.positions) });
		scene.beats.forEach((beat: ChapterScriptBeat, beatIndex: number) => {
			// Who the picture shows is the author's declaration; someone shown who was not on
			// screen enters on this beat — the beat the door opens on them.
			const declaredVisible = Array.isArray((beat as { visible?: unknown }).visible)
				? ((beat as unknown as { visible: unknown[] }).visible).filter((name): name is string => typeof name === "string").map((name) => name.trim())
				: [];
			const entering = [...new Set([...(beat.enters ?? []), ...declaredVisible].map((name) => name.trim()))]
				.filter((name) => name && !present.includes(name));
			present.push(...entering);
			const onScreen = [...present];
			const moves = beat.moves ?? [];
			for (const move of moves) staging.positions.set(move.who, move);
			for (const name of (beat.exits ?? []).map((value) => value.trim())) {
				const index = present.indexOf(name);
				if (index >= 0) present.splice(index, 1);
				staging.positions.delete(name);
			}
			// A malformed beat is reported with the rest; the beats that plan still feed the later checks.
			const plannedBeat = violations.attempt<PlannedChapterScriptBeat | null>(() => planBeat(beat, scene.sceneId, sceneIndex, beatIndex), null);
			if (plannedBeat) {
				planned.push({ ...plannedBeat, onScreen, moves, staging: staging.positions.size > 0 ? [...staging.positions.values()] : null });
			}
		});
		if (!memory) placeState = { place, sceneId: scene.sceneId, staging };
		return [...ranges].sort((left, right) => left.sourceIndex - right.sourceIndex || left.startOffset - right.startOffset);
	});
	if (value.sourceKind !== "narrative" && value.sourceKind !== "brief") {
		violations.add("sourceKind must be narrative or brief");
	}
	violations.throwIfAny();
	return compileChapterScriptSequence({ value, planned, plan, deliveryContract, sources, sceneRanges, sceneLedger, catalog, adaptation: spans.map(({ index: _index, ...span }) => span) });
}

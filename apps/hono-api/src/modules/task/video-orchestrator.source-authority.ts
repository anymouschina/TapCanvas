import { createHash } from "node:crypto";
import { BeatSheetPreflightError } from "./video-orchestrator.beat-sheet-preflight";
import {
	resilientDraftExpire,
	resilientDraftGet,
	resilientDraftSet,
} from "./video-orchestrator.resilient-draft-store";

const SOURCE_AUTHORITY_TTL_SECONDS = 24 * 60 * 60;
const SOURCE_AUTHORITY_KEY_PREFIX = "video:beat-sheet-source:v1:";

export type BeatSheetSourceAuthority = Readonly<{
	version: 1;
	ownerId: string;
	runId: string;
	kind: "chapter" | "canvas_text_node" | "agent_api_job" | "public_chat_turn";
	sourceId: string;
	text: string;
	fingerprint: string;
	capturedAt: string;
}>;

type BeatSheetSourceNode = Readonly<{
	id: string;
	data?: Record<string, unknown>;
}>;

export type ResolvedBeatSheetCanvasSource = Readonly<{
	nodeId: string;
	kind: "chapter" | "canvas_text_node";
	sourceId: string;
	text: string;
	selection: "server_canonical_chapter_seed" | "explicit_canvas_text_node";
	ignoredRequestedSourceNodeId: string | null;
}>;

const sourceAuthorityKey = (ownerId: string, runId: string): string =>
	`${SOURCE_AUTHORITY_KEY_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(runId)}`;

const readRequiredString = (value: unknown): string =>
	typeof value === "string" ? value.trim() : "";

function readSourceNodeText(node: BeatSheetSourceNode): string {
	const data = node.data && typeof node.data === "object" && !Array.isArray(node.data)
		? node.data
		: {};
	const kind = readRequiredString(data.kind);
	if (kind !== "text") {
		throw new Error(
			`beat_sheet_source_node_kind_invalid: sourceNodeId=${node.id} 必须是 kind=text`,
		);
	}
	const text = [data.content, data.chapterText, data.prompt]
		.map(readRequiredString)
		.find(Boolean) ?? "";
	if (!text) {
		throw new Error(`beat_sheet_source_node_empty: sourceNodeId=${node.id} 的正文为空`);
	}
	return text;
}

/**
 * Resolve the narrative source at the execution boundary instead of allowing
 * the root model to choose among canvas text cards.
 *
 * ChapterService owns exactly one canonical narrative projection:
 * `chapter-seed-<chapterId>`. Derived scripts and old preview cards remain
 * visible assets, but can never replace that seed for a complete-film run.
 * Free-form canvases preserve the legacy explicit-node contract because they
 * have no server-owned chapter seed.
 */
export function resolveBeatSheetCanvasSource(input: Readonly<{
	flowId: string;
	chapterId?: string | null;
	requestedSourceNodeId?: string | null;
	nodes: readonly BeatSheetSourceNode[];
}>): ResolvedBeatSheetCanvasSource {
	const flowId = readRequiredString(input.flowId);
	const chapterId = readRequiredString(input.chapterId);
	const requestedSourceNodeId = readRequiredString(input.requestedSourceNodeId);
	if (chapterId) {
		const canonicalNodeId = `chapter-seed-${chapterId}`;
		const canonicalNode = input.nodes.find((node) => node.id === canonicalNodeId);
		if (!canonicalNode) {
			throw new Error(
				`beat_sheet_canonical_chapter_source_missing: sourceNodeId=${canonicalNodeId}`,
			);
		}
		return {
			nodeId: canonicalNodeId,
			kind: "chapter",
			sourceId: chapterId,
			text: readSourceNodeText(canonicalNode),
			selection: "server_canonical_chapter_seed",
			ignoredRequestedSourceNodeId:
				requestedSourceNodeId && requestedSourceNodeId !== canonicalNodeId
					? requestedSourceNodeId
					: null,
		};
	}

	if (!requestedSourceNodeId) {
		throw new Error(
			"beat_sheet_source_node_required: 独立画布 preflight_begin 必须显式提交当前 flow 的非空文本节点 sourceNodeId",
		);
	}
	const sourceNode = input.nodes.find((node) => node.id === requestedSourceNodeId);
	if (!sourceNode) {
		throw new Error(`beat_sheet_source_node_not_found: sourceNodeId=${requestedSourceNodeId}`);
	}
	return {
		nodeId: requestedSourceNodeId,
		kind: "canvas_text_node",
		sourceId: `${flowId}:${requestedSourceNodeId}`,
		text: readSourceNodeText(sourceNode),
		selection: "explicit_canvas_text_node",
		ignoredRequestedSourceNodeId: null,
	};
}

export function buildBeatSheetSourceFingerprint(input: {
	kind: BeatSheetSourceAuthority["kind"];
	sourceId: string;
	text: string;
}): string {
	return createHash("sha256")
		.update(JSON.stringify({
			kind: input.kind,
			sourceId: input.sourceId,
			text: input.text,
		}))
		.digest("hex");
}

function parseBeatSheetSourceAuthority(raw: string): BeatSheetSourceAuthority {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			"BeatSheet source authority 不是合法 JSON。",
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			"BeatSheet source authority 不是对象。",
		);
	}
	const record = parsed as Record<string, unknown>;
	const kind = record.kind === "chapter" ||
		record.kind === "canvas_text_node" ||
		record.kind === "agent_api_job" ||
		record.kind === "public_chat_turn"
		? record.kind
		: null;
	const ownerId = readRequiredString(record.ownerId);
	const runId = readRequiredString(record.runId);
	const sourceId = readRequiredString(record.sourceId);
	const text = readRequiredString(record.text);
	const fingerprint = readRequiredString(record.fingerprint);
	const capturedAt = readRequiredString(record.capturedAt);
	if (
		record.version !== 1 ||
		!kind ||
		!ownerId ||
		!runId ||
		!sourceId ||
		!text ||
		!fingerprint ||
		!capturedAt ||
		fingerprint !== buildBeatSheetSourceFingerprint({ kind, sourceId, text })
	) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			"BeatSheet source authority 字段或内容指纹无效。",
		);
	}
	return {
		version: 1,
		ownerId,
		runId,
		kind,
		sourceId,
		text,
		fingerprint,
		capturedAt,
	};
}

/**
 * Freezes one explicit source for the full durable authoring run. The binding
 * is idempotent for identical content and rejects source drift instead of
 * silently switching chapters or canvas nodes during a resumed physical run.
 */
export async function bindBeatSheetSourceAuthority(input: {
	ownerId: string;
	runId: string;
	kind: BeatSheetSourceAuthority["kind"];
	sourceId: string;
	text: string;
}): Promise<BeatSheetSourceAuthority> {
	const ownerId = input.ownerId.trim();
	const runId = input.runId.trim();
	const sourceId = input.sourceId.trim();
	const text = input.text.trim();
	if (!ownerId || !runId || !sourceId || !text) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			"BeatSheet source authority 缺少 ownerId、runId、sourceId 或非空文本。",
		);
	}
	const fingerprint = buildBeatSheetSourceFingerprint({
		kind: input.kind,
		sourceId,
		text,
	});
	const key = sourceAuthorityKey(ownerId, runId);
	const existingRaw = await resilientDraftGet(key, SOURCE_AUTHORITY_TTL_SECONDS);
	if (existingRaw) {
		const existing = parseBeatSheetSourceAuthority(existingRaw);
		if (
			existing.ownerId !== ownerId ||
			existing.runId !== runId ||
			existing.fingerprint !== fingerprint
		) {
			throw new BeatSheetPreflightError(
				"beat_sheet_preflight_invalid",
				`BeatSheet runId=${runId} 已冻结另一份 source authority，禁止在续跑中切换来源。`,
			);
		}
		await resilientDraftExpire(key, SOURCE_AUTHORITY_TTL_SECONDS);
		return existing;
	}
	const authority: BeatSheetSourceAuthority = {
		version: 1,
		ownerId,
		runId,
		kind: input.kind,
		sourceId,
		text,
		fingerprint,
		capturedAt: new Date().toISOString(),
	};
	await resilientDraftSet(key, JSON.stringify(authority), SOURCE_AUTHORITY_TTL_SECONDS);
	return authority;
}

export async function readBeatSheetSourceAuthority(
	ownerId: string,
	runId: string,
): Promise<BeatSheetSourceAuthority> {
	const key = sourceAuthorityKey(ownerId, runId);
	const raw = await resilientDraftGet(key, SOURCE_AUTHORITY_TTL_SECONDS);
	if (!raw) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_not_found",
			`runId「${runId}」没有冻结的 BeatSheet source authority。`,
		);
	}
	const authority = parseBeatSheetSourceAuthority(raw);
	if (authority.ownerId !== ownerId || authority.runId !== runId) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			"BeatSheet source authority 的持久作用域与请求不一致。",
		);
	}
	await resilientDraftExpire(key, SOURCE_AUTHORITY_TTL_SECONDS);
	return authority;
}

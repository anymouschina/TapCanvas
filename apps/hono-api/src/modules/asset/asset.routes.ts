import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
	AiCharacterLibraryCharacterDto,
	CharacterBible,
	AiCharacterLibrarySyncStateDto,
	AiCharacterLibraryUpsertPayload,
} from "../../../../packages/schemas/character-bible-protocol";
import type { AppContext, AppEnv } from "../../types";
import {
	authMiddleware,
	resolveAuth,
	tryGetUserDbAuthState,
} from "../../middleware/auth";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { extractPosterViaMediaWorker } from "../../platform/media-worker/client";
import {
	CreateAssetSchema,
	FinishProjectBookUploadSchema,
	getUtf8TextByteLength,
	IngestProjectBookSchema,
	IngestProjectMaterialSchema,
	PublicAssetSchema,
	RenameAssetSchema,
	ServerAssetSchema,
	StartProjectBookUploadSchema,
	TEXT_UPLOAD_MAX_BYTES,
	TEXT_UPLOAD_MAX_LABEL,
	UpdateAssetDataSchema,
} from "./asset.schemas";
import {
	createAssetRow,
	getAssetByIdForUser,
	getGlobalAssetByName,
	deleteAssetRow,
	deleteBookPointerAssetsForUser,
	listAssetsForUser,
	listAssetsForUserByKind,
	listPublicAssets,
	renameAssetRow,
	updateAssetDataRow, listPublishRecordAssets, listProjectsTvInfo } from "./asset.repo";
import { sanitizeHomepageDecoration } from "./homepage-decoration";
import { getProjectForOwner } from "../project/project.repo";
import { touchProjectActivity } from "../project/project-activity.repo";
import { upsertChaptersFromBook } from "../chapter/chapter.repo";
import { resolveLocalDevRole } from "../auth/local-admin";
import { runAgentsBridgeChatTask } from "../task/task.agents-bridge";
import { STORYBOARD_GOVERNANCE_MODEL_KEY } from "../agents/agents.model-keys";
import { resolvePublicAssetBaseUrl } from "./asset.publicBase";
import { registerGeneratedMediaAsset } from "./asset.hosting";
import { createObjectStorageClient, resolveObjectStorageConfig } from "./rustfs.client";
import { persistStoryboardChunkMemory } from "../memory/memory.service";
import {
	LOCAL_ASSET_ROUTE_PREFIX,
	LocalAssetRangeError,
	readLocalAsset,
	resolveLocalAssetStorageConfig,
} from "./local-asset-storage";
import { isStalledBookUploadJob } from "./book-upload-job-state";
import {
	resolveBookMetadataAgentExecutionMode,
	resolveBookMetadataTargetChapterNumbers,
} from "./book-metadata-agent-mode";
import {
	requireStoryboardV12ArtifactPayload,
	type StoryboardPersistenceHandoffEvidence,
} from "../storyboard/storyboard-persistence-contract";
import {
	type StoryboardStructuredData,
} from "../storyboard/storyboard-structure";
import {
	sanitizeBookFieldText,
	sanitizeImportedBookText,
} from "./book-text-sanitizer";
import { resolveProjectDataRepoRoot } from "./project-data-root";
import {
	BookIndexStoreError,
	readBookIndex,
	replaceBookIndex,
	updateBookIndex,
	type BookIndexRecord,
} from "./book-index-store";
import { mergeDerivedBookIndex } from "./book-index-derived-merge";
import { AppError } from "../../middleware/error";
import {
	normalizePublicFlowAnchorBindings,
	type PublicFlowAnchorBinding,
} from "../flow/flow.anchor-bindings";
import {
	BookStyleBibleNotReadyError,
	confirmBookStyleBible,
} from "./book-style-bible";
import {
	BookEvidenceError,
	buildBookEvidenceIndex,
	writeBookEvidenceIndex,
} from "./book-evidence-index";
import {
	BookSourceParseError,
	isSupportedBookSourceFileName,
	parseBookSource,
	requireBookSourceMetadataV1,
	storedBookSourceFileName,
	type BookSourceMetadataV1,
} from "./book-source-parser";
import {
	BookUploadSessionLockError,
	withBookUploadSessionLock,
} from "./book-upload-session-lock";
import { writeBookUploadMetadataAtomically } from "./book-upload-metadata-store";
import {
	calculateRanking,
	filterHomepageModeratedAssets,
	getHomepageVideoModerationConfig,
	getHomepageVideoRankingConfig,
} from "../ranking/ranking-control";

export const assetRouter = new Hono<AppEnv>();

const BOOK_UPLOAD_CHUNK_DIR = ".uploads";
const BOOK_UPLOAD_CHUNK_MAX_BYTES = 2 * 1024 * 1024;

type BookUploadSessionMeta = {
	id: string;
	userId: string;
	projectId: string;
	title: string;
	sourceFileName: string;
	tmpPath: string;
	bytes: number;
	contentBytes: number;
	finalizedJobId?: string;
	createdAt: string;
	updatedAt: string;
};

type BookUploadJobStatus = "queued" | "running" | "succeeded" | "failed";
type BookReconfirmJobStatus = "queued" | "running" | "succeeded" | "failed";

type BookUploadJobMeta = {
	id: string;
	uploadId: string;
	userId: string;
	projectId: string;
	title: string;
	strictAgents: boolean;
	status: BookUploadJobStatus;
	progress?: {
		phase: string;
		percent: number;
		message?: string;
		totalChapters?: number;
		processedChapters?: number;
	};
	result?: {
		ok: true;
		bookId: string;
		title: string;
		chapterCount: number;
		processedBy: string;
		warnings: string[];
	};
	error?: { code: string; message: string; details?: unknown } | null;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	finishedAt?: string;
};

type BookReconfirmJobMeta = {
	id: string;
	bookId: string;
	userId: string;
	projectId: string;
	title: string;
	mode: BookDerivationMode;
	strictAgents: boolean;
	status: BookReconfirmJobStatus;
	progress?: {
		phase: string;
		percent: number;
		message?: string;
		totalChapters?: number;
		processedChapters?: number;
	};
	result?: {
		ok: true;
		bookId: string;
		title: string;
		chapterCount: number;
		processedBy: string;
		warnings: string[];
	};
	error?: { code: string; message: string; details?: unknown } | null;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	finishedAt?: string;
};

const bookUploadWorkerState: {
	running: boolean;
	queue: Array<{
		jobId: string;
		userId: string;
		projectId: string;
		env: AppContext["env"];
		requestUrl: string;
		authorization?: string;
		apiKey?: string;
	}>;
} = {
	running: false,
	queue: [],
};

const bookReconfirmWorkerState: {
	running: boolean;
	queue: Array<{
		jobId: string;
		userId: string;
		bookId: string;
		projectId: string;
		env: AppContext["env"];
		requestUrl: string;
		authorization?: string;
		apiKey?: string;
	}>;
} = {
	running: false,
	queue: [],
};

const bookDerivationQueueState: {
	active: number;
	waiters: Array<() => void>;
} = {
	active: 0,
	waiters: [],
};

const bookMetadataEnsureWindowLocks = new Set<string>();
const bookMetadataEnsureWindowProgress = new Map<
	string,
	{
		startedAt: string;
		updatedAt: string;
		phase: string;
		bookId: string;
		projectId: string;
		chapter: number;
		mode: BookDerivationMode;
		windowStart: number;
		windowEnd: number;
		windowSize: number;
		metadataUpdated: boolean;
		missingBeforeCount: number;
		metadataTargetChapters: number;
		totalBatches?: number;
		completedBatches?: number;
		processedChapters?: number;
		totalChapters?: number;
		activeBatch?: number;
		lastBatchElapsedMs?: number;
	}
>();

function readNodeEnvInt(
	key: string,
	fallback: number,
	options?: { min?: number; max?: number },
): number {
	const raw =
		typeof (globalThis as any)?.process?.env?.[key] === "string"
			? String((globalThis as any).process.env[key]).trim()
			: "";
	const value = Number(raw || fallback);
	const safe = Number.isFinite(value) ? Math.trunc(value) : fallback;
	const min = Number.isFinite(options?.min as number) ? Math.trunc(options!.min as number) : safe;
	const max = Number.isFinite(options?.max as number) ? Math.trunc(options!.max as number) : safe;
	return Math.max(min, Math.min(max, safe));
}

function readBookDerivationQueueConcurrency(): number {
	return readNodeEnvInt("BOOK_DERIVATION_QUEUE_CONCURRENCY", 2, { min: 1, max: 4 });
}

function readBookDerivationQueueMaxWaitMs(): number {
	return readNodeEnvInt("BOOK_DERIVATION_QUEUE_MAX_WAIT_MS", 900_000, {
		min: 5_000,
		max: 3_600_000,
	});
}

function readBookUploadJobStaleAfterMs(): number {
	return readNodeEnvInt("BOOK_UPLOAD_JOB_STALE_AFTER_MS", 120_000, {
		min: 15_000,
		max: 3_600_000,
	});
}

async function runBookDerivationQueued<T>(task: () => Promise<T>): Promise<T> {
	const concurrency = readBookDerivationQueueConcurrency();
	if (bookDerivationQueueState.active >= concurrency) {
		const maxWaitMs = readBookDerivationQueueMaxWaitMs();
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const wake = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve();
			};
			bookDerivationQueueState.waiters.push(wake);
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				const idx = bookDerivationQueueState.waiters.indexOf(wake);
				if (idx >= 0) bookDerivationQueueState.waiters.splice(idx, 1);
				reject(
					new Error(
						`book derivation queue wait timeout after ${maxWaitMs}ms`,
					),
				);
			}, maxWaitMs);
		});
	}
	bookDerivationQueueState.active += 1;
	try {
		return await task();
	} finally {
		bookDerivationQueueState.active = Math.max(0, bookDerivationQueueState.active - 1);
		const wake = bookDerivationQueueState.waiters.shift();
		if (wake) wake();
	}
}

function normalizeContentType(raw: string | null | undefined): string {
	const ct = typeof raw === "string" ? raw : "";
	return (ct.split(";")[0] || "").trim().toLowerCase() || "application/octet-stream";
}

function sanitizeUploadName(raw: unknown): string {
	if (typeof raw !== "string") return "";
	return raw
		.trim()
		.slice(0, 160)
		.replace(/[\u0000-\u001F\u007F]/g, "")
		.replace(/[\\/]/g, "_");
}

function buildTextUploadTooLargePayload(contentBytes?: number): {
	error: string;
	code: "TEXT_UPLOAD_TOO_LARGE";
	maxBytes: number;
	contentBytes?: number;
} {
	return {
		error: `文本上传内容过大，最大允许 ${TEXT_UPLOAD_MAX_LABEL}`,
		code: "TEXT_UPLOAD_TOO_LARGE",
		maxBytes: TEXT_UPLOAD_MAX_BYTES,
		...(typeof contentBytes === "number" && Number.isFinite(contentBytes)
			? { contentBytes: Math.max(0, Math.trunc(contentBytes)) }
			: {}),
	};
}

function extractTextUploadContentFromAssetData(data: unknown): string | null {
	if (!data || typeof data !== "object") return null;
	const record = data as Record<string, unknown>;
	const kind = typeof record.kind === "string" ? record.kind.trim() : "";
	if (kind !== "novelDoc" && kind !== "scriptDoc" && kind !== "storyboardScript") {
		return null;
	}
	return typeof record.content === "string" ? record.content : null;
}

function normalizeOptionalText(raw: unknown, maxLen: number): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (!Number.isFinite(maxLen) || maxLen <= 0) return trimmed;
	return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function detectUploadExtensionFromMeta(options: {
	contentType: string;
	fileName?: string;
}): string {
	const name = options.fileName || "";
	const contentType = normalizeContentType(options.contentType);
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
		"audio/mpeg": "mp3",
		"audio/mp3": "mp3",
		"audio/mp4": "m4a",
		"audio/aac": "aac",
		"audio/wav": "wav",
		"audio/x-wav": "wav",
		"audio/ogg": "ogg",
		"audio/flac": "flac",
	};
	if (contentType && known[contentType]) return known[contentType];
	if (name) {
		const match = name.match(/\.([a-zA-Z0-9]+)$/);
		if (match && match[1]) return match[1].toLowerCase();
	}
	if (contentType.startsWith("image/")) {
		return contentType.slice("image/".length) || "png";
	}
	if (contentType.startsWith("audio/")) {
		return contentType.slice("audio/".length) || "mp3";
	}
	return "bin";
}

async function canViewAllTapShowAssets(c: AppContext): Promise<boolean> {
	const resolved = await resolveAuth(c);
	if (!resolved?.payload?.sub) return false;

	const dbState = await tryGetUserDbAuthState(c.env.DB, resolved.payload.sub);
	if (dbState?.deletedAt || dbState?.disabled) return false;

	const role = resolveLocalDevRole(c, dbState?.role ?? resolved.payload.role);
	return role === "admin";
}

function inferMediaKind(options: {
	contentType: string;
	fileName?: string;
}): "image" | "video" | "audio" | null {
	const contentType = normalizeContentType(options.contentType);
	if (contentType.startsWith("image/")) return "image";
	if (contentType.startsWith("video/")) return "video";
	if (contentType.startsWith("audio/")) return "audio";
	const name = options.fileName || "";
	const ext = (name.split(".").pop() || "").toLowerCase();
	if (!ext) return null;
	if (["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(ext)) return "image";
	if (["mp4", "webm", "mov"].includes(ext)) return "video";
	if (["mp3", "m4a", "aac", "wav", "ogg", "flac"].includes(ext)) return "audio";
	return null;
}

type HttpByteRange =
	| { suffix: number }
	| { offset: number; length?: number };

function parseHttpByteRangeHeader(header: string): HttpByteRange | null {
	const raw = typeof header === "string" ? header.trim() : "";
	if (!raw) return null;
	const match = raw.match(/^bytes=(.+)$/i);
	if (!match || !match[1]) return null;

	// Only support a single range: `bytes=start-end` / `bytes=start-` / `bytes=-suffix`
	const spec = match[1].split(",")[0]?.trim() || "";
	if (!spec) return null;
	const [startStr, endStr] = spec.split("-");
	if (typeof endStr === "undefined") return null;

	if (!startStr) {
		const suffix = Number(endStr);
		if (!Number.isFinite(suffix) || suffix <= 0) return null;
		return { suffix: Math.floor(suffix) };
	}

	const start = Number(startStr);
	if (!Number.isFinite(start) || start < 0) return null;
	if (!endStr) return { offset: Math.floor(start) };

	const end = Number(endStr);
	if (!Number.isFinite(end) || end < start) return null;
	return { offset: Math.floor(start), length: Math.floor(end - start + 1) };
}

function toHttpRangeHeader(range: HttpByteRange | null): string | null {
	if (!range) return null;
	if ("suffix" in range) return `bytes=-${range.suffix}`;
	if (typeof range.offset === "number" && typeof range.length === "number") {
		const end = range.offset + range.length - 1;
		return `bytes=${range.offset}-${end}`;
	}
	if (typeof range.offset === "number") {
		return `bytes=${range.offset}-`;
	}
	return null;
}
async function readStreamToBytes(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<Uint8Array> {
	if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				try {
					await reader.cancel();
				} catch {
					// ignore
				}
				throw new Error("file is too large");
			}
			chunks.push(value);
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function isNodeRuntime(): boolean {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const processRef = (globalThis as any)?.process;
	return !!processRef?.versions?.node;
}

function sanitizePathSegment(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 120);
}

function extractFirstJsonObject(text: string): any | null {
	const raw = String(text || "").trim();
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		// ignore
	}
	const block = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
	const candidate = block?.[1] || raw;
	try {
		return JSON.parse(candidate);
	} catch {
		return null;
	}
}

type MaterialChapter = { chapter: number; title: string; content: string };
type BookChapterMeta = {
	chapter: number;
	title: string;
	startLine: number;
	endLine: number;
	startOffset: number;
	endOffset: number;
	length: number;
	summary?: string;
	keywords?: string[];
	characters?: Array<{ name: string; description?: string }>;
	props?: BookChapterPropMeta[];
	scenes?: Array<{ name: string; description?: string }>;
	locations?: Array<{ name: string; description?: string }>;
	coreConflict?: string;
};

type BookPropNarrativeImportance = "critical" | "supporting" | "background";
type BookPropVisualNeed = "must_render" | "shared_scene_only" | "mention_only";
type BookPropFunctionTag =
	| "plot_trigger"
	| "combat"
	| "threat"
	| "identity_marker"
	| "continuity_anchor"
	| "transaction"
	| "environment_clutter";

type BookChapterPropMeta = {
	name: string;
	description?: string;
	narrativeImportance?: BookPropNarrativeImportance;
	visualNeed?: BookPropVisualNeed;
	functionTags?: BookPropFunctionTag[];
	reusableAssetPreferred?: boolean;
	independentlyFramable?: boolean;
};
type BookCharacterStageForm = {
	stage: string;
	look?: string;
	costume?: string;
	props?: string[];
	emotion?: string;
	chapterHints?: number[];
};
type BookCharacterProfile = {
	name: string;
	description?: string;
	importance?: "main" | "supporting" | "minor";
	firstChapter?: number;
	lastChapter?: number;
	chapterSpan?: number[];
	stageForms?: BookCharacterStageForm[];
};
type BookCharacterGraphNode = {
	id: string;
	name: string;
	importance?: "main" | "supporting" | "minor";
	firstChapter?: number;
	lastChapter?: number;
	chapterSpan?: number[];
	unlockChapter?: number;
};
type BookCharacterGraphEdge = {
	sourceId: string;
	targetId: string;
	relation:
		| "coappear"
		| "family"
		| "parent_child"
		| "siblings"
		| "mentor_disciple"
		| "alliance"
		| "friend"
		| "lover"
		| "rival"
		| "enemy"
		| "colleague"
		| "master_servant"
		| "betrayal"
		| "conflict";
	weight: number;
	chapterHints: number[];
	directed?: boolean;
};
type BookCharacterGraph = {
	nodes: BookCharacterGraphNode[];
	edges: BookCharacterGraphEdge[];
};
type BookStyleBible = {
	styleId: string;
	styleName: string;
	styleLocked: boolean;
	mainCharacterCardsConfirmedAt?: string | null;
	mainCharacterCardsConfirmedBy?: string | null;
	confirmedAt?: string | null;
	confirmedBy?: string | null;
	visualDirectives: string[];
	negativeDirectives: string[];
	consistencyRules: string[];
	referenceImages?: string[];
};

const STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION = "storyboard_reference_v2";

type StoryboardReferenceCardKind = "single_character" | "group_cast";

type StoryboardReferenceVisualKind = "scene_prop_grid" | "spell_fx";

type AssetConfirmationMode = "auto" | "manual";

type BookRoleCardRecord = {
	cardId: string;
	characterBibleId?: string;
	roleId?: string;
	roleName: string;
	referenceKind?: StoryboardReferenceCardKind;
	promptSchemaVersion?: string;
	generatedFrom?: string;
	stateDescription?: string;
	stateKey?: string;
	ageDescription?: string;
	stateLabel?: string;
	healthStatus?: string;
	injuryStatus?: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
	nodeId?: string;
	prompt?: string;
	status: "draft" | "generated";
	modelKey?: string;
	imageUrl?: string;
	threeViewImageUrl?: string;
	confirmationMode?: AssetConfirmationMode | null;
	confirmedAt?: string | null;
	confirmedBy?: string | null;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
	updatedBy: string;
};

type BookCharacterBibleRecord = CharacterBible & {
	roleCardId?: string;
};

function findCharacterBibleForRoleCard(input: {
	characterBibles: BookCharacterBibleRecord[];
	characterBibleId?: string | null;
	roleName?: string | null;
	roleId?: string | null;
}): BookCharacterBibleRecord | null {
	const requestedId = String(input.characterBibleId || "").trim();
	if (requestedId) {
		return input.characterBibles.find((item) => item.id === requestedId) || null;
	}
	const roleName = String(input.roleName || "").trim().toLowerCase();
	const roleId = String(input.roleId || "").trim().toLowerCase();
	if (!roleName && !roleId) return null;
	const matches = input.characterBibles.filter((item) => {
		const bibleName = String(item.name || "").trim().toLowerCase();
		const sourceCharacterId = String(item.sourceCharacterId || "").trim().toLowerCase();
		if (roleId && sourceCharacterId && roleId === sourceCharacterId) return true;
		return !!roleName && !!bibleName && roleName === bibleName;
	});
	return matches.length === 1 ? matches[0]! : null;
}
type BookVisualRefRecord = {
	refId: string;
	category: "scene_prop" | "spell_fx";
	name: string;
	referenceKind?: StoryboardReferenceVisualKind;
	promptSchemaVersion?: string;
	generatedFrom?: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
	tags?: string[];
	stateDescription?: string;
	stateKey?: string;
	nodeId?: string;
	prompt?: string;
	status: "draft" | "generated";
	modelKey?: string;
	imageUrl?: string;
	confirmationMode?: AssetConfirmationMode | null;
	confirmedAt?: string | null;
	confirmedBy?: string | null;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
	updatedBy: string;
};
type BookSemanticAssetMediaKind = "image" | "video";

type BookSemanticAssetRecord = {
	semanticId: string;
	mediaKind: BookSemanticAssetMediaKind;
	status: "draft" | "generated";
	nodeId?: string;
	nodeKind?: string;
	taskId?: string;
	planId?: string;
	chunkId?: string;
	imageUrl?: string;
	videoUrl?: string;
	thumbnailUrl?: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
	shotNo?: number;
	stateDescription?: string;
	prompt?: string;
	anchorBindings?: PublicFlowAnchorBinding[];
	productionLayer?: string;
	creationStage?: string;
	approvalStatus?: string;
	confirmationMode?: AssetConfirmationMode | null;
	confirmedAt?: string | null;
	confirmedBy?: string | null;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
	updatedBy: string;
};
type BookRawTextChunkRecord = {
	chunkId: string;
	chunkIndex: number;
	filePath: string;
	sizeBytes: number;
	startOffset: number;
	endOffset: number;
	startChapter: number;
	endChapter: number;
	title: string;
	createdAt: string;
	updatedAt: string;
};
type BookStoryboardPlanRecord = {
	planId: string;
	taskId: string;
	chapter?: number;
	taskTitle?: string;
	mode: "single" | "full";
	groupSize: 1 | 4 | 9 | 25;
	outputAssetId?: string;
	runId?: string;
	storyboardContent?: string;
	storyboardArtifact: Record<string, unknown>;
	artifactSha256: string;
	storyboardStructured: StoryboardStructuredData;
	/** Opaque compatibility metadata from records written before the artifact-only cutover. */
	semanticReview?: unknown;
	shotPrompts: string[];
	nextChunkIndexByGroup?: {
		"1"?: number;
		"4"?: number;
		"9"?: number;
		"25"?: number;
	};
	createdAt: string;
	updatedAt: string;
	createdBy: string;
	updatedBy: string;
};
type BookStoryboardChunkRecord = {
	chunkId: string;
	planId: string;
	previousChunkId?: string;
	taskId: string;
	chapter?: number;
	groupSize: 1 | 4 | 9 | 25;
	chunkIndex: number;
	shotStart: number;
	shotEnd: number;
	nodeId?: string;
	prompt?: string;
	storyboardArtifact: Record<string, unknown>;
	artifactSha256: string;
	storyboardStructured: StoryboardStructuredData;
	/** Opaque compatibility metadata from records written before the artifact-only cutover. */
	semanticReview?: unknown;
	handoffEvidence?: StoryboardPersistenceHandoffEvidence;
	shotPrompts: string[];
	frameUrls: string[];
	tailFrameUrl: string;
	roleCardRefIds?: string[];
	scenePropRefId?: string;
	scenePropRefLabel?: string;
	spellFxRefId?: string;
	spellFxRefLabel?: string;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
	updatedBy: string;
};

function normalizeStoryboardHandoffEvidence(
	value: unknown,
): StoryboardPersistenceHandoffEvidence | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const previousExitState = String(record.previousExitState || "").trim();
	const currentEntryState = String(record.currentEntryState || "").trim();
	if (!previousExitState || !currentEntryState || previousExitState !== currentEntryState) return null;
	const parsePoint = (point: unknown) => {
		if (point === null) return null;
		if (!point || typeof point !== "object" || Array.isArray(point)) return undefined;
		const pointRecord = point as Record<string, unknown>;
		const chapter = Number(pointRecord.chapter);
		const sequence = Number(pointRecord.sequence);
		if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(sequence) || sequence < 0) {
			return undefined;
		}
		const label = typeof pointRecord.label === "string" ? pointRecord.label.trim() : "";
		return { chapter, sequence, ...(label ? { label } : null) };
	};
	const previousEffectiveAt = parsePoint(record.previousEffectiveAt);
	const currentEffectiveAt = parsePoint(record.currentEffectiveAt);
	if (previousEffectiveAt === undefined || currentEffectiveAt === undefined) return null;
	return {
		previousExitState,
		currentEntryState,
		previousEffectiveAt,
		currentEffectiveAt,
	};
}
type BookDerivationMode = "standard" | "deep";
type StoryboardGroupSize = 1 | 4 | 9 | 25;
const STORYBOARD_NEXT_BATCH_SIZE = 25 as const;

function normalizeStoryboardGroupSize(value: unknown): StoryboardGroupSize {
	const raw = Number(value);
	if (raw === 1) return 1;
	if (raw === 25) return 25;
	if (raw === 9) return 9;
	if (raw === 4) return 4;
	return STORYBOARD_NEXT_BATCH_SIZE;
}

function normalizeOptionalPositiveChapter(value: unknown): number | null {
	const raw = Number(value);
	return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
}

function inferStoryboardChapterFromTaskId(taskId: string): number | null {
	const normalizedTaskId = String(taskId || "").trim();
	if (!normalizedTaskId) return null;
	const chapterMatch =
		normalizedTaskId.match(/(?:^|[^a-z0-9])chapter-(\d+)(?:[^a-z0-9]|$)/i) ||
		normalizedTaskId.match(/(?:^|[^a-z0-9])ch(\d+)(?:[^a-z0-9]|$)/i);
	if (!chapterMatch) return null;
	return normalizeOptionalPositiveChapter(chapterMatch[1]);
}

function getStoryboardFallbackChapterShotCap(): number {
	return readNodeEnvInt("STORYBOARD_FALLBACK_CHAPTER_SHOT_CAP", 200, { min: 25, max: 5000 });
}

// 行首允许 Markdown 风格装饰（如 "###第1章"、"## 第十章"）——网文导出件常带 # 前缀，
// 不吃掉它会导致整本书探测 0 章、落进「全书一章」兜底。
const CHAPTER_HEADING_LINE_RE =
	/^\s*(?:[#＃]{1,6}\s*)?(?:正文\s*)?(?:(第\s*[0-9０-９一二三四五六七八九十百千零〇两IVXLCDMivxlcdm]+\s*(?:卷|部|篇|章|回|节|集|话|話|幕)(?:\s*[-:：.、·\)]?\s*[^\r\n]{0,80})?)|((?:chapter|chap\.?|episode|ep\.?)\s*[0-9ivxlcdm]+(?:\s*[-:：.、]\s*[^\r\n]{0,80})?)|((?:prologue|epilogue|序章|楔子|终章|尾声)\s*[^\r\n]{0,80}))\s*$/i;

const CHINESE_NUM_MAP: Record<string, number> = {
	零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
	六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 千: 1000,
};

function parseChapterNumber(title: string): number | null {
	// Arabic/full-width digits: 第30章, 第３０章
	const arabicM = title.match(/第\s*([0-9０-９]+)\s*[卷部篇章回节集话話幕]/);
	if (arabicM) {
		const n = parseInt(arabicM[1].replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10)), 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	// Roman numerals — \b prevents false matches on prose words like "civil", "dim"
	const romanM = title.match(/(?:chapter|chap\.?)\s*([ivxlcdm]+)\b/i);
	if (romanM) {
		const roman = romanM[1].toUpperCase();
		const vals: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
		let n = 0;
		for (let i = 0; i < roman.length; i++) {
			const cur = vals[roman[i]] ?? 0;
			const nxt = vals[roman[i + 1]] ?? 0;
			n += cur < nxt ? -cur : cur;
		}
		if (n > 0) return n;
	}
	// Chinese numerals: 第三十章, 第一百二十章
	const cnM = title.match(/第\s*([零〇一二两三四五六七八九十百千]+)\s*[卷部篇章回节集话話幕]/);
	if (cnM) {
		const chars = cnM[1];
		let result = 0;
		let cur = 0;
		for (const ch of chars) {
			const v = CHINESE_NUM_MAP[ch] ?? -1;
			if (v < 0) return null;
			if (v >= 10) {
				result += (cur || 1) * v;
				cur = 0;
			} else {
				cur = v;
			}
		}
		result += cur;
		if (result > 0) return result;
	}
	return null;
}

function getAgentsBridgeTimeoutByMode(mode: BookDerivationMode): number {
	// Strict multi-round derivation for long novels needs multi-minute budget.
	// Keep this higher than per-request env defaults used in lightweight tasks.
	return mode === "deep" ? 1_200_000 : 600_000;
}

function isAgentsBridgeUnavailableError(err: unknown): boolean {
	const msg = String((err as any)?.message || "").toLowerCase();
	const details = String((err as any)?.details?.body || (err as any)?.details?.error?.message || "").toLowerCase();
	const merged = `${msg}\n${details}`;
	return (
		merged.includes("agents bridge") ||
		merged.includes("agents_bridge_fetch_failed") ||
		merged.includes("econnrefused") ||
		merged.includes("network request failed") ||
		merged.includes("timeout")
	);
}

function isAgentsBridgeDnsOrConfigError(err: unknown): boolean {
	const msg = String((err as any)?.message || "").toLowerCase();
	const details = String((err as any)?.details?.body || (err as any)?.details?.error?.message || "").toLowerCase();
	const merged = `${msg}\n${details}`;
	return (
		merged.includes("enotfound") ||
		merged.includes("getaddrinfo") ||
		merged.includes("dns") ||
		merged.includes("api key") ||
		merged.includes("unauthorized") ||
		merged.includes("forbidden")
	);
}

const BOOK_METADATA_TEAM_SKILL = "agents-team-book-metadata";

function normalizeChapterList(value: unknown): MaterialChapter[] {
	if (!Array.isArray(value)) return [];
	const out: MaterialChapter[] = [];
	for (const item of value) {
		const chapterRaw = Number((item as any)?.chapter);
		const title = String((item as any)?.title || "").trim() || `第${chapterRaw || out.length + 1}章`;
		const content = String((item as any)?.content || "").trim();
		if (!Number.isFinite(chapterRaw) || chapterRaw <= 0 || !content) continue;
		out.push({
			chapter: Math.trunc(chapterRaw),
			title,
			content,
		});
	}
	return out;
}

// TOC entries are bare heading lines with no body — the text between consecutive heading
// matches is just the heading itself (≤100 chars).  A cluster of ≥3 such entries at the
// start of the detected list is almost certainly a table-of-contents section in the raw
// file.  We strip that leading cluster so the real body chapters are used instead.
const TOC_ENTRY_MAX_CHARS = 100;
const MIN_TOC_CLUSTER_SIZE = 3;

function stripLeadingTocCluster<T extends { contentLength: number }>(
	items: T[],
): T[] {
	let end = 0;
	while (end < items.length && items[end].contentLength <= TOC_ENTRY_MAX_CHARS) end++;
	return end >= MIN_TOC_CLUSTER_SIZE ? items.slice(end) : items;
}

function splitByChapterHeadings(content: string): MaterialChapter[] {
	const text = String(content || "");
	if (!text.trim()) return [];
	const lines = text.split(/\r?\n/);
	const hasCRLF = text.includes("\r\n");
	const sepLen = hasCRLF ? 2 : 1;
	const lineOffsets: number[] = new Array(lines.length + 1);
	let cursor = 0;
	for (let i = 0; i < lines.length; i++) {
		lineOffsets[i + 1] = cursor + lines[i].length + (i < lines.length - 1 ? sepLen : 0);
		cursor = lineOffsets[i + 1];
	}
	const matches: Array<{ line: number; start: number; title: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		const line = String(lines[i] || "").trim();
		if (!line || line.length > 120) continue;
		const m = line.match(CHAPTER_HEADING_LINE_RE);
		if (!m) continue;
		const title = String(m[1] || m[2] || m[3] || line).trim();
		if (!title) continue;
		matches.push({
			line: i + 1,
			start: lineOffsets[i] || 0,
			title,
		});
	}
	if (!matches.length) return [];

	const raw: Array<{ contentLength: number; title: string; body: string }> = [];
	for (let i = 0; i < matches.length; i++) {
		const cur = matches[i];
		const next = matches[i + 1];
		const end = next ? next.start : text.length;
		const body = text.slice(cur.start, end).trim();
		if (!body) continue;
		raw.push({ contentLength: body.length, title: cur.title, body });
	}

	const seen = new Set<number>();
	return stripLeadingTocCluster(raw).map((item, idx) => {
		let ch = parseChapterNumber(item.title) ?? idx + 1;
		if (seen.has(ch)) ch = idx + 1;
		seen.add(ch);
		return { chapter: ch, title: item.title, content: item.body };
	});
}

function splitByFixedSize(content: string, chunkChars = 120_000): MaterialChapter[] {
	const text = String(content || "");
	if (!text.trim()) return [];
	const size = Math.max(20_000, Math.min(300_000, Math.trunc(chunkChars)));
	const out: MaterialChapter[] = [];
	let offset = 0;
	let idx = 1;
	while (offset < text.length) {
		const end = Math.min(text.length, offset + size);
		const body = text.slice(offset, end).trim();
		if (body) {
			out.push({
				chapter: idx,
				title: `自动分段 ${idx}`,
				content: body,
			});
			idx += 1;
		}
		offset = end;
	}
	return out;
}

function toBookChapterMetaFromText(content: string): BookChapterMeta[] {
	const text = String(content || "");
	if (!text.trim()) return [];
	const lines = text.split(/\r?\n/);
	const hasCRLF = text.includes("\r\n");
	const sepLen = hasCRLF ? 2 : 1;
	const lineOffsets: number[] = new Array(lines.length + 1);
	let cursor = 0;
	for (let i = 0; i < lines.length; i++) {
		lineOffsets[i + 1] = cursor + lines[i].length + (i < lines.length - 1 ? sepLen : 0);
		cursor = lineOffsets[i + 1];
	}
	const headingLines: Array<{ line: number; title: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		const line = String(lines[i] || "").trim();
		if (!line || line.length > 120) continue;
		const m = line.match(CHAPTER_HEADING_LINE_RE);
		if (!m) continue;
		const title = String(m[1] || m[2] || m[3] || line).trim();
		if (!title) continue;
		headingLines.push({ line: i + 1, title });
	}

	const rawMetas: BookChapterMeta[] = [];
	if (headingLines.length > 0) {
		for (let i = 0; i < headingLines.length; i++) {
			const cur = headingLines[i];
			const next = headingLines[i + 1];
			const startLine = cur.line;
			const endLine = next ? Math.max(startLine, next.line - 1) : lines.length;
			const startOffset = lineOffsets[startLine - 1] || 0;
			const endOffset = endLine >= lines.length ? text.length : (lineOffsets[endLine] || text.length);
			const length = Math.max(0, endOffset - startOffset);
			rawMetas.push({
				chapter: i + 1,
				title: cur.title,
				startLine,
				endLine,
				startOffset,
				endOffset,
				length,
			});
		}
		const kept = stripLeadingTocCluster(
			rawMetas.map((m) => ({ ...m, contentLength: m.length })),
		);
		return kept.map((m, idx) => ({ ...m, chapter: idx + 1 }));
	}

	// 禁止兜底分段：没有可靠章节标题时直接返回空，交由上游 strict 模式失败。
	return [];
}

function buildSingleChapterMetaFromWholeBook(content: string): BookChapterMeta[] {
	const text = String(content || "");
	const trimmed = text.trim();
	if (!trimmed) return [];
	const startOffset = text.indexOf(trimmed);
	const endOffset = startOffset + trimmed.length;
	const lineCount = trimmed.split(/\r?\n/).length;
	return [
		{
			chapter: 1,
			title: "第1章（全书）",
			startLine: 1,
			endLine: Math.max(1, lineCount),
			startOffset,
			endOffset,
			length: Math.max(0, endOffset - startOffset),
		},
	];
}

function resolveBookChaptersFromText(content: string): {
	chapters: BookChapterMeta[];
	usedSingleChapterFallback: boolean;
} {
	const detected = toBookChapterMetaFromText(content);
	if (detected.length > 0) {
		return { chapters: detected, usedSingleChapterFallback: false };
	}
	const fallback = buildSingleChapterMetaFromWholeBook(content);
	if (fallback.length > 0) {
		return { chapters: fallback, usedSingleChapterFallback: true };
	}
	return { chapters: [], usedSingleChapterFallback: false };
}

function buildProjectBooksRoot(projectId: string, userId: string): string {
	const repoRoot = resolveProjectDataRepoRoot();
	return path.join(
		repoRoot,
		"project-data",
		"users",
		sanitizePathSegment(userId),
		"projects",
		sanitizePathSegment(projectId),
		"books",
	);
}

function buildBookProcessDir(projectId: string, userId: string, bookId: string): string {
	return path.join(buildProjectBooksRoot(projectId, userId), bookId, "process");
}

function buildBookIndexPath(projectId: string, userId: string, bookId: string): string {
	return path.join(buildProjectBooksRoot(projectId, userId), bookId, "index.json");
}

function buildBookUploadSessionDir(projectId: string, userId: string): string {
	return path.join(buildProjectBooksRoot(projectId, userId), BOOK_UPLOAD_CHUNK_DIR);
}

function buildBookUploadMetaPath(projectId: string, userId: string, uploadId: string): string {
	return path.join(
		buildBookUploadSessionDir(projectId, userId),
		`${sanitizePathSegment(uploadId)}.json`,
	);
}

function buildBookUploadTmpPath(projectId: string, userId: string, uploadId: string): string {
	return path.join(
		buildBookUploadSessionDir(projectId, userId),
		`${sanitizePathSegment(uploadId)}.part.bin`,
	);
}

function readUnknownErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message.trim();
	return typeof error === "string" ? error.trim() : String(error);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredSessionString(
	record: Readonly<Record<string, unknown>>,
	key: string,
): string {
	const value = record[key];
	return typeof value === "string" ? value.trim() : "";
}

function parseBookUploadSessionMeta(input: {
	parsed: unknown;
	projectId: string;
	requestUserId: string;
	uploadId: string;
}): BookUploadSessionMeta {
	if (!isUnknownRecord(input.parsed)) {
		throw new BookSourceParseError(
			"book_source_upload_read_failed",
			"书籍上传会话元数据不是有效对象",
			{ uploadId: input.uploadId },
		);
	}
	const id = readRequiredSessionString(input.parsed, "id");
	const sessionUserId = readRequiredSessionString(input.parsed, "userId");
	const storedProjectId = readRequiredSessionString(input.parsed, "projectId");
	const title = readRequiredSessionString(input.parsed, "title");
	const sourceFileName = readRequiredSessionString(input.parsed, "sourceFileName");
	const tmpPath = readRequiredSessionString(input.parsed, "tmpPath");
	const createdAt = readRequiredSessionString(input.parsed, "createdAt");
	const updatedAt = readRequiredSessionString(input.parsed, "updatedAt");
	const finalizedJobId = readRequiredSessionString(input.parsed, "finalizedJobId");
	const bytes = Number(input.parsed.bytes);
	const contentBytes = Number(input.parsed.contentBytes);
	const expectedTmpPath = buildBookUploadTmpPath(
		input.projectId,
		input.requestUserId,
		input.uploadId,
	);
	const invalidReasons: string[] = [];
	if (id !== input.uploadId) invalidReasons.push("upload_id_mismatch");
	if (sessionUserId !== input.requestUserId) invalidReasons.push("user_id_mismatch");
	if (storedProjectId !== input.projectId) invalidReasons.push("project_id_mismatch");
	if (!title) invalidReasons.push("title_missing");
	if (!sourceFileName) invalidReasons.push("source_file_name_missing");
	if (tmpPath !== expectedTmpPath) invalidReasons.push("temporary_path_mismatch");
	if (!Number.isInteger(bytes) || bytes < 0) invalidReasons.push("bytes_invalid");
	if (!Number.isInteger(contentBytes) || contentBytes < 0) {
		invalidReasons.push("content_bytes_invalid");
	}
	if (!createdAt || !updatedAt) invalidReasons.push("timestamps_missing");
	if (invalidReasons.length > 0) {
		throw new BookSourceParseError(
			"book_source_upload_read_failed",
			"书籍上传会话元数据不完整或与请求作用域不一致",
			{ uploadId: input.uploadId, invalidReasons },
		);
	}
	return {
		id,
		userId: sessionUserId,
		projectId: storedProjectId,
		title,
		sourceFileName,
		tmpPath: expectedTmpPath,
		bytes,
		contentBytes,
		finalizedJobId: finalizedJobId || undefined,
		createdAt,
		updatedAt,
	};
}

async function readBookUploadSession(
	projectId: string,
	requestUserId: string,
	uploadId: string,
): Promise<BookUploadSessionMeta | null> {
	const metaPath = buildBookUploadMetaPath(projectId, requestUserId, uploadId);
	let raw: string;
	try {
		raw = await fs.readFile(metaPath, "utf8");
	} catch (error) {
		if (hasNodeErrorCode(error, "ENOENT")) return null;
		throw new BookSourceParseError(
			"book_source_upload_read_failed",
			"读取书籍上传会话元数据失败",
			{ uploadId, reason: readUnknownErrorMessage(error) },
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		throw new BookSourceParseError(
			"book_source_upload_read_failed",
			"解析书籍上传会话元数据失败",
			{ uploadId, reason: readUnknownErrorMessage(error) },
		);
	}
	return parseBookUploadSessionMeta({ parsed, projectId, requestUserId, uploadId });
}

async function writeBookUploadSession(meta: BookUploadSessionMeta): Promise<void> {
	const metaPath = buildBookUploadMetaPath(meta.projectId, meta.userId, meta.id);
	await writeBookUploadMetadataAtomically({
		targetPath: metaPath,
		value: meta,
	});
}

async function readBookUploadSourceSize(
	session: Readonly<BookUploadSessionMeta>,
): Promise<number> {
	try {
		const sourceStats = await fs.stat(session.tmpPath);
		if (!sourceStats.isFile()) {
			throw new BookSourceParseError(
				"book_source_upload_read_failed",
				"书籍上传临时源不是普通文件",
				{ uploadId: session.id },
			);
		}
		return sourceStats.size;
	} catch (error) {
		if (error instanceof BookSourceParseError) throw error;
		throw new BookSourceParseError(
			"book_source_upload_read_failed",
			"读取书籍上传临时源失败",
			{ uploadId: session.id, reason: readUnknownErrorMessage(error) },
		);
	}
}

function reportBookUploadSessionLockError(input: {
	error: BookUploadSessionLockError;
	projectId: string;
	userId: string;
	uploadId: string;
}): void {
	console.error("[book-upload.session-lock.failed]", {
		projectId: input.projectId,
		userId: input.userId,
		uploadId: input.uploadId,
		code: input.error.code,
		message: input.error.message,
		details: input.error.details,
	});
}

function buildBookUploadJobPath(projectId: string, userId: string, jobId: string): string {
	return path.join(
		buildBookUploadSessionDir(projectId, userId),
		`${sanitizePathSegment(jobId)}.job.json`,
	);
}

function buildBookReconfirmJobPath(projectId: string, userId: string, jobId: string): string {
	return path.join(
		buildBookUploadSessionDir(projectId, userId),
		`${sanitizePathSegment(jobId)}.reconfirm.job.json`,
	);
}

async function readBookUploadJob(
	projectId: string,
	userId: string,
	jobId: string,
): Promise<BookUploadJobMeta | null> {
	const jobPath = buildBookUploadJobPath(projectId, userId, jobId);
	try {
		const raw = await fs.readFile(jobPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		const id = String((parsed as any).id || "").trim();
		const uploadId = String((parsed as any).uploadId || "").trim();
		const parsedUserId = String((parsed as any).userId || "").trim();
		const title = String((parsed as any).title || "").trim();
		const status = String((parsed as any).status || "").trim() as BookUploadJobStatus;
		if (!id || !uploadId || !parsedUserId || !title) return null;
		if (parsedUserId !== userId) return null;
		if (!["queued", "running", "succeeded", "failed"].includes(status)) return null;
		return {
			id,
			uploadId,
			userId: parsedUserId,
			projectId,
			title,
			strictAgents: (parsed as any).strictAgents !== false,
			status,
			progress:
				(parsed as any).progress && typeof (parsed as any).progress === "object"
					? {
							phase: String((parsed as any).progress.phase || "").trim() || "queued",
							percent: Math.max(
								0,
								Math.min(100, Math.trunc(Number((parsed as any).progress.percent || 0))),
							),
							message: String((parsed as any).progress.message || "").trim() || undefined,
							totalChapters: Number.isFinite(Number((parsed as any).progress.totalChapters))
								? Math.max(0, Math.trunc(Number((parsed as any).progress.totalChapters)))
								: undefined,
							processedChapters: Number.isFinite(Number((parsed as any).progress.processedChapters))
								? Math.max(0, Math.trunc(Number((parsed as any).progress.processedChapters)))
								: undefined,
						}
					: undefined,
			result: (parsed as any).result || undefined,
			error: (parsed as any).error || undefined,
			createdAt: String((parsed as any).createdAt || "").trim() || new Date().toISOString(),
			updatedAt: String((parsed as any).updatedAt || "").trim() || new Date().toISOString(),
			startedAt: String((parsed as any).startedAt || "").trim() || undefined,
			finishedAt: String((parsed as any).finishedAt || "").trim() || undefined,
		};
	} catch {
		return null;
	}
}

async function writeBookUploadJob(meta: BookUploadJobMeta): Promise<void> {
	const jobPath = buildBookUploadJobPath(meta.projectId, meta.userId, meta.id);
	await writeBookUploadMetadataAtomically({
		targetPath: jobPath,
		value: meta,
	});
}

async function readBookReconfirmJob(
	projectId: string,
	userId: string,
	jobId: string,
): Promise<BookReconfirmJobMeta | null> {
	const jobPath = buildBookReconfirmJobPath(projectId, userId, jobId);
	try {
		const raw = await fs.readFile(jobPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		const id = String((parsed as any).id || "").trim();
		const bookId = String((parsed as any).bookId || "").trim();
		const parsedUserId = String((parsed as any).userId || "").trim();
		const title = String((parsed as any).title || "").trim();
		const mode: BookDerivationMode = (parsed as any).mode === "deep" ? "deep" : "standard";
		const status = String((parsed as any).status || "").trim() as BookReconfirmJobStatus;
		if (!id || !bookId || !parsedUserId || !title) return null;
		if (parsedUserId !== userId) return null;
		if (!["queued", "running", "succeeded", "failed"].includes(status)) return null;
		return {
			id,
			bookId,
			userId: parsedUserId,
			projectId,
			title,
			mode,
			strictAgents: (parsed as any).strictAgents !== false,
			status,
			progress:
				(parsed as any).progress && typeof (parsed as any).progress === "object"
					? {
							phase: String((parsed as any).progress.phase || "").trim() || "queued",
							percent: Math.max(
								0,
								Math.min(100, Math.trunc(Number((parsed as any).progress.percent || 0))),
							),
							message: String((parsed as any).progress.message || "").trim() || undefined,
							totalChapters: Number.isFinite(Number((parsed as any).progress.totalChapters))
								? Math.max(0, Math.trunc(Number((parsed as any).progress.totalChapters)))
								: undefined,
							processedChapters: Number.isFinite(Number((parsed as any).progress.processedChapters))
								? Math.max(0, Math.trunc(Number((parsed as any).progress.processedChapters)))
								: undefined,
						}
					: undefined,
			result: (parsed as any).result || undefined,
			error: (parsed as any).error || undefined,
			createdAt: String((parsed as any).createdAt || "").trim() || new Date().toISOString(),
			updatedAt: String((parsed as any).updatedAt || "").trim() || new Date().toISOString(),
			startedAt: String((parsed as any).startedAt || "").trim() || undefined,
			finishedAt: String((parsed as any).finishedAt || "").trim() || undefined,
		};
	} catch {
		return null;
	}
}

async function writeBookReconfirmJob(meta: BookReconfirmJobMeta): Promise<void> {
	const jobPath = buildBookReconfirmJobPath(meta.projectId, meta.userId, meta.id);
	await writeBookUploadMetadataAtomically({
		targetPath: jobPath,
		value: meta,
	});
}

async function listBookUploadJobsForProject(
	projectId: string,
	userId: string,
): Promise<BookUploadJobMeta[]> {
	const root = buildBookUploadSessionDir(projectId, userId);
	try {
		const entries = await fs.readdir(root, { withFileTypes: true });
		const jobs: BookUploadJobMeta[] = [];
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".job.json")) continue;
			const jobId = entry.name.slice(0, -".job.json".length);
			const job = await readBookUploadJob(projectId, userId, jobId);
			if (job) jobs.push(job);
		}
		return jobs.sort(
			(a, b) =>
				Date.parse(String(b.updatedAt || "")) -
				Date.parse(String(a.updatedAt || "")),
		);
	} catch {
		return [];
	}
}

async function listBookReconfirmJobsForProject(
	projectId: string,
	userId: string,
): Promise<BookReconfirmJobMeta[]> {
	const root = buildBookUploadSessionDir(projectId, userId);
	try {
		const entries = await fs.readdir(root, { withFileTypes: true });
		const jobs: BookReconfirmJobMeta[] = [];
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".reconfirm.job.json")) continue;
			const jobId = entry.name.slice(0, -".reconfirm.job.json".length);
			const job = await readBookReconfirmJob(projectId, userId, jobId);
			if (job) jobs.push(job);
		}
		return jobs.sort(
			(a, b) =>
				Date.parse(String(b.updatedAt || "")) -
				Date.parse(String(a.updatedAt || "")),
		);
	} catch {
		return [];
	}
}

async function findActiveBookUploadJob(
	projectId: string,
	userId: string,
): Promise<BookUploadJobMeta | null> {
	const jobs = await listBookUploadJobsForProject(projectId, userId);
	for (const job of jobs) {
		const resolved = await resolveBookUploadJobRuntimeState(job);
		if (resolved && (resolved.status === "queued" || resolved.status === "running")) {
			return resolved;
		}
	}
	return null;
}

async function findActiveBookReconfirmJob(
	projectId: string,
	userId: string,
	bookId: string,
): Promise<BookReconfirmJobMeta | null> {
	const jobs = await listBookReconfirmJobsForProject(projectId, userId);
	return (
		jobs.find(
			(job) =>
				job.bookId === bookId && (job.status === "queued" || job.status === "running"),
		) || null
	);
}

function mapBookIndexStoreErrorForAsset(error: BookIndexStoreError): AppError {
	return new AppError(error.message, {
		status: error.code === "book_index_not_found" ? 404 : 500,
		code: error.code,
		details: error.details,
	});
}

function hasNodeErrorCode(error: unknown, code: string): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			!Array.isArray(error) &&
			(error as { code?: unknown }).code === code,
	);
}

async function readBookIndexSafe(indexPath: string): Promise<BookIndexRecord | null> {
	try {
		return await readBookIndex(indexPath);
	} catch (error) {
		if (error instanceof BookIndexStoreError && error.code === "book_index_not_found") return null;
		if (error instanceof BookIndexStoreError) throw mapBookIndexStoreErrorForAsset(error);
		throw error;
	}
}

function cloneBookIndexAssets(index: Readonly<BookIndexRecord>): Record<string, unknown> {
	return index.assets && typeof index.assets === "object" && !Array.isArray(index.assets)
		? { ...(index.assets as Record<string, unknown>) }
		: {};
}

async function updateBookIndexForAsset<T>(
	indexPath: string,
	updater: (current: Readonly<BookIndexRecord>) => { next: BookIndexRecord; result: T },
): Promise<{ index: BookIndexRecord; result: T }> {
	try {
		return await updateBookIndex(indexPath, updater);
	} catch (error) {
		if (error instanceof BookIndexStoreError) throw mapBookIndexStoreErrorForAsset(error);
		throw error;
	}
}

async function commitDerivedBookIndex(input: {
	indexPath: string;
	base: BookIndexRecord;
	derived: BookIndexRecord;
}): Promise<BookIndexRecord> {
	const updated = await updateBookIndexForAsset(input.indexPath, (current) => {
		const next = mergeDerivedBookIndex(input.base, current, input.derived);
		return { next, result: next };
	});
	return updated.index;
}

async function attachFreshBookEvidenceIndex(input: {
	bookDirectory: string;
	bookId: string;
	projectId: string;
	title: string;
	rawText: string;
	index: BookIndexRecord;
	source: unknown;
}): Promise<BookIndexRecord> {
	const source = requireBookSourceMetadataV1(input.source);
	const chapters = Array.isArray(input.index.chapters)
		? (input.index.chapters as BookChapterMeta[])
		: [];
	const evidenceIndex = buildBookEvidenceIndex({
		bookId: input.bookId,
		projectId: input.projectId,
		title: input.title,
		rawText: input.rawText,
		chapters,
		source,
	});
	const evidenceIndexSummary = await writeBookEvidenceIndex({
		bookDirectory: input.bookDirectory,
		index: evidenceIndex,
	});
	return {
		...input.index,
		source,
		evidenceIndex: evidenceIndexSummary,
	};
}

async function readBookStoryboardProcessSafe(processDir: string): Promise<{
	progress: any | null;
	items: any[];
}> {
	try {
		const entries = await fs.readdir(processDir, { withFileTypes: true });
		const shotFiles = entries
			.filter((x) => x.isFile() && /^shot-\d{4,}\.json$/i.test(String(x.name || "")))
			.map((x) => path.join(processDir, x.name));
		const chunkFiles = entries
			.filter((x) => x.isFile() && /^ch\d+-g\d+-i\d+\.json$/i.test(String(x.name || "")))
			.map((x) => path.join(processDir, x.name));
		const items: any[] = [];
		for (const fp of shotFiles) {
			// eslint-disable-next-line no-await-in-loop
			const raw = await fs.readFile(fp, "utf8").catch(() => "");
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw);
				items.push(parsed);
			} catch {
				// ignore invalid file
			}
		}
		for (const fp of chunkFiles) {
			// eslint-disable-next-line no-await-in-loop
			const raw = await fs.readFile(fp, "utf8").catch(() => "");
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw);
				const shots = Array.isArray(parsed?.shots) ? parsed.shots : [];
				for (const shot of shots) {
					if (!shot || typeof shot !== "object") continue;
					items.push(shot);
				}
			} catch {
				// ignore invalid file
			}
		}
		const progressRaw = await fs.readFile(path.join(processDir, "index.json"), "utf8").catch(() => "");
		const progress = progressRaw ? JSON.parse(progressRaw) : null;
		return { progress, items };
	} catch {
		return { progress: null, items: [] };
	}
}

function computeBookStoryboardProgressFromIndex(input: {
	index: any;
	processItems: any[];
}): {
	totalShots: number | null;
	completedShots: number;
	progress01: number | null;
	next: {
		taskId: string;
		nextShotStart: number;
		nextShotEnd: number;
		groupSize: 25;
	};
} | null {
	const plansRaw = Array.isArray(input.index?.assets?.storyboardPlans)
		? input.index.assets.storyboardPlans
		: [];
	const plans = plansRaw
		.map((item: any) => {
			const taskId = String(item?.taskId || "").trim();
			const shotPrompts = Array.isArray(item?.shotPrompts)
				? item.shotPrompts.map((x: any) => String(x || "").trim()).filter(Boolean)
				: [];
			return {
				taskId,
				updatedAt: String(item?.updatedAt || "").trim(),
				shotPrompts,
			};
		})
		.filter((x: { taskId: string; shotPrompts: string[] }) => !!x.taskId && x.shotPrompts.length > 0)
		.sort((a: { updatedAt: string }, b: { updatedAt: string }) => {
			const at = Date.parse(a.updatedAt);
			const bt = Date.parse(b.updatedAt);
			return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
		});
	if (!plans.length) return null;
	const activeTaskId = plans[0]!.taskId;
	const shotSetByTask = new Map<string, Set<number>>();
	for (const rec of input.processItems) {
		const taskId = String((rec as any)?.taskId || "").trim();
		const shotNo = Math.trunc(Number((rec as any)?.shotNo || 0));
		if (!taskId || !shotNo) continue;
		const existing = shotSetByTask.get(taskId) || new Set<number>();
		existing.add(shotNo);
		shotSetByTask.set(taskId, existing);
	}
	let next: {
		taskId: string;
		nextShotStart: number;
		nextShotEnd: number;
		groupSize: 25;
	} | null = null;
	let totalShots: number | null = null;
	let progress01: number | null = null;
	const completedShots = Math.max(0, (shotSetByTask.get(activeTaskId) || new Set<number>()).size);
	let knownCompletedShots = 0;
	let knownTotalShots = 0;
	const activePlan = plans.find((plan: { taskId: string; shotPrompts: string[] }) => plan.taskId === activeTaskId) || null;
	if (!activePlan) return null;
	const taskTotal = activePlan.shotPrompts.length;
	const taskShots = shotSetByTask.get(activeTaskId) || new Set<number>();
	let taskCompleted = 0;
	let taskMissing: number | null = null;
	for (let shotNo = 1; shotNo <= taskTotal; shotNo += 1) {
		if (taskShots.has(shotNo)) taskCompleted += 1;
		else if (taskMissing === null) taskMissing = shotNo;
	}
	knownTotalShots += taskTotal;
	knownCompletedShots += taskCompleted;
	if (taskMissing !== null) {
		const taskRangeEnd = Math.min(
			taskTotal,
			taskMissing + STORYBOARD_NEXT_BATCH_SIZE - 1,
		);
		next = {
			taskId: activeTaskId,
			nextShotStart: taskMissing,
			nextShotEnd: taskRangeEnd,
			groupSize: STORYBOARD_NEXT_BATCH_SIZE,
		};
	}
	let totalReliable = true;
	for (const [taskId, shots] of shotSetByTask.entries()) {
		if (taskId !== activeTaskId) continue;
		if (!taskTotal) {
			totalReliable = false;
			break;
		}
		const maxShotNo = shots.size ? Math.max(...shots) : 0;
		if (maxShotNo > taskTotal) {
			totalReliable = false;
			break;
		}
	}
	if (totalReliable && knownTotalShots > 0) {
		totalShots = knownTotalShots;
		progress01 = Math.max(0, Math.min(1, knownCompletedShots / knownTotalShots));
	}
	if (!next) {
		let fallbackShot = 1;
		while (taskShots.has(fallbackShot)) fallbackShot += 1;
		const fallbackRangeEnd = taskTotal
			? Math.min(taskTotal, fallbackShot + STORYBOARD_NEXT_BATCH_SIZE - 1)
			: fallbackShot + STORYBOARD_NEXT_BATCH_SIZE - 1;
		next = {
			taskId: activeTaskId,
			nextShotStart: fallbackShot,
			nextShotEnd: fallbackRangeEnd,
			groupSize: STORYBOARD_NEXT_BATCH_SIZE,
		};
	}
	return {
		totalShots,
		completedShots,
		progress01,
		next: next!,
	};
}

function readBookRawChunkMaxBytes(): number {
	return readNodeEnvInt("BOOK_RAW_CHUNK_MAX_BYTES", 10_240, {
		min: 1_024,
		max: 4_194_304,
	});
}

function buildBookRawChunkDir(bookDir: string): string {
	return path.join(bookDir, "raw-chunks");
}

function normalizeBookRawTextChunks(value: unknown): BookRawTextChunkRecord[] {
	if (!Array.isArray(value)) return [];
	const out: BookRawTextChunkRecord[] = [];
	for (const item of value) {
		const chunkId = String((item as any)?.chunkId || "").trim();
		const chunkIndexRaw = Number((item as any)?.chunkIndex);
		const chunkIndex =
			Number.isFinite(chunkIndexRaw) && chunkIndexRaw > 0 ? Math.trunc(chunkIndexRaw) : 0;
		const filePath = String((item as any)?.filePath || "").trim();
		const sizeBytesRaw = Number((item as any)?.sizeBytes);
		const sizeBytes =
			Number.isFinite(sizeBytesRaw) && sizeBytesRaw > 0 ? Math.trunc(sizeBytesRaw) : 0;
		const startChapterRaw = Number((item as any)?.startChapter);
		const endChapterRaw = Number((item as any)?.endChapter);
		const startChapter =
			Number.isFinite(startChapterRaw) && startChapterRaw > 0 ? Math.trunc(startChapterRaw) : 0;
		const endChapter =
			Number.isFinite(endChapterRaw) && endChapterRaw > 0 ? Math.trunc(endChapterRaw) : 0;
		if (!chunkId || chunkIndex <= 0) continue;
		if (startChapter <= 0 || endChapter <= 0) continue;
		out.push({
			chunkId,
			chunkIndex,
			filePath,
			sizeBytes,
			startOffset: 0,
			endOffset: 0,
			startChapter: Math.min(startChapter, endChapter),
			endChapter: Math.max(startChapter, endChapter),
			title: String((item as any)?.title || "").trim(),
			createdAt: String((item as any)?.createdAt || "").trim(),
			updatedAt: String((item as any)?.updatedAt || "").trim(),
		});
	}
	return out.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

function resolveGraphChunkChapterWindow(input: {
	chapter: number;
	totalChapters: number;
	rawChunks: BookRawTextChunkRecord[];
	fallbackStart: number;
	fallbackEnd: number;
}): { start: number; end: number; source: "chunk" | "window" } {
	const chapter = Math.max(1, Math.trunc(input.chapter || 1));
	const totalChapters = Math.max(1, Math.trunc(input.totalChapters || 1));
	for (const chunk of input.rawChunks) {
		const start = Math.max(1, Math.trunc(Number(chunk.startChapter || 0)));
		const end = Math.max(start, Math.trunc(Number(chunk.endChapter || 0)));
		if (start <= chapter && chapter <= end) {
			return {
				start: Math.min(totalChapters, start),
				end: Math.min(totalChapters, end),
				source: "chunk",
			};
		}
	}
	return {
		start: Math.max(1, Math.min(totalChapters, Math.trunc(input.fallbackStart || 1))),
		end: Math.max(1, Math.min(totalChapters, Math.trunc(input.fallbackEnd || totalChapters))),
		source: "window",
	};
}

function chapterRangeForOffsets(
	chapters: BookChapterMeta[],
	startOffset: number,
	endOffset: number,
): { startChapter: number; endChapter: number } {
	const overlapped = chapters
		.filter((ch) => {
			const chStart = Math.max(0, Number(ch.startOffset || 0));
			const chEnd = Math.max(chStart, Number(ch.endOffset || chStart));
			return !(chEnd <= startOffset || chStart >= endOffset);
		})
		.map((ch) => ch.chapter)
		.filter((n) => Number.isFinite(n) && n > 0);
	if (!overlapped.length) return { startChapter: 0, endChapter: 0 };
	return {
		startChapter: Math.min(...overlapped),
		endChapter: Math.max(...overlapped),
	};
}

async function writeBookRawChunksAndAttachMetadata(input: {
	bookDir: string;
	rawContent: string;
	chapters: BookChapterMeta[];
	index: any;
}): Promise<any> {
	const raw = String(input.rawContent || "");
	const maxBytes = readBookRawChunkMaxBytes();
	const chunkDir = buildBookRawChunkDir(input.bookDir);
	await fs.mkdir(chunkDir, { recursive: true });
	const old = await fs.readdir(chunkDir).catch(() => []);
	for (const name of old) {
		if (!/\.md$/i.test(name)) continue;
		await fs.rm(path.join(chunkDir, name), { force: true }).catch(() => {});
	}

	const nowIso = new Date().toISOString();
	const records: BookRawTextChunkRecord[] = [];
	let offset = 0;
	let idx = 0;
	while (offset < raw.length) {
		let lo = offset + 1;
		let hi = raw.length;
		let best = Math.min(raw.length, offset + 300_000);
		while (lo <= hi) {
			const mid = Math.floor((lo + hi) / 2);
			const part = raw.slice(offset, mid);
			const size = Buffer.byteLength(part, "utf8");
			if (size <= maxBytes) {
				best = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		// Snap to the last paragraph boundary (newline) so chunks never cut mid-sentence.
		let end = Math.max(offset + 1, best);
		if (end < raw.length) {
			const lastNl = raw.lastIndexOf("\n", end - 1);
			if (lastNl > offset) end = lastNl + 1;
		}
		const text = raw.slice(offset, end);
		const sizeBytes = Buffer.byteLength(text, "utf8");
		const range = chapterRangeForOffsets(input.chapters, offset, end);
		const chunkIndex = idx + 1;
		const fileName = `chunk-${String(chunkIndex).padStart(4, "0")}.md`;
		const absPath = path.join(chunkDir, fileName);
		await fs.writeFile(absPath, text, "utf8");
		records.push({
			chunkId: `raw-chunk-${chunkIndex}`,
			chunkIndex,
			filePath: path.relative(process.cwd(), absPath),
			sizeBytes,
			startOffset: offset,
			endOffset: end,
			startChapter: range.startChapter,
			endChapter: range.endChapter,
			title:
				range.startChapter > 0
					? range.startChapter === range.endChapter
						? `第${range.startChapter}章`
						: `第${range.startChapter}-${range.endChapter}章`
					: `文本块 ${chunkIndex}`,
			createdAt: nowIso,
			updatedAt: nowIso,
		});
		offset = end;
		idx += 1;
	}

	const assets =
		input.index && typeof input.index.assets === "object" && input.index.assets
			? { ...(input.index.assets as Record<string, unknown>) }
			: {};
	(assets as any).rawTextChunks = records;
	return {
		...input.index,
		assets,
		updatedAt: nowIso,
	};
}

function buildChapterSnippet(
	raw: string,
	chapter: BookChapterMeta,
	overrideMaxChars?: number,
): string {
	const start = Math.max(0, chapter.startOffset || 0);
	const end = Math.min(raw.length, chapter.endOffset || raw.length);
	const text = raw.slice(start, end).trim();
	if (!text) return "";
	const envMax = readNodeEnvInt("BOOK_CHAPTER_SNIPPET_MAX_CHARS", 6_000, {
		min: 600,
		max: 120_000,
	});
	const maxChars =
		typeof overrideMaxChars === "number" && Number.isFinite(overrideMaxChars)
			? Math.max(600, Math.min(120_000, Math.trunc(overrideMaxChars)))
			: envMax;
	return text.slice(0, maxChars);
}

function readBookMetadataBatchMaxChars(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 180_000 : 250_000;
	return readNodeEnvInt("BOOK_METADATA_BATCH_MAX_CHARS", fallback, {
		min: 10_000,
		max: 3_600_000,
	});
}

function readBookMetadataBatchMaxChapters(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 18 : 24;
	return readNodeEnvInt("BOOK_METADATA_BATCH_MAX_CHAPTERS", fallback, { min: 2, max: 100 });
}

function readBookMetadataBatchConcurrency(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 2 : 4;
	return readNodeEnvInt("BOOK_METADATA_BATCH_CONCURRENCY", fallback, { min: 1, max: 50 });
}

function readBookMetadataStageWindowChapters(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 80 : 100;
	return readNodeEnvInt("BOOK_METADATA_STAGE_WINDOW_CHAPTERS", fallback, { min: 20, max: 200 });
}

function readBookMetadataInitialChapters(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 80 : 100;
	return readNodeEnvInt("BOOK_METADATA_INITIAL_CHAPTERS", fallback, { min: 20, max: 200 });
}

function chunkBookChaptersByPromptBudget(
	chapters: BookChapterMeta[],
	raw: string,
	options: { maxChars: number; maxChapters: number },
): BookChapterMeta[][] {
	if (!chapters.length) return [];
	const maxChars = Math.max(10_000, Math.trunc(options.maxChars || 120_000));
	const maxChapters = Math.max(2, Math.trunc(options.maxChapters || 12));
	const out: BookChapterMeta[][] = [];
	let current: BookChapterMeta[] = [];
	let currentChars = 0;
	for (const chapter of chapters) {
		const snippetLen = buildChapterSnippet(raw, chapter).length;
		const shouldSplit =
			current.length > 0 &&
			(current.length >= maxChapters || currentChars + snippetLen > maxChars);
		if (shouldSplit) {
			out.push(current);
			current = [];
			currentChars = 0;
		}
		current.push(chapter);
		currentChars += snippetLen;
	}
	if (current.length) out.push(current);
	return out;
}

function chunkBookChaptersByCount(chapters: BookChapterMeta[], chunkSize: number): BookChapterMeta[][] {
	if (!chapters.length) return [];
	const size = Math.max(1, Math.trunc(chunkSize || 1));
	const out: BookChapterMeta[][] = [];
	for (let i = 0; i < chapters.length; i += size) {
		out.push(chapters.slice(i, i + size));
	}
	return out;
}

function readCharacterProfilesStageWindowChapters(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 140 : 180;
	return readNodeEnvInt("BOOK_CHARACTER_PROFILE_STAGE_WINDOW_CHAPTERS", fallback, {
		min: 40,
		max: 400,
	});
}

function readCharacterProfilesBatchConcurrency(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 4 : 8;
	return readNodeEnvInt("BOOK_CHARACTER_PROFILE_BATCH_CONCURRENCY", fallback, {
		min: 1,
		max: 50,
	});
}

function readCharacterGraphStageWindowChapters(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 120 : 160;
	return readNodeEnvInt("BOOK_CHARACTER_GRAPH_STAGE_WINDOW_CHAPTERS", fallback, {
		min: 40,
		max: 400,
	});
}

function readCharacterGraphBatchConcurrency(mode: BookDerivationMode): number {
	const fallback = mode === "deep" ? 4 : 8;
	return readNodeEnvInt("BOOK_CHARACTER_GRAPH_BATCH_CONCURRENCY", fallback, {
		min: 1,
		max: 50,
	});
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (!items.length) return [];
	const limit = Math.max(1, Math.trunc(concurrency || 1));
	const results = new Array<R>(items.length);
	let cursor = 0;
	const run = async () => {
		while (true) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
	return results;
}

function normalizeKeywords(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		const k = String(item || "").trim();
		if (!k) continue;
		if (out.includes(k)) continue;
		out.push(k);
		if (out.length >= 8) break;
	}
	return out;
}

function normalizeEntityItems(
	value: unknown,
	maxItems = 12,
): Array<{ name: string; description?: string }> {
	if (!Array.isArray(value)) return [];
	const out: Array<{ name: string; description?: string }> = [];
	const seen = new Set<string>();
	for (const item of value) {
		const name = String((item as any)?.name || "").trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const description = String((item as any)?.description || "").trim();
		out.push(description ? { name, description } : { name });
		if (out.length >= maxItems) break;
	}
	return out;
}

function normalizePropNarrativeImportance(value: unknown): BookPropNarrativeImportance | undefined {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "critical") return "critical";
	if (raw === "supporting") return "supporting";
	if (raw === "background") return "background";
	return undefined;
}

function normalizePropVisualNeed(value: unknown): BookPropVisualNeed | undefined {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "must_render") return "must_render";
	if (raw === "shared_scene_only") return "shared_scene_only";
	if (raw === "mention_only") return "mention_only";
	return undefined;
}

function normalizePropFunctionTags(value: unknown): BookPropFunctionTag[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: BookPropFunctionTag[] = [];
	const seen = new Set<BookPropFunctionTag>();
	for (const item of value) {
		const raw = String(item || "").trim().toLowerCase();
		let normalized: BookPropFunctionTag | null = null;
		if (raw === "plot_trigger") normalized = "plot_trigger";
		else if (raw === "combat") normalized = "combat";
		else if (raw === "threat") normalized = "threat";
		else if (raw === "identity_marker") normalized = "identity_marker";
		else if (raw === "continuity_anchor") normalized = "continuity_anchor";
		else if (raw === "transaction") normalized = "transaction";
		else if (raw === "environment_clutter") normalized = "environment_clutter";
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
		if (out.length >= 6) break;
	}
	return out.length ? out : undefined;
}

function normalizePropItems(
	value: unknown,
	maxItems = 12,
): BookChapterPropMeta[] {
	if (!Array.isArray(value)) return [];
	const out: BookChapterPropMeta[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
		const name = String(record?.name || "").trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const description = String(record?.description || "").trim();
		const narrativeImportance = normalizePropNarrativeImportance(record?.narrativeImportance);
		const visualNeed = normalizePropVisualNeed(record?.visualNeed);
		const functionTags = normalizePropFunctionTags(record?.functionTags);
		const reusableAssetPreferred =
			typeof record?.reusableAssetPreferred === "boolean" ? record.reusableAssetPreferred : undefined;
		const independentlyFramable =
			typeof record?.independentlyFramable === "boolean" ? record.independentlyFramable : undefined;
		out.push({
			name,
			...(description ? { description } : null),
			...(narrativeImportance ? { narrativeImportance } : null),
			...(visualNeed ? { visualNeed } : null),
			...(functionTags?.length ? { functionTags } : null),
			...(typeof reusableAssetPreferred === "boolean" ? { reusableAssetPreferred } : null),
			...(typeof independentlyFramable === "boolean" ? { independentlyFramable } : null),
		});
		if (out.length >= maxItems) break;
	}
	return out;
}

function mergeUniqueEntityPool(
	chapters: BookChapterMeta[],
	key: "characters" | "scenes" | "locations",
): Array<{ name: string; description?: string }> {
	const pool: Array<{ name: string; description?: string }> = [];
	const seen = new Set<string>();
	for (const chapter of chapters) {
		const record = chapter as Record<string, unknown>;
		const list = Array.isArray(record[key]) ? (record[key] as Array<Record<string, unknown>>) : [];
		for (const item of list) {
			const name = String(item?.name || "").trim();
			if (!name) continue;
			const token = name.toLowerCase();
			if (seen.has(token)) continue;
			seen.add(token);
			const description = String(item?.description || "").trim();
			pool.push(description ? { name, description } : { name });
		}
	}
	return pool;
}

function mergeUniquePropPool(chapters: BookChapterMeta[]): BookChapterPropMeta[] {
	const pool: BookChapterPropMeta[] = [];
	const seen = new Set<string>();
	for (const chapter of chapters) {
		for (const item of normalizePropItems(chapter.props, 20)) {
			const token = item.name.toLowerCase();
			if (seen.has(token)) continue;
			seen.add(token);
			pool.push(item);
		}
	}
	return pool;
}

function buildBookMetadataTeamSystemPrompt(phase: "parser" | "checker"): string {
	const role =
		phase === "parser"
			? "你负责章节元数据解析（parser）"
			: "你负责章节元数据完整性审校（checker）";
	return [
		"你是 TapCanvas 小说元数据主代理。",
		`必须先调用 Skill 工具加载 "${BOOK_METADATA_TEAM_SKILL}"，并在 team mode 中至少启动两个子代理：`,
		"- parser: 逐章抽取 title/summary/keywords/coreConflict/characters/props/scenes/locations",
		"- checker: 覆盖性检查 + 缺失补全 + 去重与格式修复",
		role,
		"props 不只是列名词，必须由 AI 判断其叙事重要性、独立出图必要性与是否值得做可复用资产。",
		"输出必须是严格 JSON，且顶层结构必须是：",
		'{"chapters":[{"chapter":1,"title":"...","summary":"...","keywords":["..."],"coreConflict":"...","characters":[{"name":"...","description":"..."}],"props":[{"name":"...","description":"...","narrativeImportance":"critical|supporting|background","visualNeed":"must_render|shared_scene_only|mention_only","functionTags":["plot_trigger|combat|threat|identity_marker|continuity_anchor|transaction|environment_clutter"],"reusableAssetPreferred":true,"independentlyFramable":true}],"scenes":[{"name":"...","description":"..."}],"locations":[{"name":"...","description":"..."}]}]}',
		"禁止输出 markdown/解释文字/代码块。",
	].join("\n");
}

function buildBookGraphTeamSystemPrompt(): string {
	return [
		"你是 TapCanvas 小说角色关系网主代理。",
		`必须先调用 Skill 工具加载 "${BOOK_METADATA_TEAM_SKILL}"，并在 team mode 中至少启动两个子代理：`,
		"- parser: 从章节和角色档案抽取节点与关系候选",
		"- checker: 校验去重、修复 ID、补齐章节提示与关系类型",
		"输出必须是严格 JSON，禁止 markdown 与解释文本。",
		'顶层必须包含：{"characterGraph":{"nodes":[...],"edges":[...]}}',
		'edge.relation 允许："family"|"parent_child"|"siblings"|"mentor_disciple"|"alliance"|"friend"|"lover"|"rival"|"enemy"|"colleague"|"master_servant"|"betrayal"|"conflict"|"coappear"。',
		'edge.directed 为布尔值，表示是否有方向；例如 parent_child/mentor_disciple/master_servant/betrayal 建议 directed=true。',
	].join("\n");
}

function normalizeGraphRelation(value: unknown): BookCharacterGraphEdge["relation"] {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "family" || raw === "亲属") return "family";
	if (raw === "parent_child" || raw === "parent-child" || raw === "父子" || raw === "父女" || raw === "母子" || raw === "母女") return "parent_child";
	if (raw === "siblings" || raw === "兄弟" || raw === "姐妹" || raw === "兄妹" || raw === "姐弟") return "siblings";
	if (raw === "mentor_disciple" || raw === "mentor-disciple" || raw === "师徒" || raw === "同门" || raw === "师兄弟" || raw === "师姐妹") return "mentor_disciple";
	if (raw === "alliance" || raw === "盟友" || raw === "同盟") return "alliance";
	if (raw === "friend" || raw === "朋友" || raw === "挚友") return "friend";
	if (raw === "lover" || raw === "恋人" || raw === "爱人" || raw === "情侣") return "lover";
	if (raw === "rival" || raw === "竞争" || raw === "对手") return "rival";
	if (raw === "enemy" || raw === "仇敌" || raw === "宿敌" || raw === "敌人") return "enemy";
	if (raw === "colleague" || raw === "同事" || raw === "战友") return "colleague";
	if (raw === "master_servant" || raw === "master-servant" || raw === "主仆") return "master_servant";
	if (raw === "betrayal" || raw === "背叛") return "betrayal";
	if (raw === "conflict" || raw === "冲突" || raw === "对立") return "conflict";
	return "coappear";
}

function isDirectedRelation(relation: BookCharacterGraphEdge["relation"]): boolean {
	return (
		relation === "parent_child" ||
		relation === "mentor_disciple" ||
		relation === "master_servant" ||
		relation === "betrayal"
	);
}

function mergeChapterMetadataFromAgent(
	chapters: BookChapterMeta[],
	list: any[],
): BookChapterMeta[] {
	if (!Array.isArray(list) || !list.length) return chapters;
	const map = new Map<number, any>();
	for (const item of list) {
		const n = Number(item?.chapter);
		if (!Number.isFinite(n) || n <= 0) continue;
		map.set(Math.trunc(n), item);
	}
	return chapters.map((ch) => {
		const m = map.get(ch.chapter);
		if (!m) return ch;
		const title = String(m?.title || "").trim();
		const summary = String(m?.summary || "").trim();
		const keywords = normalizeKeywords(m?.keywords);
		const characters = normalizeEntityItems(m?.characters, 8);
		const props = normalizePropItems(m?.props, 8);
		const scenes = normalizeEntityItems(m?.scenes, 8);
		const locations = normalizeEntityItems(m?.locations, 8);
		const coreConflict = String(m?.coreConflict || "").trim();
		return {
			...ch,
			...(title ? { title } : null),
			...(summary ? { summary } : null),
			...(keywords.length ? { keywords } : null),
			...(coreConflict ? { coreConflict } : null),
			...(characters.length ? { characters } : null),
			...(props.length ? { props } : null),
			...(scenes.length ? { scenes } : null),
			...(locations.length ? { locations } : null),
		};
	});
}

function assertAgentsChaptersComplete(chapters: BookChapterMeta[]): BookChapterMeta[] {
	const output = chapters.map((chapter) => ({
		...chapter,
		title: String(chapter.title || "").trim(),
		summary: String(chapter.summary || "").trim(),
		keywords: normalizeKeywords(chapter.keywords),
		coreConflict: String(chapter.coreConflict || "").trim(),
		characters: normalizeEntityItems(chapter.characters, 20),
		props: normalizePropItems(chapter.props, 20),
		scenes: normalizeEntityItems(chapter.scenes, 20),
		locations: normalizeEntityItems(chapter.locations, 20),
	}));
	const missing = output.find(
		(ch) =>
			!ch.title ||
			!ch.summary ||
			!ch.coreConflict ||
			!Array.isArray(ch.keywords) ||
			ch.keywords.length === 0 ||
			!Array.isArray(ch.characters) ||
			!Array.isArray(ch.props) ||
			!Array.isArray(ch.scenes) ||
			!Array.isArray(ch.locations),
	);
	if (missing) {
		throw new Error(`agents-cli chapters metadata incomplete at chapter ${missing.chapter}`);
	}
	return output;
}

function isChapterMetadataComplete(ch: BookChapterMeta): boolean {
	return (
		!!String(ch.title || "").trim() &&
		!!String(ch.summary || "").trim() &&
		!!String(ch.coreConflict || "").trim() &&
		Array.isArray(ch.keywords) &&
		ch.keywords.length > 0 &&
		Array.isArray(ch.characters) &&
		Array.isArray(ch.props) &&
		Array.isArray(ch.scenes) &&
		Array.isArray(ch.locations)
	);
}

function mergeChapterMetaWithExisting(
	base: BookChapterMeta,
	existing: BookChapterMeta | null,
): BookChapterMeta {
	if (!existing || Number(existing.chapter) !== Number(base.chapter)) return base;
	const title = String(existing.title || "").trim();
	const summary = String(existing.summary || "").trim();
	const coreConflict = String(existing.coreConflict || "").trim();
	const keywords = normalizeKeywords(existing.keywords);
	const characters = normalizeEntityItems(existing.characters, 20);
	const props = normalizePropItems(existing.props, 20);
	const scenes = normalizeEntityItems(existing.scenes, 20);
	const locations = normalizeEntityItems(existing.locations, 20);
	return {
		...base,
		...(title ? { title } : null),
		...(summary ? { summary } : null),
		...(coreConflict ? { coreConflict } : null),
		...(keywords.length ? { keywords } : null),
		...(characters.length || Array.isArray(existing.characters) ? { characters } : null),
		...(props.length || Array.isArray(existing.props) ? { props } : null),
		...(scenes.length || Array.isArray(existing.scenes) ? { scenes } : null),
		...(locations.length || Array.isArray(existing.locations) ? { locations } : null),
	};
}

function mergeChapterMetaListByChapter(
	allChapters: BookChapterMeta[],
	updates: BookChapterMeta[],
): BookChapterMeta[] {
	const byChapter = new Map<number, BookChapterMeta>();
	for (const item of updates) {
		const n = Number(item?.chapter);
		if (!Number.isFinite(n) || n <= 0) continue;
		byChapter.set(Math.trunc(n), item);
	}
	return allChapters.map((item) => {
		const next = byChapter.get(item.chapter);
		return next ? mergeChapterMetaWithExisting(item, next) : item;
	});
}

function normalizeImportance(value: unknown): "main" | "supporting" | "minor" | undefined {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "main") return "main";
	if (raw === "supporting") return "supporting";
	if (raw === "minor") return "minor";
	return undefined;
}

function normalizeChapterHints(value: unknown, maxItems = 24): number[] {
	if (!Array.isArray(value)) return [];
	const out: number[] = [];
	for (const item of value) {
		const n = Number(item);
		if (!Number.isFinite(n) || n <= 0) continue;
		const v = Math.trunc(n);
		if (out.includes(v)) continue;
		out.push(v);
		if (out.length >= maxItems) break;
	}
	return out.sort((a, b) => a - b);
}

function normalizeSemanticStateKey(value: unknown): string {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

function normalizeAssetConfirmationMode(value: unknown): AssetConfirmationMode | null {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "auto" || raw === "manual") return raw;
	return null;
}

function isRemoteAssetUrl(value: unknown): boolean {
	return /^https?:\/\//i.test(String(value || "").trim());
}

function resolveUpsertConfirmationState(input: {
	status: "draft" | "generated";
	hasExecutableAsset: boolean;
	prevConfirmedAt?: string | null;
	prevConfirmedBy?: string | null;
	prevConfirmationMode?: AssetConfirmationMode | null;
	bodyConfirmed?: boolean;
	bodyConfirmationMode?: AssetConfirmationMode | null;
	nowIso: string;
	userId: string;
}): {
	confirmedAt: string | null;
	confirmedBy: string | null;
	confirmationMode: AssetConfirmationMode | null;
} {
	if (typeof input.bodyConfirmed === "boolean") {
		if (!input.bodyConfirmed) {
			return {
				confirmedAt: null,
				confirmedBy: null,
				confirmationMode: null,
			};
		}
		return {
			confirmedAt: input.nowIso,
			confirmedBy: input.userId,
			confirmationMode: input.bodyConfirmationMode || "manual",
		};
	}
	if (input.prevConfirmationMode === "manual" && input.prevConfirmedAt) {
		return {
			confirmedAt: input.prevConfirmedAt,
			confirmedBy: input.prevConfirmedBy || input.userId,
			confirmationMode: "manual",
		};
	}
	if (input.status === "generated" && input.hasExecutableAsset) {
		return {
			confirmedAt: input.nowIso,
			confirmedBy: input.userId,
			confirmationMode: "auto",
		};
	}
	return {
		confirmedAt:
			typeof input.prevConfirmedAt === "string" && input.prevConfirmedAt.trim()
				? input.prevConfirmedAt.trim()
				: null,
		confirmedBy:
			typeof input.prevConfirmedBy === "string" && input.prevConfirmedBy.trim()
				? input.prevConfirmedBy.trim()
				: null,
		confirmationMode: input.prevConfirmationMode || null,
	};
}

function normalizeBookRoleCards(value: unknown): BookRoleCardRecord[] {
	if (!Array.isArray(value)) return [];
	const out: BookRoleCardRecord[] = [];
	for (const item of value) {
		const cardId = String((item as any)?.cardId || "").trim();
		const roleName = String((item as any)?.roleName || "").trim();
		const statusRaw = String((item as any)?.status || "").trim().toLowerCase();
		const status: "draft" | "generated" =
			statusRaw === "generated" ? "generated" : "draft";
		if (!cardId || !roleName) continue;
		const characterBibleId = String((item as { characterBibleId?: unknown })?.characterBibleId || "").trim();
		const roleId = String((item as any)?.roleId || "").trim();
		const referenceKindRaw = String((item as { referenceKind?: unknown })?.referenceKind || "").trim();
		const referenceKind: StoryboardReferenceCardKind | undefined =
			referenceKindRaw === "single_character" || referenceKindRaw === "group_cast"
				? referenceKindRaw
				: undefined;
		const promptSchemaVersion = String((item as { promptSchemaVersion?: unknown })?.promptSchemaVersion || "").trim();
		const generatedFrom = String((item as { generatedFrom?: unknown })?.generatedFrom || "").trim();
		const stateDescription = String((item as any)?.stateDescription || "").trim();
		const stateKey = normalizeSemanticStateKey((item as { stateKey?: unknown })?.stateKey || stateDescription);
		const ageDescription = String((item as { ageDescription?: unknown })?.ageDescription || "").trim();
		const stateLabel = String((item as { stateLabel?: unknown })?.stateLabel || "").trim();
		const healthStatus = String((item as { healthStatus?: unknown })?.healthStatus || "").trim();
		const injuryStatus = String((item as { injuryStatus?: unknown })?.injuryStatus || "").trim();
		const chapterRaw = Number((item as any)?.chapter);
		const chapter =
			Number.isFinite(chapterRaw) && chapterRaw > 0
				? Math.trunc(chapterRaw)
				: undefined;
		const chapterStartRaw = Number((item as any)?.chapterStart);
		const chapterEndRaw = Number((item as any)?.chapterEnd);
		const chapterStart =
			Number.isFinite(chapterStartRaw) && chapterStartRaw > 0
				? Math.trunc(chapterStartRaw)
				: typeof chapter === "number"
					? chapter
					: undefined;
		const chapterEnd =
			Number.isFinite(chapterEndRaw) && chapterEndRaw > 0
				? Math.trunc(chapterEndRaw)
				: typeof chapterStart === "number"
					? chapterStart
					: undefined;
		const chapterSpan = normalizeChapterHints((item as any)?.chapterSpan, 160);
		const nodeId = String((item as any)?.nodeId || "").trim();
		const prompt = String((item as any)?.prompt || "").trim();
		const modelKey = String((item as any)?.modelKey || "").trim();
		const imageUrl = String((item as any)?.imageUrl || "").trim();
		const threeViewImageUrl = String((item as any)?.threeViewImageUrl || "").trim();
		const confirmationMode = normalizeAssetConfirmationMode(
			(item as { confirmationMode?: unknown })?.confirmationMode,
		);
		const confirmedAtRaw = (item as { confirmedAt?: unknown })?.confirmedAt;
		const confirmedByRaw = (item as { confirmedBy?: unknown })?.confirmedBy;
		const confirmedAt =
			typeof confirmedAtRaw === "string" && confirmedAtRaw.trim()
				? confirmedAtRaw.trim()
				: null;
		const confirmedBy =
			typeof confirmedByRaw === "string" && confirmedByRaw.trim()
				? confirmedByRaw.trim()
				: null;
		const createdAt = String((item as any)?.createdAt || "").trim();
		const updatedAt = String((item as any)?.updatedAt || "").trim();
		const createdBy = String((item as any)?.createdBy || "").trim();
		const updatedBy = String((item as any)?.updatedBy || "").trim();
		out.push({
			cardId,
			roleName,
			status,
			...(characterBibleId ? { characterBibleId } : null),
			...(roleId ? { roleId } : null),
			...(referenceKind ? { referenceKind } : null),
			...(promptSchemaVersion ? { promptSchemaVersion } : null),
			...(generatedFrom ? { generatedFrom } : null),
			...(stateDescription ? { stateDescription } : null),
			...(stateKey ? { stateKey } : null),
			...(ageDescription ? { ageDescription } : null),
			...(stateLabel ? { stateLabel } : null),
			...(healthStatus ? { healthStatus } : null),
			...(injuryStatus ? { injuryStatus } : null),
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(chapterSpan.length ? { chapterSpan } : null),
			...(nodeId ? { nodeId } : null),
			...(prompt ? { prompt } : null),
			...(modelKey ? { modelKey } : null),
			...(imageUrl ? { imageUrl } : null),
			...(threeViewImageUrl ? { threeViewImageUrl } : null),
			confirmationMode,
			confirmedAt,
			confirmedBy,
			createdAt: createdAt || updatedAt || new Date().toISOString(),
			updatedAt: updatedAt || createdAt || new Date().toISOString(),
			createdBy: createdBy || updatedBy || "system",
			updatedBy: updatedBy || createdBy || "system",
		});
		if (out.length >= 500) break;
	}
	return out;
}

function normalizeBookCharacterBibles(value: unknown): BookCharacterBibleRecord[] {
	if (!Array.isArray(value)) return [];
	const out: BookCharacterBibleRecord[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const version = String(record.version || "").trim();
		const id = String(record.id || "").trim();
		const name = String(record.name || "").trim();
		const sourceCharacterId = String(record.sourceCharacterId || "").trim();
		if (!version || !id || !name || !sourceCharacterId) continue;
		const sourceImagesRaw =
			record.sourceImages && typeof record.sourceImages === "object" && !Array.isArray(record.sourceImages)
				? (record.sourceImages as Record<string, unknown>)
				: {};
		const importedImagesRaw =
			record.importedImages && typeof record.importedImages === "object" && !Array.isArray(record.importedImages)
				? (record.importedImages as Record<string, unknown>)
				: {};
		out.push({
			version: version as CharacterBible["version"],
			id,
			name,
			projectId: String(record.projectId || "").trim() || null,
			sourceCharacterId,
			sourceGroupNumber: String(record.sourceGroupNumber || "").trim(),
			identityHint: String(record.identityHint || "").trim(),
			era: String(record.era || "").trim(),
			culturalRegion: String(record.culturalRegion || "").trim(),
			genre: String(record.genre || "").trim(),
			timePeriod: String(record.timePeriod || "").trim(),
			appearanceBackground: String(record.appearanceBackground || "").trim(),
			scene: String(record.scene || "").trim(),
			gender: String(record.gender || "").trim(),
			ageGroup: String(record.ageGroup || "").trim(),
			species: String(record.species || "").trim(),
			physique: String(record.physique || "").trim(),
			heightLevel: String(record.heightLevel || "").trim(),
			skinColor: String(record.skinColor || "").trim(),
			hairLength: String(record.hairLength || "").trim(),
			hairColor: String(record.hairColor || "").trim(),
			temperament: String(record.temperament || "").trim(),
			outfit: String(record.outfit || "").trim(),
			distinctiveFeatures: String(record.distinctiveFeatures || "").trim(),
			filterWorldview: String(record.filterWorldview || "").trim(),
			filterTheme: String(record.filterTheme || "").trim(),
			filterScene: String(record.filterScene || "").trim(),
			sourceImages: {
				fullBody: String(sourceImagesRaw.fullBody || "").trim(),
				threeView: String(sourceImagesRaw.threeView || "").trim(),
				expression: String(sourceImagesRaw.expression || "").trim(),
				closeup: String(sourceImagesRaw.closeup || "").trim(),
			},
			importedImages: {
				fullBody: String(importedImagesRaw.fullBody || "").trim(),
				threeView: String(importedImagesRaw.threeView || "").trim(),
				expression: String(importedImagesRaw.expression || "").trim(),
				closeup: String(importedImagesRaw.closeup || "").trim(),
			},
			importedAt: String(record.importedAt || "").trim(),
			updatedAt: String(record.updatedAt || "").trim(),
			...(String(record.roleCardId || "").trim() ? { roleCardId: String(record.roleCardId || "").trim() } : null),
		});
		if (out.length >= 500) break;
	}
	return out;
}

function normalizeVisualRefCategory(value: unknown): "scene_prop" | "spell_fx" {
	const raw = String(value || "").trim().toLowerCase();
	return raw === "spell_fx" ? "spell_fx" : "scene_prop";
}

function normalizeStoryboardReferenceVisualKind(
	value: unknown,
): StoryboardReferenceVisualKind | undefined {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "scene_prop_grid" || raw === "spell_fx") return raw;
	return undefined;
}

function normalizeVisualRefTags(value: unknown, maxItems = 20): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const tag = String(item || "").trim();
		if (!tag) continue;
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(tag);
		if (out.length >= maxItems) break;
	}
	return out;
}

function buildVisualRefChapterKey(ref: {
	category?: string;
	name?: string;
	stateKey?: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
}): string {
	const category = normalizeVisualRefCategory(ref?.category);
	const nameKey = String(ref?.name || "").trim().toLowerCase();
	const stateKey = normalizeSemanticStateKey(ref?.stateKey);
	const chapterSpan = normalizeChapterHints(ref?.chapterSpan, 160);
	if (chapterSpan.length) {
		return `${category}:${nameKey}#state:${stateKey || "default"}#span:${chapterSpan.join(",")}`;
	}
	const chapterStart =
		typeof ref.chapterStart === "number" && Number.isFinite(ref.chapterStart) && ref.chapterStart > 0
			? Math.trunc(ref.chapterStart)
			: typeof ref.chapter === "number" && Number.isFinite(ref.chapter) && ref.chapter > 0
				? Math.trunc(ref.chapter)
				: 0;
	const chapterEnd =
		typeof ref.chapterEnd === "number" && Number.isFinite(ref.chapterEnd) && ref.chapterEnd > 0
			? Math.trunc(ref.chapterEnd)
			: chapterStart;
	if (chapterStart > 0 || chapterEnd > 0) {
		return `${category}:${nameKey}#state:${stateKey || "default"}#range:${chapterStart}-${chapterEnd}`;
	}
	return `${category}:${nameKey}#state:${stateKey || "default"}#0`;
}

function normalizeBookVisualRefs(value: unknown): BookVisualRefRecord[] {
	if (!Array.isArray(value)) return [];
	const out: BookVisualRefRecord[] = [];
	for (const item of value) {
		const refId = String((item as { refId?: unknown })?.refId || "").trim();
		const name = String((item as { name?: unknown })?.name || "").trim();
		if (!refId || !name) continue;
		const category = normalizeVisualRefCategory((item as { category?: unknown })?.category);
		const referenceKind = normalizeStoryboardReferenceVisualKind(
			(item as { referenceKind?: unknown })?.referenceKind,
		);
		const promptSchemaVersion = String((item as { promptSchemaVersion?: unknown })?.promptSchemaVersion || "").trim();
		const generatedFrom = String((item as { generatedFrom?: unknown })?.generatedFrom || "").trim();
		const statusRaw = String((item as { status?: unknown })?.status || "").trim().toLowerCase();
		const status: "draft" | "generated" = statusRaw === "generated" ? "generated" : "draft";
		const chapterRaw = Number((item as { chapter?: unknown })?.chapter);
		const chapter =
			Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : undefined;
		const chapterStartRaw = Number((item as { chapterStart?: unknown })?.chapterStart);
		const chapterEndRaw = Number((item as { chapterEnd?: unknown })?.chapterEnd);
		const chapterStart =
			Number.isFinite(chapterStartRaw) && chapterStartRaw > 0
				? Math.trunc(chapterStartRaw)
				: typeof chapter === "number"
					? chapter
					: undefined;
		const chapterEnd =
			Number.isFinite(chapterEndRaw) && chapterEndRaw > 0
				? Math.trunc(chapterEndRaw)
				: typeof chapterStart === "number"
					? chapterStart
					: undefined;
		const chapterSpan = normalizeChapterHints((item as { chapterSpan?: unknown })?.chapterSpan, 160);
		const tags = normalizeVisualRefTags((item as { tags?: unknown })?.tags, 20);
		const stateDescription = String((item as { stateDescription?: unknown })?.stateDescription || "").trim();
		const stateKey = normalizeSemanticStateKey(
			(item as { stateKey?: unknown })?.stateKey || stateDescription,
		);
		const nodeId = String((item as { nodeId?: unknown })?.nodeId || "").trim();
		const prompt = String((item as { prompt?: unknown })?.prompt || "").trim();
		const modelKey = String((item as { modelKey?: unknown })?.modelKey || "").trim();
		const imageUrl = String((item as { imageUrl?: unknown })?.imageUrl || "").trim();
		const confirmationMode = normalizeAssetConfirmationMode(
			(item as { confirmationMode?: unknown })?.confirmationMode,
		);
		const confirmedAtRaw = (item as { confirmedAt?: unknown })?.confirmedAt;
		const confirmedByRaw = (item as { confirmedBy?: unknown })?.confirmedBy;
		const confirmedAt =
			typeof confirmedAtRaw === "string" && confirmedAtRaw.trim()
				? confirmedAtRaw.trim()
				: null;
		const confirmedBy =
			typeof confirmedByRaw === "string" && confirmedByRaw.trim()
				? confirmedByRaw.trim()
				: null;
		const createdAt = String((item as { createdAt?: unknown })?.createdAt || "").trim();
		const updatedAt = String((item as { updatedAt?: unknown })?.updatedAt || "").trim();
		const createdBy = String((item as { createdBy?: unknown })?.createdBy || "").trim();
		const updatedBy = String((item as { updatedBy?: unknown })?.updatedBy || "").trim();
		out.push({
			refId,
			category,
			name,
			status,
			...(referenceKind ? { referenceKind } : null),
			...(promptSchemaVersion ? { promptSchemaVersion } : null),
			...(generatedFrom ? { generatedFrom } : null),
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(chapterSpan.length ? { chapterSpan } : null),
			...(tags.length ? { tags } : null),
			...(stateDescription ? { stateDescription } : null),
			...(stateKey ? { stateKey } : null),
			...(nodeId ? { nodeId } : null),
			...(prompt ? { prompt } : null),
			...(modelKey ? { modelKey } : null),
			...(imageUrl ? { imageUrl } : null),
			confirmationMode,
			confirmedAt,
			confirmedBy,
			createdAt: createdAt || updatedAt || new Date().toISOString(),
			updatedAt: updatedAt || createdAt || new Date().toISOString(),
			createdBy: createdBy || updatedBy || "system",
			updatedBy: updatedBy || createdBy || "system",
		});
		if (out.length >= 800) break;
	}
	return out;
}

function normalizeSemanticAssetMediaKind(value: unknown): BookSemanticAssetMediaKind | null {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "image" || raw === "video") return raw;
	return null;
}

function normalizeBookSemanticAssets(value: unknown): BookSemanticAssetRecord[] {
	if (!Array.isArray(value)) return [];
	const out: BookSemanticAssetRecord[] = [];
	for (const item of value) {
		const record =
			item && typeof item === "object" && !Array.isArray(item)
				? (item as Record<string, unknown>)
				: null;
		if (!record) continue;
		const semanticId = String(record.semanticId || "").trim();
		const mediaKind = normalizeSemanticAssetMediaKind(record.mediaKind);
		const statusRaw = String(record.status || "").trim().toLowerCase();
		const status: "draft" | "generated" = statusRaw === "generated" ? "generated" : "draft";
		if (!semanticId || !mediaKind) continue;
		const chapterRaw = Number(record.chapter);
		const chapter =
			Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : undefined;
		const chapterStartRaw = Number(record.chapterStart);
		const chapterEndRaw = Number(record.chapterEnd);
		const chapterStart =
			Number.isFinite(chapterStartRaw) && chapterStartRaw > 0
				? Math.trunc(chapterStartRaw)
				: typeof chapter === "number"
					? chapter
					: undefined;
		const chapterEnd =
			Number.isFinite(chapterEndRaw) && chapterEndRaw > 0
				? Math.trunc(chapterEndRaw)
				: typeof chapterStart === "number"
					? chapterStart
					: undefined;
		const shotNoRaw = Number(record.shotNo);
		const shotNo =
			Number.isFinite(shotNoRaw) && shotNoRaw > 0 ? Math.trunc(shotNoRaw) : undefined;
		const confirmationMode = normalizeAssetConfirmationMode(record.confirmationMode);
		const confirmedAtRaw = record.confirmedAt;
		const confirmedByRaw = record.confirmedBy;
		const confirmedAt =
			typeof confirmedAtRaw === "string" && confirmedAtRaw.trim()
				? confirmedAtRaw.trim()
				: null;
		const confirmedBy =
			typeof confirmedByRaw === "string" && confirmedByRaw.trim()
				? confirmedByRaw.trim()
				: null;
		const createdAt = String(record.createdAt || "").trim();
		const updatedAt = String(record.updatedAt || "").trim();
		const createdBy = String(record.createdBy || "").trim();
		const updatedBy = String(record.updatedBy || "").trim();
		const anchorBindings = normalizePublicFlowAnchorBindings(record.anchorBindings);
		out.push({
			semanticId,
			mediaKind,
			status,
			...(String(record.nodeId || "").trim() ? { nodeId: String(record.nodeId).trim() } : null),
			...(String(record.nodeKind || "").trim() ? { nodeKind: String(record.nodeKind).trim() } : null),
			...(String(record.taskId || "").trim() ? { taskId: String(record.taskId).trim() } : null),
			...(String(record.planId || "").trim() ? { planId: String(record.planId).trim() } : null),
			...(String(record.chunkId || "").trim() ? { chunkId: String(record.chunkId).trim() } : null),
			...(String(record.imageUrl || "").trim() ? { imageUrl: String(record.imageUrl).trim() } : null),
			...(String(record.videoUrl || "").trim() ? { videoUrl: String(record.videoUrl).trim() } : null),
			...(String(record.thumbnailUrl || "").trim()
				? { thumbnailUrl: String(record.thumbnailUrl).trim() }
				: null),
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(normalizeChapterHints(record.chapterSpan, 160).length
				? { chapterSpan: normalizeChapterHints(record.chapterSpan, 160) }
				: null),
			...(typeof shotNo === "number" ? { shotNo } : null),
			...(String(record.stateDescription || "").trim()
				? { stateDescription: String(record.stateDescription).trim() }
				: null),
			...(String(record.prompt || "").trim() ? { prompt: String(record.prompt).trim() } : null),
			...(anchorBindings.length ? { anchorBindings } : null),
			...(String(record.productionLayer || "").trim()
				? { productionLayer: String(record.productionLayer).trim() }
				: null),
			...(String(record.creationStage || "").trim()
				? { creationStage: String(record.creationStage).trim() }
				: null),
			...(String(record.approvalStatus || "").trim()
				? { approvalStatus: String(record.approvalStatus).trim() }
				: null),
			confirmationMode,
			confirmedAt,
			confirmedBy,
			createdAt: createdAt || updatedAt || new Date().toISOString(),
			updatedAt: updatedAt || createdAt || new Date().toISOString(),
			createdBy: createdBy || updatedBy || "system",
			updatedBy: updatedBy || createdBy || "system",
		});
		if (out.length >= 2000) break;
	}
	return out;
}

function resolveRoleStartChapterFromAssets(input: {
	assets: Record<string, unknown>;
	roleName: string;
	roleId?: string;
}): number | null {
	const roleNameKey = String(input.roleName || "").trim().toLowerCase();
	const roleIdKey = String(input.roleId || "").trim().toLowerCase();
	const graphNodes = Array.isArray((input.assets as any)?.characterGraph?.nodes)
		? (((input.assets as any).characterGraph.nodes || []) as Array<any>)
		: [];
	for (const node of graphNodes) {
		const nodeId = String(node?.id || "").trim().toLowerCase();
		const nodeName = String(node?.name || "").trim().toLowerCase();
		if (!nodeId && !nodeName) continue;
		if (
			(roleIdKey && nodeId === roleIdKey) ||
			(roleNameKey && nodeName === roleNameKey)
		) {
			const unlockChapter = Number(node?.unlockChapter);
			if (Number.isFinite(unlockChapter) && unlockChapter > 0) return Math.trunc(unlockChapter);
			const firstChapter = Number(node?.firstChapter);
			if (Number.isFinite(firstChapter) && firstChapter > 0) return Math.trunc(firstChapter);
			const span = normalizeChapterHints(node?.chapterSpan, 64);
			if (span.length) return span[0]!;
		}
	}
	const profiles = Array.isArray((input.assets as any)?.characterProfiles)
		? (((input.assets as any).characterProfiles || []) as Array<any>)
		: [];
	for (const role of profiles) {
		const profileId = String(role?.id || "").trim().toLowerCase();
		const profileName = String(role?.name || "").trim().toLowerCase();
		if (!profileId && !profileName) continue;
		if (
			(roleIdKey && profileId === roleIdKey) ||
			(roleNameKey && profileName === roleNameKey)
		) {
			const firstChapter = Number(role?.firstChapter);
			if (Number.isFinite(firstChapter) && firstChapter > 0) return Math.trunc(firstChapter);
			const span = normalizeChapterHints(role?.chapterSpan, 64);
			if (span.length) return span[0]!;
		}
	}
	return null;
}

function buildRoleCardChapterKey(card: BookRoleCardRecord): string {
	const roleKey = String(card.roleId || card.roleName || "").trim().toLowerCase();
	const stateKey = normalizeSemanticStateKey(card.stateKey || card.stateDescription);
	const chapterSpan = normalizeChapterHints(card.chapterSpan, 160);
	if (chapterSpan.length) {
		return `${roleKey}#state:${stateKey || "default"}#span:${chapterSpan.join(",")}`;
	}
	const chapterStart =
		typeof card.chapterStart === "number" && Number.isFinite(card.chapterStart) && card.chapterStart > 0
			? Math.trunc(card.chapterStart)
			: typeof card.chapter === "number" && Number.isFinite(card.chapter) && card.chapter > 0
				? Math.trunc(card.chapter)
				: 0;
	const chapterEnd =
		typeof card.chapterEnd === "number" && Number.isFinite(card.chapterEnd) && card.chapterEnd > 0
			? Math.trunc(card.chapterEnd)
			: chapterStart;
	if (chapterStart > 0 || chapterEnd > 0) {
		return `${roleKey}#state:${stateKey || "default"}#range:${chapterStart}-${chapterEnd}`;
	}
	return `${roleKey}#state:${stateKey || "default"}#0`;
}

function buildSemanticAssetScopeKey(asset: {
	semanticId?: string;
	nodeId?: string;
	mediaKind?: BookSemanticAssetMediaKind | null;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
	shotNo?: number;
}): string {
	const semanticId = String(asset.semanticId || "").trim();
	if (semanticId) return `semantic:${semanticId}`;
	const mediaKind = normalizeSemanticAssetMediaKind(asset.mediaKind) || "image";
	const nodeId = String(asset.nodeId || "").trim();
	const chapterSpan = normalizeChapterHints(asset.chapterSpan, 160);
	const shotNo =
		typeof asset.shotNo === "number" && Number.isFinite(asset.shotNo) && asset.shotNo > 0
			? Math.trunc(asset.shotNo)
			: 0;
	if (chapterSpan.length) {
		return `${mediaKind}:${nodeId || "__node__"}#shot:${shotNo}#span:${chapterSpan.join(",")}`;
	}
	const chapterStart =
		typeof asset.chapterStart === "number" && Number.isFinite(asset.chapterStart) && asset.chapterStart > 0
			? Math.trunc(asset.chapterStart)
			: typeof asset.chapter === "number" && Number.isFinite(asset.chapter) && asset.chapter > 0
				? Math.trunc(asset.chapter)
				: 0;
	const chapterEnd =
		typeof asset.chapterEnd === "number" && Number.isFinite(asset.chapterEnd) && asset.chapterEnd > 0
			? Math.trunc(asset.chapterEnd)
			: chapterStart;
	return `${mediaKind}:${nodeId || "__node__"}#shot:${shotNo}#range:${chapterStart}-${chapterEnd}`;
}

function normalizeBookStoryboardPlans(value: unknown): BookStoryboardPlanRecord[] {
	if (!Array.isArray(value)) return [];
	const out: BookStoryboardPlanRecord[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new AppError("storyboard plan 持久化记录必须是对象", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const record = item as Record<string, unknown>;
		const taskId = String(record.taskId || "").trim();
		const planId = String(record.planId || "").trim();
		const chapter = normalizeOptionalPositiveChapter(record.chapter);
		if (!taskId || !planId || !chapter) {
			throw new AppError("storyboard plan 缺少 planId、taskId 或 chapter", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const artifactRecord =
			record.storyboardArtifact && typeof record.storyboardArtifact === "object" && !Array.isArray(record.storyboardArtifact)
				? record.storyboardArtifact as Record<string, unknown>
				: null;
		const storyFactsContext =
			artifactRecord?.storyFactsContext && typeof artifactRecord.storyFactsContext === "object" && !Array.isArray(artifactRecord.storyFactsContext)
				? artifactRecord.storyFactsContext as Record<string, unknown>
				: null;
		const artifactBookId = String(storyFactsContext?.bookId || "").trim();
		if (!artifactRecord || !artifactBookId) {
			throw new AppError("storyboard plan 缺少 v1.2 artifact 或 bookId", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const persistencePayload = requireStoryboardV12ArtifactPayload({
			storyboardStructured: artifactRecord,
			shotPrompts: record.shotPrompts,
			maxShotPrompts: 1_200,
			contextLabel: "stored storyboard plan",
		});
		const taskTitle = String(record.taskTitle || "").trim();
		const modeRaw = String(record.mode || "").trim().toLowerCase();
		const mode: "single" | "full" = modeRaw === "full" ? "full" : "single";
		const groupSize = normalizeStoryboardGroupSize(record.groupSize);
		const createdAt = String(record.createdAt || "").trim();
		const updatedAt = String(record.updatedAt || "").trim();
		const createdBy = String(record.createdBy || "").trim();
		const updatedBy = String(record.updatedBy || "").trim();
		const outputAssetId = String(record.outputAssetId || "").trim();
		const runId = String(record.runId || "").trim();
		const nextChunkRecord =
			record.nextChunkIndexByGroup && typeof record.nextChunkIndexByGroup === "object" && !Array.isArray(record.nextChunkIndexByGroup)
				? record.nextChunkIndexByGroup as Record<string, unknown>
				: {};
		const next1Raw = Number(nextChunkRecord["1"]);
		const next4Raw = Number(nextChunkRecord["4"]);
		const next9Raw = Number(nextChunkRecord["9"]);
		const next25Raw = Number(nextChunkRecord["25"]);
		const nextChunkIndexByGroup = {
			...(Number.isFinite(next1Raw) && next1Raw >= 0 ? { "1": Math.trunc(next1Raw) } : null),
			...(Number.isFinite(next4Raw) && next4Raw >= 0 ? { "4": Math.trunc(next4Raw) } : null),
			...(Number.isFinite(next9Raw) && next9Raw >= 0 ? { "9": Math.trunc(next9Raw) } : null),
			...(Number.isFinite(next25Raw) && next25Raw >= 0 ? { "25": Math.trunc(next25Raw) } : null),
		};
		out.push({
			planId,
			taskId,
			...(chapter ? { chapter } : null),
			...(taskTitle ? { taskTitle } : null),
			mode,
			groupSize,
			...(outputAssetId ? { outputAssetId } : null),
			...(runId ? { runId } : null),
			storyboardContent: JSON.stringify(persistencePayload.artifact, null, 2),
			storyboardArtifact: persistencePayload.artifact,
			artifactSha256: persistencePayload.artifactSha256,
			storyboardStructured: persistencePayload.structured,
			...(record.semanticReview !== undefined ? { semanticReview: record.semanticReview } : null),
			shotPrompts: persistencePayload.shotPrompts,
			...(Object.keys(nextChunkIndexByGroup).length ? { nextChunkIndexByGroup } : null),
			createdAt: createdAt || updatedAt || new Date().toISOString(),
			updatedAt: updatedAt || createdAt || new Date().toISOString(),
			createdBy: createdBy || updatedBy || "system",
			updatedBy: updatedBy || createdBy || "system",
		});
		if (out.length >= 200) break;
	}
	return out.sort((a, b) => String(a.taskId || "").localeCompare(String(b.taskId || "")));
}

function normalizeBookStoryboardChunks(value: unknown): BookStoryboardChunkRecord[] {
	if (!Array.isArray(value)) return [];
	const out: BookStoryboardChunkRecord[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new AppError("storyboard chunk 持久化记录必须是对象", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const record = item as Record<string, unknown>;
		const taskId = String(record.taskId || "").trim();
		const chapter = normalizeOptionalPositiveChapter(record.chapter);
		if (!taskId || !chapter) {
			throw new AppError("storyboard chunk 缺少 taskId 或 chapter", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const groupSize = normalizeStoryboardGroupSize(record.groupSize);
		const chunkIndexRaw = Number(record.chunkIndex);
		const chunkIndex =
			Number.isFinite(chunkIndexRaw) && chunkIndexRaw >= 0
				? Math.trunc(chunkIndexRaw)
				: 0;
		const shotStartRaw = Number(record.shotStart);
		const shotStart =
			Number.isFinite(shotStartRaw) && shotStartRaw > 0
				? Math.trunc(shotStartRaw)
				: chunkIndex * groupSize + 1;
		const shotEndRaw = Number(record.shotEnd);
		const shotEnd =
			Number.isFinite(shotEndRaw) && shotEndRaw >= shotStart
				? Math.trunc(shotEndRaw)
				: shotStart + groupSize - 1;
		const planId = String(record.planId || "").trim();
		if (!planId) {
			throw new AppError("storyboard chunk 缺少 planId", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const chunkId =
			String(record.chunkId || "").trim() ||
			`plan-${planId}-g${groupSize}-i${chunkIndex}`;
		const previousChunkId = String(record.previousChunkId || "").trim();
		if (chunkIndex > 0 && !previousChunkId) {
			throw new AppError("storyboard chunk 缺少 previousChunkId", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const nodeId = String(record.nodeId || "").trim();
		const prompt = String(record.prompt || "").trim();
		const frameUrls = Array.isArray(record.frameUrls)
			? record.frameUrls
					.map((value) => String(value || "").trim())
					.filter(Boolean)
					.slice(0, 64)
			: [];
		const artifactRecord =
			record.storyboardArtifact && typeof record.storyboardArtifact === "object" && !Array.isArray(record.storyboardArtifact)
				? record.storyboardArtifact as Record<string, unknown>
				: null;
		const storyFactsContext =
			artifactRecord?.storyFactsContext && typeof artifactRecord.storyFactsContext === "object" && !Array.isArray(artifactRecord.storyFactsContext)
				? artifactRecord.storyFactsContext as Record<string, unknown>
				: null;
		const artifactBookId = String(storyFactsContext?.bookId || "").trim();
		if (!artifactRecord || !artifactBookId) {
			throw new AppError("storyboard chunk 缺少 v1.2 artifact 或 bookId", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const persistencePayload = requireStoryboardV12ArtifactPayload({
			storyboardStructured: artifactRecord,
			shotPrompts: record.shotPrompts,
			maxShotPrompts: 128,
			contextLabel: "stored storyboard chunk",
		});
		const handoffEvidence = normalizeStoryboardHandoffEvidence(record.handoffEvidence);
		if (chunkIndex > 0 && !handoffEvidence) {
			throw new AppError("storyboard chunk 缺少有效的跨分组 handoffEvidence", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const tailFrameUrl = String(record.tailFrameUrl || "").trim();
		if (!tailFrameUrl) {
			throw new AppError("storyboard chunk 缺少显式 tailFrameUrl", {
				status: 409,
				code: "storyboard_persistence_record_invalid",
			});
		}
		const roleCardRefIds = Array.isArray(record.roleCardRefIds)
			? record.roleCardRefIds
					.map((value) => String(value || "").trim())
					.filter(Boolean)
					.slice(0, 24)
			: [];
		const scenePropRefId = String(record.scenePropRefId || "").trim();
		const scenePropRefLabel = String(record.scenePropRefLabel || "").trim();
		const spellFxRefId = String(record.spellFxRefId || "").trim();
		const spellFxRefLabel = String(record.spellFxRefLabel || "").trim();
		const createdAt = String(record.createdAt || "").trim();
		const updatedAt = String(record.updatedAt || "").trim();
		const createdBy = String(record.createdBy || "").trim();
		const updatedBy = String(record.updatedBy || "").trim();
		out.push({
			chunkId,
			planId,
			...(previousChunkId ? { previousChunkId } : null),
			taskId,
			...(chapter ? { chapter } : null),
			groupSize,
			chunkIndex,
			shotStart,
			shotEnd,
			...(nodeId ? { nodeId } : null),
			...(prompt ? { prompt } : null),
			storyboardArtifact: persistencePayload.artifact,
			artifactSha256: persistencePayload.artifactSha256,
			storyboardStructured: persistencePayload.structured,
			...(record.semanticReview !== undefined ? { semanticReview: record.semanticReview } : null),
			...(handoffEvidence ? { handoffEvidence } : null),
			shotPrompts: persistencePayload.shotPrompts,
			frameUrls,
			tailFrameUrl,
			...(roleCardRefIds.length ? { roleCardRefIds } : null),
			...(scenePropRefId ? { scenePropRefId } : null),
			...(scenePropRefLabel ? { scenePropRefLabel } : null),
			...(spellFxRefId ? { spellFxRefId } : null),
			...(spellFxRefLabel ? { spellFxRefLabel } : null),
			createdAt: createdAt || updatedAt || new Date().toISOString(),
			updatedAt: updatedAt || createdAt || new Date().toISOString(),
			createdBy: createdBy || updatedBy || "system",
			updatedBy: updatedBy || createdBy || "system",
		});
		if (out.length >= 2000) break;
	}
	return out.sort((a, b) => {
		const taskSort = String(a.taskId || "").localeCompare(String(b.taskId || ""));
		if (taskSort !== 0) return taskSort;
		return a.chunkIndex - b.chunkIndex;
	});
}

function normalizeCharacterProfiles(value: unknown): BookCharacterProfile[] {
	if (!Array.isArray(value)) return [];
	const out: BookCharacterProfile[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const name = String((item as any)?.name || "").trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const description = String((item as any)?.description || "").trim();
		const importance = normalizeImportance((item as any)?.importance);
		const chapterSpan = normalizeChapterHints((item as any)?.chapterSpan, 48);
		const firstChapterRaw = Number((item as any)?.firstChapter);
		const firstChapter =
			Number.isFinite(firstChapterRaw) && firstChapterRaw > 0
				? Math.trunc(firstChapterRaw)
				: chapterSpan[0];
		const lastChapterRaw = Number((item as any)?.lastChapter);
		const lastChapter =
			Number.isFinite(lastChapterRaw) && lastChapterRaw > 0
				? Math.trunc(lastChapterRaw)
				: chapterSpan[chapterSpan.length - 1];
		const stageFormsRaw = Array.isArray((item as any)?.stageForms) ? (item as any).stageForms : [];
		const stageForms: BookCharacterStageForm[] = [];
		for (const stage of stageFormsRaw) {
			const stageName = String(stage?.stage || "").trim();
			if (!stageName) continue;
			const look = String(stage?.look || "").trim();
			const costume = String(stage?.costume || "").trim();
			const emotion = String(stage?.emotion || "").trim();
			const props = normalizeKeywords(stage?.props);
			const chapterHints = normalizeChapterHints(stage?.chapterHints, 16);
			stageForms.push({
				stage: stageName,
				...(look ? { look } : null),
				...(costume ? { costume } : null),
				...(emotion ? { emotion } : null),
				...(props.length ? { props } : null),
				...(chapterHints.length ? { chapterHints } : null),
			});
		}
		out.push({
			name,
			...(description ? { description } : null),
			...(importance ? { importance } : null),
			...(typeof firstChapter === "number" ? { firstChapter } : null),
			...(typeof lastChapter === "number" ? { lastChapter } : null),
			...(chapterSpan.length ? { chapterSpan } : null),
			...(stageForms.length ? { stageForms } : null),
		});
		if (out.length >= 60) break;
	}
	return out;
}

function buildBookStyleBible(input: {
	title: string;
	raw: string;
	characterProfiles: BookCharacterProfile[];
	styleName: string;
	visualDirectives?: string[];
	negativeDirectives?: string[];
	consistencyRules?: string[];
}): BookStyleBible {
	const styleName = String(input.styleName || "").trim();
	if (!styleName) {
		throw new Error("agents-cli style bible styleName is empty");
	}
	const castNames = input.characterProfiles
		.slice(0, 10)
		.map((x) => x.name)
		.filter(Boolean)
		.join("、");
	const castHint = castNames ? `核心角色：${castNames}` : "核心角色：按章节主角群";
	const visualDirectives = Array.isArray(input.visualDirectives)
		? input.visualDirectives.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12)
		: [];
	const negativeDirectives = Array.isArray(input.negativeDirectives)
		? input.negativeDirectives.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12)
		: [];
	const consistencyRules = Array.isArray(input.consistencyRules)
		? input.consistencyRules.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12)
		: [];
	const visualWithCast = visualDirectives.length
		? [...visualDirectives, ...(visualDirectives.includes(castHint) ? [] : [castHint])]
		: [
				`${styleName}，强调统一时代质感与镜头语言`,
				"人物服装、发型、年龄感在章节间保持稳定，仅按阶段形态变化",
				"采用电影级构图与光影，保持镜头连续性与空间一致性",
				castHint,
			];
	return {
		styleId: `style-${Date.now()}`,
		styleName,
		styleLocked: true,
		mainCharacterCardsConfirmedAt: null,
		mainCharacterCardsConfirmedBy: null,
		confirmedAt: null,
		confirmedBy: null,
		visualDirectives: visualWithCast.slice(0, 12),
		negativeDirectives: negativeDirectives.length
			? negativeDirectives
			: [
					"禁止同名角色在不同章节出现明显换脸/换体型",
					"禁止无剧情依据的服装与发色突变",
					"禁止背景时代风格跳变",
					"禁止低清晰度、畸形肢体、额外水印文字",
				],
		consistencyRules: consistencyRules.length
			? consistencyRules
			: [
					"角色首次确认形象后，后续章节必须复用同一角色卡特征",
					"新角色必须写入全书关系网后才能加入章节生产",
					"章节镜头应复用 style bible 的光影与色调规则",
				],
	};
}

async function inferBookStyleBibleWithAgents(
	c: AppContext,
	userId: string,
	input: {
		title: string;
		raw: string;
		characterProfiles: BookCharacterProfile[];
		prevIndex?: any | null;
	},
): Promise<{
	styleName: string;
	visualDirectives: string[];
	negativeDirectives: string[];
	consistencyRules: string[];
}> {
	const prevStyle =
		input.prevIndex && typeof input.prevIndex?.assets?.styleBible === "object"
			? (input.prevIndex.assets.styleBible as any)
			: null;
	const prevStyleName = String(prevStyle?.styleName || "").trim();
	if (prevStyleName) {
		return {
			styleName: prevStyleName,
			visualDirectives: Array.isArray(prevStyle?.visualDirectives)
				? prevStyle.visualDirectives.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
				: [],
			negativeDirectives: Array.isArray(prevStyle?.negativeDirectives)
				? prevStyle.negativeDirectives.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
				: [],
			consistencyRules: Array.isArray(prevStyle?.consistencyRules)
				? prevStyle.consistencyRules.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
				: [],
		};
	}

	const profileOutline = input.characterProfiles.slice(0, 20).map((x) => ({
		name: x.name,
		description: x.description || "",
		importance: x.importance || "minor",
		firstChapter: x.firstChapter || null,
		lastChapter: x.lastChapter || null,
	}));
	const prompt = [
		"你是 TapCanvas 全书风格总监。请基于小说内容进行语义理解，输出全书统一视觉风格方案。",
		"禁止使用正则/关键词匹配思路，必须基于语义与叙事气质判断。",
		'严格输出 JSON：{"styleName":"...","visualDirectives":["..."],"negativeDirectives":["..."],"consistencyRules":["..."]}',
		"要求：",
		"- styleName 必须是可执行的中文风格名",
		"- visualDirectives 4-10 条，描述镜头语言、光影、时代质感与色彩倾向",
		"- negativeDirectives 3-8 条，明确禁止项",
		"- consistencyRules 3-8 条，强调跨章节一致性",
		"- 不要输出 markdown，不要解释文字",
		JSON.stringify({
			title: input.title,
			rawExcerpt: String(input.raw || "").slice(0, 8000),
			characterProfiles: profileOutline,
		}),
	].join("\n");
	const result = await runAgentsBridgeChatTask(c, userId, {
		kind: "chat",
		prompt,
		extras: {
			bridgeTimeoutMs: getAgentsBridgeTimeoutByMode("standard"),
			modelKey: STORYBOARD_GOVERNANCE_MODEL_KEY,
		},
	});
	const text = typeof (result as any)?.raw?.text === "string" ? (result as any).raw.text : "";
	const parsed = extractFirstJsonObject(text) as any;
	const styleName = String(parsed?.styleName || "").trim();
	if (!styleName) {
		throw new Error("agents-cli style bible styleName is empty");
	}
	const visualDirectives = Array.isArray(parsed?.visualDirectives)
		? parsed.visualDirectives.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
		: [];
	const negativeDirectives = Array.isArray(parsed?.negativeDirectives)
		? parsed.negativeDirectives.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
		: [];
	const consistencyRules = Array.isArray(parsed?.consistencyRules)
		? parsed.consistencyRules.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
		: [];
	if (!visualDirectives.length || !negativeDirectives.length || !consistencyRules.length) {
		throw new Error("agents-cli style bible fields incomplete");
	}
	return {
		styleName,
		visualDirectives,
		negativeDirectives,
		consistencyRules,
	};
}

function normalizeGraphNodes(
	value: unknown,
): BookCharacterGraphNode[] {
	if (!Array.isArray(value)) return [];
	const out: BookCharacterGraphNode[] = [];
	const seenId = new Set<string>();
	const seenName = new Set<string>();
	for (const item of value) {
		const name = String((item as any)?.name || "").trim();
		if (!name) continue;
		const nameKey = normalizeGraphNodeNameKey(name);
		if (!nameKey || seenName.has(nameKey)) continue;
		const id = normalizeGraphNodeId((item as any)?.id || name) || toGraphNodeId(name);
		if (!id || seenId.has(id)) continue;
		seenName.add(nameKey);
		seenId.add(id);
		const unlockChapterRaw = Number((item as any)?.unlockChapter);
		const unlockChapter =
			Number.isFinite(unlockChapterRaw) && unlockChapterRaw > 0
				? Math.trunc(unlockChapterRaw)
				: undefined;
		const firstChapterRaw = Number((item as any)?.firstChapter);
		const firstChapter =
			Number.isFinite(firstChapterRaw) && firstChapterRaw > 0
				? Math.trunc(firstChapterRaw)
				: undefined;
		const lastChapterRaw = Number((item as any)?.lastChapter);
		const lastChapter =
			Number.isFinite(lastChapterRaw) && lastChapterRaw > 0
				? Math.trunc(lastChapterRaw)
				: undefined;
		const chapterSpan = normalizeChapterHints((item as any)?.chapterSpan, 64);
		const importance = normalizeImportance((item as any)?.importance);
		out.push({
			id,
			name,
			...(importance ? { importance } : null),
			...(typeof firstChapter === "number" ? { firstChapter } : null),
			...(typeof lastChapter === "number" ? { lastChapter } : null),
			...(chapterSpan.length ? { chapterSpan } : null),
			...(typeof unlockChapter === "number" ? { unlockChapter } : null),
		});
		if (out.length >= 400) break;
	}
	return out;
}

function normalizeGraphEdges(
	value: unknown,
	validNodeIds: Set<string>,
): BookCharacterGraphEdge[] {
	if (!Array.isArray(value)) return [];
	const out: BookCharacterGraphEdge[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const sourceId = normalizeGraphNodeId((item as any)?.sourceId);
		const targetId = normalizeGraphNodeId((item as any)?.targetId);
		if (!sourceId || !targetId || sourceId === targetId) continue;
		if (!validNodeIds.has(sourceId) || !validNodeIds.has(targetId)) continue;
		const relation = normalizeGraphRelation((item as any)?.relation);
		const directedRaw = Boolean((item as any)?.directed);
		const directed = directedRaw || isDirectedRelation(relation);
		const pair = directed ? [sourceId, targetId] : [sourceId, targetId].sort();
		const key = directed
			? `${pair[0]}->${pair[1]}::${relation}`
			: `${pair[0]}::${pair[1]}::${relation}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const weightRaw = Number((item as any)?.weight);
		const weight =
			Number.isFinite(weightRaw) && weightRaw > 0
				? Math.max(1, Math.min(99, Math.trunc(weightRaw)))
				: 1;
		const chapterHints = normalizeChapterHints((item as any)?.chapterHints, 48);
		out.push({
			sourceId: pair[0],
			targetId: pair[1],
			relation,
			weight,
			chapterHints,
			directed,
		});
		if (out.length >= 1200) break;
	}
	return out;
}

function hashGraphId(input: string): string {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function normalizeGraphNodeId(value: unknown): string {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function normalizeGraphNodeNameKey(value: unknown): string {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "");
}

function toGraphNodeId(value: string): string {
	const raw = String(value || "").trim();
	const id = normalizeGraphNodeId(raw);
	if (id) return id;
	return `role-${hashGraphId(raw.toLowerCase() || "unknown")}`;
}

function buildLocalCharacterProfiles(chapters: BookChapterMeta[]): BookCharacterProfile[] {
	const chapterList = Array.isArray(chapters) ? chapters : [];
	if (!chapterList.length) return [];

	const byName = new Map<
		string,
		{
			name: string;
			chapters: Set<number>;
			description: string;
			mentions: number;
		}
	>();

	for (const chapter of chapterList) {
		const chapterNo = Math.max(1, Math.trunc(Number(chapter?.chapter || 1)));
		const roles = Array.isArray(chapter?.characters) ? chapter.characters : [];
		for (const role of roles) {
			const rawName = String(role?.name || "").trim();
			if (!rawName) continue;
			const key = rawName.toLowerCase();
			const desc = String(role?.description || "").trim();
			const prev = byName.get(key);
			if (!prev) {
				byName.set(key, {
					name: rawName,
					chapters: new Set([chapterNo]),
					description: desc,
					mentions: 1,
				});
				continue;
			}
			prev.chapters.add(chapterNo);
			prev.mentions += 1;
			if (!prev.description && desc) prev.description = desc;
		}
	}

	const rows = Array.from(byName.values()).map((entry) => {
		const chapterSpan = Array.from(entry.chapters).sort((a, b) => a - b);
		const firstChapter = chapterSpan[0] || 1;
		const lastChapter = chapterSpan[chapterSpan.length - 1] || firstChapter;
		return {
			...entry,
			chapterSpan,
			firstChapter,
			lastChapter,
		};
	});

	rows.sort((a, b) => {
		if (b.chapters.size !== a.chapters.size) return b.chapters.size - a.chapters.size;
		if (b.mentions !== a.mentions) return b.mentions - a.mentions;
		return a.firstChapter - b.firstChapter;
	});

	const mainCut = Math.max(1, Math.min(6, Math.ceil(rows.length * 0.2)));
	const supportingCut = Math.max(mainCut + 1, Math.min(18, Math.ceil(rows.length * 0.55)));

	return rows.slice(0, 80).map((row, idx) => {
		const importance: BookCharacterProfile["importance"] =
			idx < mainCut ? "main" : idx < supportingCut ? "supporting" : "minor";
		return {
			name: row.name,
			...(row.description ? { description: row.description } : null),
			importance,
			firstChapter: row.firstChapter,
			lastChapter: row.lastChapter,
			chapterSpan: row.chapterSpan,
		};
	});
}

function buildLocalCharacterGraph(input: {
	chapters: BookChapterMeta[];
	characterProfiles: BookCharacterProfile[];
}): BookCharacterGraph {
	const profiles = Array.isArray(input.characterProfiles) ? input.characterProfiles : [];
	const nodes: BookCharacterGraphNode[] = [];
	const idByName = new Map<string, string>();
	for (const role of profiles) {
		const name = String(role?.name || "").trim();
		if (!name) continue;
		const id = toGraphNodeId(name);
		idByName.set(name.toLowerCase(), id);
		const firstChapter =
			typeof role.firstChapter === "number" && Number.isFinite(role.firstChapter)
				? Math.trunc(role.firstChapter)
				: Array.isArray(role.chapterSpan) && role.chapterSpan.length
					? Math.trunc(role.chapterSpan[0]!)
					: 1;
		const lastChapter =
			typeof role.lastChapter === "number" && Number.isFinite(role.lastChapter)
				? Math.trunc(role.lastChapter)
				: Array.isArray(role.chapterSpan) && role.chapterSpan.length
					? Math.trunc(role.chapterSpan[role.chapterSpan.length - 1]!)
					: firstChapter;
		nodes.push({
			id,
			name,
			importance: role.importance || "minor",
			firstChapter,
			lastChapter,
			chapterSpan: Array.isArray(role.chapterSpan) ? role.chapterSpan : [firstChapter],
			unlockChapter: firstChapter,
		});
	}

	const edgeMap = new Map<string, BookCharacterGraphEdge>();
	for (const chapter of input.chapters || []) {
		const chapterNo = Math.max(1, Math.trunc(chapter.chapter || 1));
		const chars = Array.isArray(chapter.characters) ? chapter.characters : [];
		const ids = chars
			.map((it) => {
				const name = String(it?.name || "").trim().toLowerCase();
				if (!name) return null;
				const known = idByName.get(name);
				if (known) return known;
				const generated = toGraphNodeId(name);
				idByName.set(name, generated);
				nodes.push({
					id: generated,
					name,
					importance: "minor",
					firstChapter: chapterNo,
					lastChapter: chapterNo,
					chapterSpan: [chapterNo],
					unlockChapter: chapterNo,
				});
				return generated;
			})
			.filter(Boolean) as string[];
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const pair = [ids[i], ids[j]].sort();
				const key = `${pair[0]}::${pair[1]}`;
				const prev = edgeMap.get(key);
				if (!prev) {
					edgeMap.set(key, {
						sourceId: pair[0],
						targetId: pair[1],
						relation: "coappear",
						weight: 1,
						chapterHints: [chapterNo],
						directed: false,
					});
				} else {
					prev.weight = Math.min(99, prev.weight + 1);
					if (!prev.chapterHints.includes(chapterNo)) prev.chapterHints.push(chapterNo);
				}
			}
		}
	}
	const dedupNodes = new Map<string, BookCharacterGraphNode>();
	for (const n of nodes) {
		if (!n?.id) continue;
		if (!dedupNodes.has(n.id)) dedupNodes.set(n.id, n);
	}
	return {
		nodes: Array.from(dedupNodes.values()),
		edges: Array.from(edgeMap.values()),
	};
}

function mergeGraphUnlockHints(
	next: BookCharacterGraph,
	prev: any,
): BookCharacterGraph {
	const prevNodes = Array.isArray(prev?.assets?.characterGraph?.nodes)
		? (prev.assets.characterGraph.nodes as any[])
		: [];
	const byName = new Map<string, number>();
	const byId = new Map<string, number>();
	for (const item of prevNodes) {
		const unlockRaw = Number(item?.unlockChapter);
		const unlock =
			Number.isFinite(unlockRaw) && unlockRaw > 0 ? Math.trunc(unlockRaw) : null;
		if (unlock == null) continue;
		const name = String(item?.name || "").trim().toLowerCase();
		const id = String(item?.id || "").trim().toLowerCase();
		if (name) byName.set(name, unlock);
		if (id) byId.set(id, unlock);
	}
	const nodes = next.nodes.map((node) => {
		const keyName = String(node.name || "").trim().toLowerCase();
		const keyId = String(node.id || "").trim().toLowerCase();
		const unlock = byId.get(keyId) ?? byName.get(keyName);
		if (typeof unlock !== "number") return node;
		return {
			...node,
			unlockChapter: unlock,
		};
	});
	return { ...next, nodes };
}

function mergeCharacterGraph(
	base: BookCharacterGraph,
	incoming: BookCharacterGraph,
): BookCharacterGraph {
	const baseNodes = Array.isArray(base?.nodes) ? base.nodes : [];
	const incomingNodes = Array.isArray(incoming?.nodes) ? incoming.nodes : [];
	const byCanonical = new Map<string, BookCharacterGraphNode>();
	const idAliasToCanonical = new Map<string, string>();
	const toCanonicalKey = (node: BookCharacterGraphNode): string => {
		const nameKey = normalizeGraphNodeNameKey(node?.name);
		if (nameKey) return `name:${nameKey}`;
		const id = normalizeGraphNodeId(node?.id);
		return id ? `id:${id}` : "";
	};
	for (const node of [...baseNodes, ...incomingNodes]) {
		const rawId = normalizeGraphNodeId(node?.id || node?.name);
		const id = rawId || toGraphNodeId(String(node?.name || ""));
		if (!id) continue;
		const canonicalKey = toCanonicalKey({ ...node, id });
		if (!canonicalKey) continue;
		const prev = byCanonical.get(canonicalKey);
		if (!prev) {
			byCanonical.set(canonicalKey, { ...node, id });
			idAliasToCanonical.set(id, id);
			continue;
		}
		const mergedSpan = normalizeChapterHints(
			[...(prev.chapterSpan || []), ...(node.chapterSpan || [])],
			96,
		);
		const firstChapter = Math.min(
			Number(prev.firstChapter || node.firstChapter || 1),
			Number(node.firstChapter || prev.firstChapter || 1),
		);
		const lastChapter = Math.max(
			Number(prev.lastChapter || node.lastChapter || 1),
			Number(node.lastChapter || prev.lastChapter || 1),
		);
		byCanonical.set(canonicalKey, {
			...prev,
			...node,
			id: prev.id || id,
			name: String(prev.name || "").trim() || String(node.name || "").trim(),
			chapterSpan: mergedSpan,
			firstChapter,
			lastChapter,
		});
		idAliasToCanonical.set(id, prev.id || id);
	}
	const nodes = Array.from(byCanonical.values());
	for (const node of nodes) {
		const nodeId = normalizeGraphNodeId(node.id);
		if (!nodeId) continue;
		idAliasToCanonical.set(nodeId, nodeId);
	}
	const validIds = new Set(nodes.map((n) => n.id));
	const knownIds = new Set<string>([...validIds, ...idAliasToCanonical.keys()]);
	const remapEdges = (edges: BookCharacterGraphEdge[]) =>
		edges
			.map((edge) => {
				const srcRaw = normalizeGraphNodeId(edge.sourceId);
				const dstRaw = normalizeGraphNodeId(edge.targetId);
				const sourceId = idAliasToCanonical.get(srcRaw) || srcRaw;
				const targetId = idAliasToCanonical.get(dstRaw) || dstRaw;
				return { ...edge, sourceId, targetId };
			})
			.filter(
				(edge) =>
					!!edge.sourceId &&
					!!edge.targetId &&
					edge.sourceId !== edge.targetId &&
					validIds.has(edge.sourceId) &&
					validIds.has(edge.targetId),
			);
	const baseEdges = remapEdges(normalizeGraphEdges(base?.edges, knownIds));
	const incomingEdges = remapEdges(normalizeGraphEdges(incoming?.edges, knownIds));
	const edgeMap = new Map<string, BookCharacterGraphEdge>();
	for (const edge of [...baseEdges, ...incomingEdges]) {
		const key = `${edge.sourceId}|${edge.targetId}|${edge.relation}|${edge.directed ? 1 : 0}`;
		const prev = edgeMap.get(key);
		if (!prev) {
			edgeMap.set(key, edge);
			continue;
		}
		edgeMap.set(key, {
			...prev,
			weight: Math.max(Number(prev.weight || 1), Number(edge.weight || 1)),
			chapterHints: normalizeChapterHints(
				[...(prev.chapterHints || []), ...(edge.chapterHints || [])],
				128,
			),
		});
	}
	return {
		nodes,
		edges: Array.from(edgeMap.values()),
	};
}

function mergeStyleBibleWithPrevious(
	next: BookStyleBible,
	prev: any,
): BookStyleBible {
	const prevStyle =
		prev && typeof prev.assets?.styleBible === "object"
			? (prev.assets.styleBible as any)
			: null;
	if (!prevStyle) return next;
	return {
		...next,
		styleId:
			typeof prevStyle.styleId === "string" && prevStyle.styleId.trim()
				? prevStyle.styleId
				: next.styleId,
		styleName:
			typeof prevStyle.styleName === "string" && prevStyle.styleName.trim()
				? prevStyle.styleName
				: next.styleName,
		confirmedAt:
			typeof prevStyle.confirmedAt === "string" ? prevStyle.confirmedAt : next.confirmedAt,
		confirmedBy:
			typeof prevStyle.confirmedBy === "string" ? prevStyle.confirmedBy : next.confirmedBy,
		mainCharacterCardsConfirmedAt:
			typeof prevStyle.mainCharacterCardsConfirmedAt === "string"
				? prevStyle.mainCharacterCardsConfirmedAt
				: next.mainCharacterCardsConfirmedAt,
		mainCharacterCardsConfirmedBy:
			typeof prevStyle.mainCharacterCardsConfirmedBy === "string"
				? prevStyle.mainCharacterCardsConfirmedBy
				: next.mainCharacterCardsConfirmedBy,
		visualDirectives: Array.isArray(prevStyle.visualDirectives)
			? prevStyle.visualDirectives
			: next.visualDirectives,
		negativeDirectives: Array.isArray(prevStyle.negativeDirectives)
			? prevStyle.negativeDirectives
			: next.negativeDirectives,
		consistencyRules: Array.isArray(prevStyle.consistencyRules)
			? prevStyle.consistencyRules
			: next.consistencyRules,
		referenceImages: Array.isArray(prevStyle.referenceImages)
			? prevStyle.referenceImages
			: next.referenceImages,
	};
}

function readStyleBibleFromPrevIndex(prev: unknown): BookStyleBible | null {
	if (!prev || typeof prev !== "object") return null;
	const assets = "assets" in prev ? (prev as { assets?: unknown }).assets : null;
	if (!assets || typeof assets !== "object") return null;
	const style =
		"styleBible" in assets
			? (assets as { styleBible?: unknown }).styleBible
			: null;
	if (!style || typeof style !== "object") return null;
	const styleId =
		typeof (style as { styleId?: unknown }).styleId === "string"
			? ((style as { styleId?: string }).styleId ?? "").trim()
			: "";
	const styleName =
		typeof (style as { styleName?: unknown }).styleName === "string"
			? ((style as { styleName?: string }).styleName ?? "").trim()
			: "";
	if (!styleId || !styleName) return null;
	const normalizeTextList = (value: unknown): string[] =>
		Array.isArray(value)
			? value
					.map((item) => (typeof item === "string" ? item.trim() : ""))
					.filter(Boolean)
					.slice(0, 12)
			: [];
	return {
		styleId,
		styleName,
		styleLocked: (style as { styleLocked?: unknown }).styleLocked === true,
		mainCharacterCardsConfirmedAt:
			typeof (style as { mainCharacterCardsConfirmedAt?: unknown }).mainCharacterCardsConfirmedAt === "string"
				? (style as { mainCharacterCardsConfirmedAt?: string }).mainCharacterCardsConfirmedAt
				: null,
		mainCharacterCardsConfirmedBy:
			typeof (style as { mainCharacterCardsConfirmedBy?: unknown }).mainCharacterCardsConfirmedBy === "string"
				? (style as { mainCharacterCardsConfirmedBy?: string }).mainCharacterCardsConfirmedBy
				: null,
		confirmedAt:
			typeof (style as { confirmedAt?: unknown }).confirmedAt === "string"
				? (style as { confirmedAt?: string }).confirmedAt
				: null,
		confirmedBy:
			typeof (style as { confirmedBy?: unknown }).confirmedBy === "string"
				? (style as { confirmedBy?: string }).confirmedBy
				: null,
		visualDirectives: normalizeTextList((style as { visualDirectives?: unknown }).visualDirectives),
		negativeDirectives: normalizeTextList((style as { negativeDirectives?: unknown }).negativeDirectives),
		consistencyRules: normalizeTextList((style as { consistencyRules?: unknown }).consistencyRules),
		referenceImages: normalizeTextList((style as { referenceImages?: unknown }).referenceImages),
	};
}

async function enrichCharacterGraphWithAgents(
	c: AppContext,
	userId: string,
	input: {
		chapters: BookChapterMeta[];
		characterProfiles: BookCharacterProfile[];
		mode?: BookDerivationMode;
		raw?: string;
		oneShot?: boolean;
		onProgress?: (input: {
			totalWindows: number;
			completedWindows: number;
			totalChapters: number;
			processedChapters: number;
		}) => Promise<void> | void;
	},
): Promise<{ graph: BookCharacterGraph; usedAgents: true }> {
	const isDeep = input.mode === "deep";
	const windows = input.oneShot
		? [input.chapters.slice()]
		: chunkBookChaptersByCount(
				input.chapters,
				readCharacterGraphStageWindowChapters(isDeep ? "deep" : "standard"),
		  );
	const graphConcurrency = readCharacterGraphBatchConcurrency(isDeep ? "deep" : "standard");
	let completedWindows = 0;
	let processedChapters = 0;
	const nodeMap = new Map<string, BookCharacterGraphNode>();
	const edgeMap = new Map<string, BookCharacterGraphEdge>();
	const windowResults = await mapWithConcurrency(
		windows.map((windowChapters, index) => ({ windowChapters, index })),
		graphConcurrency,
		async ({ windowChapters, index }) => {
			if (!windowChapters.length) {
				return {
					index,
					nodes: [] as BookCharacterGraphNode[],
					edges: [] as BookCharacterGraphEdge[],
					count: 0,
				};
			}
		const minChapter = windowChapters[0]?.chapter || 1;
		const maxChapter = windowChapters[windowChapters.length - 1]?.chapter || minChapter;
		const chapterEvidences = windowChapters.map((ch) => ({
			chapter: ch.chapter,
			title: ch.title,
			snippet: String(buildChapterSnippet(String(input.raw || ""), ch) || "")
				.replace(/\s+/g, " ")
				.slice(0, isDeep ? 520 : 280),
		}));
		const chapterOutline = windowChapters.map((ch) => ({
			chapter: ch.chapter,
			title: ch.title,
			summary: ch.summary || "",
			coreConflict: ch.coreConflict || "",
			characters: (ch.characters || []).map((x) => ({
				name: x.name,
				description: x.description || "",
			})),
		}));
		const profileOutline = input.characterProfiles
			.filter((p) => {
				const first = Number(p.firstChapter || 0);
				const last = Number(p.lastChapter || first || 0);
				if (first > 0 && last > 0 && last < minChapter) return false;
				if (first > 0 && first > maxChapter) return false;
				return true;
			})
			.slice(0, isDeep ? 220 : 140)
			.map((p) => ({
				name: p.name,
				description: p.description || "",
				importance: p.importance || "minor",
				firstChapter: p.firstChapter || null,
				lastChapter: p.lastChapter || null,
				chapterSpan: Array.isArray(p.chapterSpan) ? p.chapterSpan : [],
			}));
		const prompt = [
			"你是小说角色关系图谱总监。请基于章节与角色档案，生成严格 JSON 的角色关系网。",
			"必须由 team 模式完成：parser+checker 两个子代理协作，确保无漏角色、关系去重、章节提示完整。",
			`这是分阶段处理窗口 ${index + 1}/${windows.length}，只分析当前章节窗口并输出该窗口关系。`,
			'输出格式：{"characterGraph":{"nodes":[{"id":"role_a","name":"角色A","importance":"main|supporting|minor","firstChapter":1,"lastChapter":10,"chapterSpan":[1,2],"unlockChapter":1}],"edges":[{"sourceId":"role_a","targetId":"role_b","relation":"family|parent_child|siblings|mentor_disciple|alliance|friend|lover|rival|enemy|colleague|master_servant|betrayal|conflict|coappear","directed":true,"weight":3,"chapterHints":[1,2]}]}}',
			"要求：",
			"- nodes 必须覆盖主要角色，至少覆盖 characterProfiles 中所有 main/supporting 角色",
			"- id 使用稳定短标识（建议英文/拼音下划线），且全局唯一",
			"- unlockChapter 代表角色首次解锁章节（通常等于 firstChapter）",
			"- edges 去重：同一角色对仅保留一条边，weight 表示关系强度（1-99）",
			"- relation 必须是指定语义关系之一（优先使用 family/parent_child/siblings/mentor_disciple/alliance/friend/lover/rival/enemy/colleague/master_servant/betrayal/conflict）",
			"- directed 表示关系方向：有方向关系必须给 true，并保持 sourceId->targetId 语义正确",
			"- 关系必须具体清晰：避免泛化 coappear，优先抽取师徒/亲属/盟友/敌对/背叛等强语义关系",
			"- chapterHints 为该关系主要涉及章节，升序去重",
			...(isDeep ? ["- 深度模式：务必覆盖全书关键关系，优先识别父子/师徒/主仆/仇敌/同门等语义关系"] : []),
			...(chapterEvidences.length
				? ["- 必须结合 chapterEvidences 原文片段判断角色关系，不可只依赖标题。"]
				: []),
			"- 严格 JSON，不要 markdown，不要解释文字",
			JSON.stringify({
				characterProfiles: profileOutline,
				chapters: chapterOutline,
				chapterEvidences,
			}),
		].join("\n");
		const result = await runAgentsBridgeChatTask(c, userId, {
			kind: "chat",
			prompt,
			extras: {
				systemPrompt: buildBookGraphTeamSystemPrompt(),
				bridgeTimeoutMs: getAgentsBridgeTimeoutByMode(isDeep ? "deep" : "standard"),
			},
		});
		const text = typeof (result as any)?.raw?.text === "string" ? (result as any).raw.text : "";
		const parsed = extractFirstJsonObject(text) as any;
		const rawGraph =
			parsed && typeof parsed === "object" && parsed.characterGraph
				? parsed.characterGraph
				: parsed;
		const windowNodes = normalizeGraphNodes(rawGraph?.nodes);
		const nodeIds = new Set(windowNodes.map((x) => x.id));
		const windowEdges = normalizeGraphEdges(rawGraph?.edges, nodeIds);
			completedWindows += 1;
			processedChapters += windowChapters.length;
			await input.onProgress?.({
				totalWindows: windows.length,
				completedWindows,
				totalChapters: input.chapters.length,
				processedChapters: Math.min(input.chapters.length, processedChapters),
			});
			return { index, nodes: windowNodes, edges: windowEdges, count: windowChapters.length };
		},
	);
	for (const item of windowResults.slice().sort((a, b) => a.index - b.index)) {
		for (const node of item.nodes) {
			const prev = nodeMap.get(node.id);
			if (!prev) {
				nodeMap.set(node.id, node);
				continue;
			}
			nodeMap.set(node.id, {
				...prev,
				...node,
				chapterSpan: normalizeChapterHints([...(prev.chapterSpan || []), ...(node.chapterSpan || [])], 128),
				firstChapter: Math.min(
					Number(prev.firstChapter || node.firstChapter || 1),
					Number(node.firstChapter || prev.firstChapter || 1),
				),
				lastChapter: Math.max(
					Number(prev.lastChapter || node.lastChapter || 1),
					Number(node.lastChapter || prev.lastChapter || 1),
				),
			});
		}
		for (const edge of item.edges) {
			const key = `${edge.sourceId}|${edge.targetId}|${edge.relation}|${edge.directed ? 1 : 0}`;
			const prev = edgeMap.get(key);
			if (!prev) {
				edgeMap.set(key, edge);
				continue;
			}
			edgeMap.set(key, {
				...prev,
				weight: Math.min(99, Math.max(Number(prev.weight || 1), Number(edge.weight || 1))),
				chapterHints: normalizeChapterHints([...(prev.chapterHints || []), ...(edge.chapterHints || [])], 256),
			});
		}
	}
	const nodes = Array.from(nodeMap.values());
	if (!nodes.length) {
		throw new Error("agents-cli characterGraph nodes is empty");
	}
	const edges = Array.from(edgeMap.values());
	return {
		graph: { nodes, edges },
		usedAgents: true,
	};
}

async function buildBookIndexFromContent(
	c: AppContext,
	userId: string,
	input: {
		bookId: string;
		projectId: string;
		title: string;
		content: string;
		rawPath: string;
		prevIndex?: any | null;
		mode?: BookDerivationMode;
		strictAgents?: boolean;
		onProgress?: (progress: {
			phase: string;
			percent: number;
			message?: string;
			totalChapters?: number;
			processedChapters?: number;
		}) => Promise<void> | void;
	},
): Promise<any> {
	const mode: BookDerivationMode = input.mode === "deep" ? "deep" : "standard";
	const chapterResolve = resolveBookChaptersFromText(input.content);
	const baseChapters = chapterResolve.chapters;
	if (!baseChapters.length) {
		throw new Error(
			"agents-cli chapter boundaries not detected: missing recognizable chapter headings in source text",
		);
	}
	const totalChapters = baseChapters.length;
	await input.onProgress?.({
		phase: "chapter_boundaries",
		percent: 40,
		message: "章节边界识别完成，元数据改为按章节懒解析",
		totalChapters,
		processedChapters: 0,
	});
	const chapters = baseChapters;
	const derivationWarnings = [
		"chapter-metadata-on-demand",
		"character-profiles-on-demand",
		"character-graph-on-demand",
		"style-bible-on-demand",
		...(chapterResolve.usedSingleChapterFallback ? ["chapter-boundaries-single-chapter-fallback"] : []),
	];
	const prevAssets =
		input.prevIndex && typeof (input.prevIndex as any).assets === "object" && (input.prevIndex as any).assets
			? ((input.prevIndex as any).assets as Record<string, unknown>)
			: {};
	const characterProfiles = normalizeCharacterProfiles((prevAssets as any).characterProfiles);
	const characterGraph = mergeGraphUnlockHints(
		buildLocalCharacterGraph({
			chapters,
			characterProfiles,
		}),
		input.prevIndex,
	);
	const styleBible = readStyleBibleFromPrevIndex(input.prevIndex);
	const output = {
		bookId: input.bookId,
		projectId: input.projectId,
		title: input.title,
		chapterCount: chapters.length,
		updatedAt: new Date().toISOString(),
		processedBy: "agents-cli-on-demand",
		derivationMode: mode,
		rawPath: path.relative(process.cwd(), input.rawPath),
		derivationWarnings,
		chapters,
		assets: {
			characters: mergeUniqueEntityPool(chapters, "characters"),
			characterProfiles,
			props: mergeUniquePropPool(chapters),
			scenes: mergeUniqueEntityPool(chapters, "scenes"),
			locations: mergeUniqueEntityPool(chapters, "locations"),
			characterGraph,
			...(styleBible ? { styleBible } : null),
			roleCards: normalizeBookRoleCards((prevAssets as any)?.roleCards),
			visualRefs: normalizeBookVisualRefs((prevAssets as any)?.visualRefs),
			semanticAssets: normalizeBookSemanticAssets((prevAssets as any)?.semanticAssets),
			storyboardPlans: normalizeBookStoryboardPlans((prevAssets as any)?.storyboardPlans),
			storyboardChunks: normalizeBookStoryboardChunks((prevAssets as any)?.storyboardChunks),
		},
	};
	await input.onProgress?.({
		phase: "done",
		percent: 100,
		message: "上传完成：已建立章节索引；风格与章节元数据将在后续分析阶段按需生成",
		totalChapters,
		processedChapters: 0,
	});
	return output;
}

async function buildBookIndexFromContentFullReconfirm(
	c: AppContext,
	userId: string,
	input: {
		bookId: string;
		projectId: string;
		title: string;
		content: string;
		rawPath: string;
		prevIndex?: any | null;
		mode?: BookDerivationMode;
		onProgress?: (progress: {
			phase: string;
			percent: number;
			message?: string;
			totalChapters?: number;
			processedChapters?: number;
		}) => Promise<void> | void;
	},
): Promise<any> {
	const mode: BookDerivationMode = input.mode === "deep" ? "deep" : "standard";
	const chapterResolve = resolveBookChaptersFromText(input.content);
	const baseChapters = chapterResolve.chapters;
	if (!baseChapters.length) {
		throw new Error(
			"agents-cli chapter boundaries not detected: missing recognizable chapter headings in source text",
		);
	}
	await input.onProgress?.({
		phase: "chapter_boundaries",
		percent: 10,
		message: "章节边界识别完成，开始全书深度重建",
		totalChapters: baseChapters.length,
		processedChapters: 0,
	});

	const enriched = await enrichBookMetaWithAgents(
		c as any,
		userId,
		input.content,
		baseChapters,
		mode,
		async (p) => {
			const ratio =
				p.totalChapters > 0 ? Math.min(1, Math.max(0, p.processedChapters / p.totalChapters)) : 0;
			const percent = 20 + Math.round(ratio * 40);
			await input.onProgress?.({
				phase: "chapter_metadata",
				percent,
				message: `全书章节元数据重建中（${p.completedBatches}/${p.totalBatches} 批）`,
				totalChapters: p.totalChapters,
				processedChapters: p.processedChapters,
			});
		},
	);
	const chapters = enriched.chapters;

	await input.onProgress?.({
		phase: "character_profiles",
		percent: 65,
		message: "开始全书角色档案重建",
		totalChapters: chapters.length,
		processedChapters: chapters.length,
	});
	const roleProfilesResult = await enrichCharacterProfilesWithAgents(
		c as any,
		userId,
		chapters,
		mode,
		input.content,
		async (p) => {
			const ratio =
				p.totalChapters > 0 ? Math.min(1, Math.max(0, p.processedChapters / p.totalChapters)) : 0;
			const percent = 65 + Math.round(ratio * 15);
			await input.onProgress?.({
				phase: "character_profiles",
				percent,
				message: `全书角色档案重建中（${p.completedWindows}/${p.totalWindows} 窗口）`,
				totalChapters: p.totalChapters,
				processedChapters: p.processedChapters,
			});
		},
	);
	const characterProfiles = roleProfilesResult.profiles;

	await input.onProgress?.({
		phase: "character_graph",
		percent: 82,
		message: "开始全书角色关系网重建",
		totalChapters: chapters.length,
		processedChapters: chapters.length,
	});
	const graphResult = await enrichCharacterGraphWithAgents(c as any, userId, {
		chapters,
		characterProfiles,
		mode,
		raw: input.content,
		onProgress: async (p) => {
			const ratio =
				p.totalChapters > 0 ? Math.min(1, Math.max(0, p.processedChapters / p.totalChapters)) : 0;
			const percent = 82 + Math.round(ratio * 16);
			await input.onProgress?.({
				phase: "character_graph",
				percent,
				message: `全书关系网重建中（${p.completedWindows}/${p.totalWindows} 窗口）`,
				totalChapters: p.totalChapters,
				processedChapters: p.processedChapters,
			});
		},
	});
	const characterGraph = mergeGraphUnlockHints(graphResult.graph, input.prevIndex);

	const styleSemantic = await inferBookStyleBibleWithAgents(c as any, userId, {
		title: input.title,
		raw: input.content,
		characterProfiles,
		prevIndex: input.prevIndex,
	});
	const styleBible = mergeStyleBibleWithPrevious(
		buildBookStyleBible({
			title: input.title,
			raw: input.content,
			characterProfiles,
			styleName: styleSemantic.styleName,
			visualDirectives: styleSemantic.visualDirectives,
			negativeDirectives: styleSemantic.negativeDirectives,
			consistencyRules: styleSemantic.consistencyRules,
		}),
		input.prevIndex,
	);
	const prevAssets =
		input.prevIndex && typeof (input.prevIndex as any).assets === "object" && (input.prevIndex as any).assets
			? ((input.prevIndex as any).assets as Record<string, unknown>)
			: {};

	const output = {
		bookId: input.bookId,
		projectId: input.projectId,
		title: input.title,
		chapterCount: chapters.length,
		updatedAt: new Date().toISOString(),
		processedBy: "agents-cli",
		derivationMode: mode,
		rawPath: path.relative(process.cwd(), input.rawPath),
		derivationWarnings: [] as string[],
		chapters,
		assets: {
			characters: mergeUniqueEntityPool(chapters, "characters"),
			characterProfiles,
			props: mergeUniquePropPool(chapters),
			scenes: mergeUniqueEntityPool(chapters, "scenes"),
			locations: mergeUniqueEntityPool(chapters, "locations"),
			characterGraph,
			styleBible,
			roleCards: normalizeBookRoleCards((prevAssets as any)?.roleCards),
			visualRefs: normalizeBookVisualRefs((prevAssets as any)?.visualRefs),
			semanticAssets: normalizeBookSemanticAssets((prevAssets as any)?.semanticAssets),
			storyboardPlans: normalizeBookStoryboardPlans((prevAssets as any)?.storyboardPlans),
			storyboardChunks: normalizeBookStoryboardChunks((prevAssets as any)?.storyboardChunks),
		},
	};
	if (chapterResolve.usedSingleChapterFallback) {
		output.derivationWarnings.push("chapter-boundaries-single-chapter-fallback");
	}
	await input.onProgress?.({
		phase: "done",
		percent: 100,
		message: "全书深度重建完成",
		totalChapters: chapters.length,
		processedChapters: chapters.length,
	});
	return output;
}

function mapBookAgentsDeriveError(err: unknown): {
	status: number;
	payload: { error: string; code: string; details?: Record<string, unknown> };
} {
	if (err instanceof BookSourceParseError) {
		const status =
			err.code === "book_source_size_mismatch"
				? 409
				: err.code === "book_source_upload_read_failed" ||
					  err.code === "book_source_metadata_invalid"
					? 500
					: err.code === "book_source_unsupported_type" ||
						  err.code === "book_source_invalid_utf8" ||
						  err.code === "book_source_empty"
						? 400
						: 422;
		return {
			status,
			payload: {
				error: err.message,
				code: err.code.toUpperCase(),
				details: { reason: err.message, ...err.details },
			},
		};
	}
	if (err instanceof BookEvidenceError) {
		return {
			status: 500,
			payload: {
				error: err.message,
				code: err.code.toUpperCase(),
				details: { reason: err.message, ...err.details },
			},
		};
	}
	const message = readUnknownErrorMessage(err);
	const messageLower = message.toLowerCase();
	if (messageLower.includes("agents-cli chapters metadata incomplete")) {
		return {
			status: 422,
			payload: {
				error: "agents-cli 章节元数据不完整，请重试或调整小说内容后重传",
				code: "AGENTS_CHAPTERS_INCOMPLETE",
				details: { reason: message },
			},
		};
	}
	if (
		messageLower.includes("agents-cli parser error: must_read_local_file_via_bash") ||
		messageLower.includes("must_read_local_file_via_bash")
	) {
		return {
			status: 422,
			payload: {
				error: "agents-cli 未按要求通过 bash 读取本地源文件，请检查本地资源路径与工具约束",
				code: "AGENTS_MUST_READ_LOCAL_FILE_VIA_BASH",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("agents-cli parser error: local_file_access_failed")) {
		return {
			status: 422,
			payload: {
				error: "agents-cli 无法访问本地源文件（特权模式）",
				code: "AGENTS_LOCAL_FILE_ACCESS_FAILED",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("agents-cli parser output incomplete")) {
		return {
			status: 422,
			payload: {
				error: "agents-cli 章节元数据输出不完整（模型输出被截断或漏章）",
				code: "AGENTS_PARSER_OUTPUT_INCOMPLETE",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("agents-cli chapters count mismatch")) {
		return {
			status: 422,
			payload: {
				error: "agents-cli 章节数量与输入不一致，请重试",
				code: "AGENTS_CHAPTER_COUNT_MISMATCH",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("chapter boundaries not detected")) {
		return {
			status: 422,
			payload: {
				error: "未识别到可靠章节标题，已禁用自动兜底分段。请提供带明确章节标题的原文后重试。",
				code: "CHAPTER_BOUNDARIES_NOT_DETECTED",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("book not found")) {
		return {
			status: 404,
			payload: {
				error: "book not found",
				code: "BOOK_NOT_FOUND",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("book raw content not found")) {
		return {
			status: 404,
			payload: {
				error: "book raw content not found",
				code: "BOOK_RAW_NOT_FOUND",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("agents-cli characterprofiles is empty")) {
		return {
			status: 422,
			payload: {
				error: "agents-cli 未产出角色档案，请重试",
				code: "AGENTS_CHARACTER_PROFILES_EMPTY",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("agents-cli charactergraph nodes is empty")) {
		return {
			status: 422,
			payload: {
				error: "agents-cli 未产出角色关系网节点，请重试",
				code: "AGENTS_CHARACTER_GRAPH_EMPTY",
				details: { reason: message },
			},
		};
	}
	if (messageLower.includes("agents-cli style bible")) {
		return {
			status: 422,
			payload: {
				error: "agents-cli 未产出可用全书画风，请重试",
				code: "AGENTS_STYLE_BIBLE_INVALID",
				details: { reason: message },
			},
		};
	}
	return {
		status: 500,
		payload: {
			error: "agents-cli 推导失败，请稍后重试",
			code: "AGENTS_METADATA_DERIVATION_FAILED",
			details: message ? { reason: message } : undefined,
		},
	};
}

function toBookUploadJobPublic(job: BookUploadJobMeta): Record<string, unknown> {
	return {
		id: job.id,
		projectId: job.projectId,
		uploadId: job.uploadId,
		title: job.title,
		status: job.status,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
		startedAt: job.startedAt,
		finishedAt: job.finishedAt,
		progress: job.progress || null,
		result: job.result,
		error: job.error || null,
	};
}

async function resolveBookUploadJobRuntimeState(
	job: BookUploadJobMeta | null,
): Promise<BookUploadJobMeta | null> {
	if (!job) return null;
	const staleAfterMs = readBookUploadJobStaleAfterMs();
	if (
		!isStalledBookUploadJob({
			job,
			staleAfterMs,
		})
	) {
		return job;
	}
	const fresh = await readBookUploadJob(job.projectId, job.userId, job.id);
	if (!fresh) return null;
	if (
		!isStalledBookUploadJob({
			job: fresh,
			staleAfterMs,
		})
	) {
		return fresh;
	}
	const now = new Date().toISOString();
	const phase = typeof fresh.progress?.phase === "string" ? fresh.progress.phase : "queued";
	const percent =
		typeof fresh.progress?.percent === "number" && Number.isFinite(fresh.progress.percent)
			? Math.max(0, Math.trunc(fresh.progress.percent))
			: 0;
	console.warn(
		`[book-upload.job.stalled] project=${fresh.projectId} user=${fresh.userId} job=${fresh.id} phase=${phase} percent=${percent} updatedAt=${fresh.updatedAt}`,
	);
	fresh.status = "failed";
	fresh.progress = {
		phase: "failed",
		percent: 100,
		message: "任务已中断：长时间停留在初始阶段且无执行心跳，请重新上传",
	};
	fresh.result = undefined;
	fresh.error = {
		code: "BOOK_UPLOAD_JOB_STALLED",
		message: "小说上传任务已中断：长时间停留在初始阶段且无执行心跳，请重新上传",
		details: {
			reason: "book-upload-job-stalled",
			staleAfterMs,
			lastUpdatedAt: fresh.updatedAt,
			progressPhase: phase,
			progressPercent: percent,
		},
	};
	fresh.finishedAt = now;
	fresh.updatedAt = now;
	await writeBookUploadJob(fresh);
	return fresh;
}

function toBookReconfirmJobPublic(job: BookReconfirmJobMeta): Record<string, unknown> {
	return {
		id: job.id,
		bookId: job.bookId,
		projectId: job.projectId,
		title: job.title,
		mode: job.mode,
		status: job.status,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
		startedAt: job.startedAt,
		finishedAt: job.finishedAt,
		progress: job.progress || null,
		result: job.result,
		error: job.error || null,
	};
}

function buildAsyncTaskContext(options: {
	env: AppContext["env"];
	requestUrl: string;
	authorization?: string;
	apiKey?: string;
}): AppContext {
	const headers = new Map<string, string>();
	if (options.authorization) headers.set("authorization", options.authorization);
	if (options.apiKey) headers.set("x-api-key", options.apiKey);
	const reqLike = {
		url: options.requestUrl,
		header: (key: string) => headers.get(String(key || "").toLowerCase()) || undefined,
	} as any;
	return { env: options.env, req: reqLike } as any;
}

function enqueueBookUploadJob(options: {
	jobId: string;
	userId: string;
	projectId: string;
	env: AppContext["env"];
	requestUrl: string;
	authorization?: string;
	apiKey?: string;
}): void {
	const exists = bookUploadWorkerState.queue.some(
		(item) =>
			item.jobId === options.jobId &&
			item.projectId === options.projectId &&
			item.userId === options.userId,
	);
	if (!exists) {
		bookUploadWorkerState.queue.push(options);
	}
}

function enqueueBookReconfirmJob(options: {
	jobId: string;
	userId: string;
	bookId: string;
	projectId: string;
	env: AppContext["env"];
	requestUrl: string;
	authorization?: string;
	apiKey?: string;
}): void {
	const exists = bookReconfirmWorkerState.queue.some(
		(item) =>
			item.jobId === options.jobId &&
			item.bookId === options.bookId &&
			item.projectId === options.projectId &&
			item.userId === options.userId,
	);
	if (!exists) {
		bookReconfirmWorkerState.queue.push(options);
	}
}

async function scheduleBookReconfirmJobIfIdle(options: {
	env: AppContext["env"];
	requestUrl: string;
	authorization?: string;
	apiKey?: string;
	projectId: string;
	userId: string;
	bookId: string;
	title: string;
	chapterCount?: number;
}): Promise<BookReconfirmJobMeta | null> {
	const active = await findActiveBookReconfirmJob(
		options.projectId,
		options.userId,
		options.bookId,
	);
	if (active) {
		return active;
	}
	const now = new Date().toISOString();
	const job: BookReconfirmJobMeta = {
		id: crypto.randomUUID(),
		bookId: options.bookId,
		userId: options.userId,
		projectId: options.projectId,
		title: options.title,
		mode: "standard",
		strictAgents: true,
		status: "queued",
		progress: {
			phase: "queued",
			percent: 0,
			message: "后台预处理中，等待执行",
			totalChapters:
				typeof options.chapterCount === "number" && Number.isFinite(options.chapterCount)
					? Math.max(0, Math.trunc(options.chapterCount))
					: undefined,
			processedChapters: 0,
		},
		createdAt: now,
		updatedAt: now,
		error: null,
	};
	await writeBookReconfirmJob(job);
	enqueueBookReconfirmJob({
		jobId: job.id,
		userId: options.userId,
		bookId: options.bookId,
		projectId: options.projectId,
		env: options.env,
		requestUrl: options.requestUrl,
		authorization: options.authorization,
		apiKey: options.apiKey,
	});
	void drainBookReconfirmJobs();
	return job;
}

async function processBookUploadJob(options: {
	env: AppContext["env"];
	requestUrl: string;
	authorization?: string;
	apiKey?: string;
	projectId: string;
	userId: string;
	jobId: string;
}): Promise<void> {
	const job = await readBookUploadJob(options.projectId, options.userId, options.jobId);
	if (!job) return;
	if (job.status === "succeeded" || job.status === "failed") return;
	const now = new Date().toISOString();
	job.status = "running";
	job.startedAt = now;
	job.updatedAt = now;
	job.error = null;
	job.progress = {
		phase: "queued",
		percent: 1,
		message: "任务已启动，准备读取上传内容",
	};
	await writeBookUploadJob(job);
	try {
		const session = await readBookUploadSession(
			options.projectId,
			options.userId,
			job.uploadId,
		);
		if (!session || session.userId !== job.userId) {
			throw new Error("upload session not found");
		}
		let sourceBytes: Uint8Array;
		try {
			sourceBytes = await fs.readFile(session.tmpPath);
		} catch (error) {
			throw new BookSourceParseError(
				"book_source_upload_read_failed",
				"读取已上传书籍源文件失败",
				{ uploadId: session.id, reason: readUnknownErrorMessage(error) },
			);
		}
		if (sourceBytes.byteLength === 0) {
			throw new BookSourceParseError("book_source_empty", "上传的书籍源文件为空");
		}
		if (sourceBytes.byteLength !== session.contentBytes) {
			throw new BookSourceParseError(
				"book_source_size_mismatch",
				"上传的书籍源文件字节数与会话声明不一致",
				{
					expectedBytes: session.contentBytes,
					actualBytes: sourceBytes.byteLength,
				},
			);
		}
		const parsedSource = parseBookSource({
			fileName: session.sourceFileName,
			bytes: sourceBytes,
		});
		job.progress = {
			phase: "source_parsed",
			percent: 5,
			message: `已解析 ${parsedSource.metadata.format} 源文件，准备建立章节索引`,
		};
		job.updatedAt = new Date().toISOString();
		await writeBookUploadJob(job);
		const asyncContext = buildAsyncTaskContext({
			env: options.env,
			requestUrl: options.requestUrl,
			authorization: options.authorization,
			apiKey: options.apiKey,
		});
		const result = await runBookDerivationQueued(() =>
			ingestBookFromContent(asyncContext, job.userId, {
				projectId: job.projectId,
				title: job.title,
				content: parsedSource.text,
				sourceBytes,
				source: parsedSource.metadata,
				strictAgents: job.strictAgents,
				onProgress: async (progress) => {
					const fresh = await readBookUploadJob(job.projectId, job.userId, job.id);
					if (!fresh) return;
					fresh.progress = {
						phase: progress.phase,
						percent: Math.max(1, Math.min(100, Math.trunc(progress.percent))),
						message: progress.message,
						totalChapters:
							typeof progress.totalChapters === "number"
								? Math.max(0, Math.trunc(progress.totalChapters))
								: undefined,
						processedChapters:
							typeof progress.processedChapters === "number"
								? Math.max(0, Math.trunc(progress.processedChapters))
								: undefined,
					};
					fresh.updatedAt = new Date().toISOString();
					await writeBookUploadJob(fresh);
				},
			}),
		);
		job.status = "succeeded";
		job.progress = {
			phase: "done",
			percent: 100,
			message: "任务完成",
		};
		job.result = result;
		job.error = null;
		job.finishedAt = new Date().toISOString();
		job.updatedAt = job.finishedAt;
		await writeBookUploadJob(job);
		if (result.processedBy === "agents-cli-on-demand") {
			await scheduleBookReconfirmJobIfIdle({
				env: options.env,
				requestUrl: options.requestUrl,
				authorization: options.authorization,
				apiKey: options.apiKey,
				projectId: job.projectId,
				userId: job.userId,
				bookId: result.bookId,
				title: result.title,
				chapterCount: result.chapterCount,
			});
		}
	} catch (err) {
		const mapped = mapBookAgentsDeriveError(err);
		job.status = "failed";
		job.progress = {
			phase: "failed",
			percent: 100,
			message: "任务失败",
		};
		job.result = undefined;
		job.error = {
			code: mapped.payload.code,
			message: mapped.payload.error,
			details: mapped.payload.details,
		};
		job.finishedAt = new Date().toISOString();
		job.updatedAt = job.finishedAt;
		await writeBookUploadJob(job);
	} finally {
		try {
			const sessionNow = await readBookUploadSession(
				options.projectId,
				options.userId,
				job.uploadId,
			);
			if (sessionNow) {
				try {
					await fs.rm(sessionNow.tmpPath, { force: true });
				} catch (error) {
					console.warn("[book-upload.cleanup.failed]", {
						projectId: options.projectId,
						userId: options.userId,
						uploadId: job.uploadId,
						kind: "source",
						reason: readUnknownErrorMessage(error),
					});
				}
			}
		} catch (error) {
			console.warn("[book-upload.cleanup.session-read-failed]", {
				projectId: options.projectId,
				userId: options.userId,
				uploadId: job.uploadId,
				reason: readUnknownErrorMessage(error),
			});
		}
	}
}

async function drainBookUploadJobs(): Promise<void> {
	if (bookUploadWorkerState.running) return;
	bookUploadWorkerState.running = true;
	try {
		while (bookUploadWorkerState.queue.length > 0) {
			const next = bookUploadWorkerState.queue.shift();
			if (!next) continue;
			await processBookUploadJob(next);
		}
	} finally {
		bookUploadWorkerState.running = false;
	}
}

async function processBookReconfirmJob(options: {
	env: AppContext["env"];
	requestUrl: string;
	authorization?: string;
	apiKey?: string;
	projectId: string;
	userId: string;
	bookId: string;
	jobId: string;
}): Promise<void> {
	const job = await readBookReconfirmJob(options.projectId, options.userId, options.jobId);
	if (!job) return;
	if (job.status === "succeeded" || job.status === "failed") return;
	const now = new Date().toISOString();
	job.status = "running";
	job.startedAt = now;
	job.updatedAt = now;
	job.error = null;
	job.progress = {
		phase: "queued",
		percent: 1,
		message: "任务已启动，准备读取小说原文",
	};
	await writeBookReconfirmJob(job);
	try {
		const bookDir = path.join(buildProjectBooksRoot(job.projectId, job.userId), job.bookId);
		const rawPath = path.join(bookDir, "raw.md");
		const indexPath = path.join(bookDir, "index.json");
		const prevIndex = await readBookIndexSafe(indexPath);
		if (!prevIndex) throw new Error("book not found");
		const rawContent = await fs.readFile(rawPath, "utf8").catch(() => "");
		if (!rawContent.trim()) throw new Error("book raw content not found");
		const asyncContext = buildAsyncTaskContext({
			env: options.env,
			requestUrl: options.requestUrl,
			authorization: options.authorization,
			apiKey: options.apiKey,
		});
		let nextIndex: any;
		nextIndex = await runBookDerivationQueued(() =>
			buildBookIndexFromContentFullReconfirm(asyncContext as any, job.userId, {
				bookId: job.bookId,
				projectId: job.projectId,
				title: String(prevIndex?.title || job.bookId),
				content: rawContent,
				rawPath,
				prevIndex,
				mode: job.mode,
				onProgress: async (progress) => {
					const fresh = await readBookReconfirmJob(job.projectId, job.userId, job.id);
					if (!fresh) return;
					fresh.progress = {
						phase: progress.phase,
						percent: Math.max(1, Math.min(100, Math.trunc(progress.percent))),
						message: progress.message,
						totalChapters:
							typeof progress.totalChapters === "number"
								? Math.max(0, Math.trunc(progress.totalChapters))
								: undefined,
						processedChapters:
							typeof progress.processedChapters === "number"
								? Math.max(0, Math.trunc(progress.processedChapters))
								: undefined,
					};
					fresh.updatedAt = new Date().toISOString();
					await writeBookReconfirmJob(fresh);
				},
			}),
		);
		nextIndex = await writeBookRawChunksAndAttachMetadata({
			bookDir,
			rawContent,
			chapters: Array.isArray(nextIndex?.chapters) ? (nextIndex.chapters as BookChapterMeta[]) : [],
			index: nextIndex,
		});
		nextIndex = await attachFreshBookEvidenceIndex({
			bookDirectory: bookDir,
			bookId: job.bookId,
			projectId: job.projectId,
			title: String(nextIndex?.title || prevIndex.title || job.bookId),
			rawText: rawContent,
			index: nextIndex as BookIndexRecord,
			source: prevIndex.source,
		});
		nextIndex = await commitDerivedBookIndex({
			indexPath,
			base: prevIndex,
			derived: nextIndex as BookIndexRecord,
		});
		job.status = "succeeded";
		job.progress = {
			phase: "done",
			percent: 100,
			message: "任务完成",
		};
		job.result = {
			ok: true,
			bookId: job.bookId,
			title: String(nextIndex?.title || job.title || job.bookId),
			chapterCount: Number(nextIndex?.chapterCount || 0) || 0,
			processedBy: String(nextIndex?.processedBy || ""),
			warnings: Array.isArray(nextIndex?.derivationWarnings)
				? (nextIndex.derivationWarnings as string[])
				: [],
		};
		job.error = null;
		job.finishedAt = new Date().toISOString();
		job.updatedAt = job.finishedAt;
		await writeBookReconfirmJob(job);
	} catch (err) {
		const mapped = mapBookAgentsDeriveError(err);
		job.status = "failed";
		job.progress = {
			phase: "failed",
			percent: 100,
			message: "任务失败",
		};
		job.result = undefined;
		job.error = {
			code: mapped.payload.code,
			message: mapped.payload.error,
			details: mapped.payload.details,
		};
		job.finishedAt = new Date().toISOString();
		job.updatedAt = job.finishedAt;
		await writeBookReconfirmJob(job);
	}
}

async function drainBookReconfirmJobs(): Promise<void> {
	if (bookReconfirmWorkerState.running) return;
	bookReconfirmWorkerState.running = true;
	try {
		while (bookReconfirmWorkerState.queue.length > 0) {
			const next = bookReconfirmWorkerState.queue.shift();
			if (!next) continue;
			await processBookReconfirmJob(next);
		}
	} finally {
		bookReconfirmWorkerState.running = false;
	}
}

async function enrichCharacterProfilesWithAgents(
	c: AppContext,
	userId: string,
	chapters: BookChapterMeta[],
	mode: BookDerivationMode = "standard",
	rawText: string = "",
	onProgress?: (input: {
		totalWindows: number;
		completedWindows: number;
		totalChapters: number;
		processedChapters: number;
	}) => Promise<void> | void,
	oneShot = false,
): Promise<{ profiles: BookCharacterProfile[]; usedAgents: boolean }> {
	if (!chapters.length) return { profiles: [], usedAgents: false };
	const isDeep = mode === "deep";
	const windows = oneShot
		? [chapters.slice()]
		: chunkBookChaptersByCount(
				chapters,
				readCharacterProfilesStageWindowChapters(isDeep ? "deep" : "standard"),
		  );
	const profileConcurrency = readCharacterProfilesBatchConcurrency(isDeep ? "deep" : "standard");
	let completedWindows = 0;
	let processedChapters = 0;
	const windowResults = await mapWithConcurrency(
		windows.map((windowChapters, index) => ({ windowChapters, index })),
		profileConcurrency,
		async ({ windowChapters, index }) => {
			if (!windowChapters.length) return { index, profiles: [] as BookCharacterProfile[], count: 0 };
		const chapterEvidences = windowChapters.map((ch) => ({
			chapter: ch.chapter,
			title: ch.title,
			snippet: String(buildChapterSnippet(rawText, ch) || "")
				.replace(/\s+/g, " ")
				.slice(0, isDeep ? 520 : 280),
		}));
		const chapterOutline = windowChapters.map((ch) => ({
			chapter: ch.chapter,
			title: ch.title,
			summary: ch.summary || "",
			characters: (ch.characters || []).map((x) => ({
				name: x.name,
				description: x.description || "",
			})),
		}));
		const prompt = [
			"你是小说角色总监。请通读章节级信息，生成主角色档案与分阶段形态。严格返回 JSON。",
			`这是分阶段窗口 ${index + 1}/${windows.length}，只针对当前窗口章节提取角色形态，最终会跨窗口合并。`,
			'格式：{"characterProfiles":[{"name":"角色名","description":"角色总描述","importance":"main|supporting|minor","firstChapter":1,"lastChapter":20,"chapterSpan":[1,2],"stageForms":[{"stage":"前期","look":"外观","costume":"服装","props":["道具"],"emotion":"情绪","chapterHints":[1,2]}]}]}',
			"要求：",
			"- 聚焦主要角色，通常 3-20 个",
			...(isDeep ? ["- 深度模式角色覆盖目标 12-60 个（含重要配角），不要只给 3-7 个主角"] : []),
			"- description 必须具体，至少包含：身份/阵营、外观特征、性格动机、能力或修为、与主角关键关系",
			"- description 禁止只写角色名或空泛短句；标准模式建议 40-100 字，深度模式建议 80-200 字",
			"- stageForms 为角色不同阶段的稳定形态，最多 5 阶段",
			"- 每个 stageForms 必须尽量填写 look/costume/props/emotion，避免留空",
			"- chapterHints 标记该阶段主要对应章节",
			...(isDeep ? ["- 深度模式：必须通读全书脉络，识别角色阶段演进与核心关系定位"] : []),
			...(chapterEvidences.length
				? ["- 必须结合 chapterEvidences 原文片段识别配角与群像人物。"]
				: []),
			"- 严格 JSON，不要额外文本",
			JSON.stringify({ chapters: chapterOutline, chapterEvidences }),
		].join("\n");
		const result = await runAgentsBridgeChatTask(c, userId, {
			kind: "chat",
			prompt,
			extras: {
				bridgeTimeoutMs: getAgentsBridgeTimeoutByMode(isDeep ? "deep" : "standard"),
			},
		});
		const text = typeof (result as any)?.raw?.text === "string" ? (result as any).raw.text : "";
		const parsed = extractFirstJsonObject(text) as any;
		const windowProfiles = normalizeCharacterProfiles(parsed?.characterProfiles);
		if (!windowProfiles.length) {
			throw new Error("agents-cli characterProfiles is empty");
		}
			completedWindows += 1;
			processedChapters += windowChapters.length;
			await onProgress?.({
				totalWindows: windows.length,
				completedWindows,
				totalChapters: chapters.length,
				processedChapters: Math.min(chapters.length, processedChapters),
			});
			return { index, profiles: windowProfiles, count: windowChapters.length };
		},
	);
	const mergedProfiles = normalizeCharacterProfiles(
		windowResults
			.slice()
			.sort((a, b) => a.index - b.index)
			.flatMap((item) => item.profiles),
	);
	if (!mergedProfiles.length) {
		throw new Error("agents-cli characterProfiles is empty");
	}
	return { profiles: mergedProfiles, usedAgents: true };
}

function normalizeProjectDataPathForAgents(value: string): string | null {
	const raw = String(value || "").trim();
	if (!raw) return null;
	const unified = raw.replace(/\\/g, "/");
	const compact = unified.replace(/\/{2,}/g, "/");
	const stripped = compact.replace(/^\.\/+/, "");
	if (stripped === "project-data") return "project-data";
	if (stripped.startsWith("project-data/")) return stripped;
	const marker = "/project-data/";
	const idx = compact.indexOf(marker);
	if (idx >= 0) {
		const suffix = compact.slice(idx + marker.length).replace(/^\/+/, "");
		return suffix ? `project-data/${suffix}` : "project-data";
	}
	if (compact.endsWith("/project-data")) {
		return "project-data";
	}
	return null;
}

type BookMetaEnrichOptions = {
	batchMaxChars?: number;
	batchMaxChapters?: number;
	batchConcurrency?: number;
	snippetMaxChars?: number;
	useLocalFileContext?: boolean;
	localSourceFilePath?: string;
	skipChecker?: boolean;
	oneShot?: boolean;
	privilegedLocalAccess?: boolean;
	preferSingleTurn?: boolean;
	onBatchDone?: (batchMerged: BookChapterMeta[]) => Promise<void> | void;
};

async function enrichBookMetaWithAgents(
	c: AppContext,
	userId: string,
	raw: string,
	chapters: BookChapterMeta[],
	mode: BookDerivationMode = "standard",
	options?:
		| BookMetaEnrichOptions
		| ((
				input: {
					totalBatches: number;
					completedBatches: number;
					totalChapters: number;
					processedChapters: number;
					activeBatch?: number;
				},
		  ) => Promise<void> | void),
	onProgress?: (input: {
		totalBatches: number;
		completedBatches: number;
		totalChapters: number;
		processedChapters: number;
		activeBatch?: number;
	}) => Promise<void> | void,
): Promise<{ chapters: BookChapterMeta[]; usedAgents: boolean }> {
	if (!chapters.length) return { chapters, usedAgents: false };
	const resolvedOptions =
		options && typeof options === "object"
			? options
			: ({} as BookMetaEnrichOptions);
	const progressHandler =
		(typeof options === "function" ? options : null) ||
		(typeof onProgress === "function" ? onProgress : null);
	const isDeep = mode === "deep";
	const batchMaxChars =
		typeof resolvedOptions?.batchMaxChars === "number" &&
		Number.isFinite(resolvedOptions.batchMaxChars)
			? Math.max(10_000, Math.min(3_600_000, Math.trunc(resolvedOptions.batchMaxChars)))
			: readBookMetadataBatchMaxChars(mode);
	const batchMaxChapters =
		typeof resolvedOptions?.batchMaxChapters === "number" &&
		Number.isFinite(resolvedOptions.batchMaxChapters)
			? Math.max(2, Math.min(100, Math.trunc(resolvedOptions.batchMaxChapters)))
			: readBookMetadataBatchMaxChapters(mode);
	const batchConcurrency =
		typeof resolvedOptions?.batchConcurrency === "number" &&
		Number.isFinite(resolvedOptions.batchConcurrency)
			? Math.max(1, Math.min(50, Math.trunc(resolvedOptions.batchConcurrency)))
			: readBookMetadataBatchConcurrency(mode);
	const snippetMaxChars =
		typeof resolvedOptions?.snippetMaxChars === "number" &&
		Number.isFinite(resolvedOptions.snippetMaxChars)
			? Math.max(600, Math.min(120_000, Math.trunc(resolvedOptions.snippetMaxChars)))
			: undefined;
	const useLocalFileContext =
		typeof resolvedOptions?.useLocalFileContext === "boolean"
			? resolvedOptions.useLocalFileContext
			: false;
	const localSourceFilePath = String(resolvedOptions?.localSourceFilePath || "").trim();
	const localSourceFilePathForAgents = normalizeProjectDataPathForAgents(localSourceFilePath);
	if (useLocalFileContext && localSourceFilePath && !localSourceFilePathForAgents) {
		throw new Error("agents-cli parser error: local_file_access_failed");
	}
	const shouldUseLocalFileContext = useLocalFileContext && Boolean(localSourceFilePathForAgents);
	const skipChecker = resolvedOptions?.skipChecker === true;
	const oneShot = resolvedOptions?.oneShot === true;
	const privilegedLocalAccess = resolvedOptions?.privilegedLocalAccess === true;
	const preferSingleTurn = resolvedOptions?.preferSingleTurn === true;
	const onBatchDone = resolvedOptions?.onBatchDone;
	const stageWindowChapters = readBookMetadataStageWindowChapters(mode);
	const chapterWindows = oneShot
		? [chapters.slice()]
		: chunkBookChaptersByCount(chapters, stageWindowChapters);
	const batchesByWindow = oneShot
		? [chapters.length ? [chapters.slice()] : []]
		: chapterWindows.map((windowChapters) =>
				chunkBookChaptersByPromptBudget(windowChapters, raw, {
					maxChars: batchMaxChars,
					maxChapters: batchMaxChapters,
				}),
		  );
	const totalBatches = batchesByWindow.reduce((sum, x) => sum + x.length, 0);
	let completedBatches = 0;
	let processedChapters = 0;
	let merged = chapters;
	let consumedBatchCount = 0;
	for (const batches of batchesByWindow) {
		const windowBatchOffset = consumedBatchCount;
		consumedBatchCount += batches.length;
		const batchResults = await mapWithConcurrency(
			batches,
			batchConcurrency,
			async (batch, batchIndex) => {
				const executionMode = resolveBookMetadataAgentExecutionMode({
					mode,
					chapterCount: batch.length,
					batchCount: totalBatches,
					preferSingleTurn,
				});
				const shouldSkipCheckerForBatch = skipChecker || executionMode === "single";
				const activeBatch = windowBatchOffset + batchIndex + 1;
				await progressHandler?.({
					totalBatches,
					completedBatches,
					totalChapters: chapters.length,
					processedChapters: Math.min(chapters.length, processedChapters),
					activeBatch,
				});
				const startTs = Date.now();
				const heartbeat = setInterval(() => {
					void progressHandler?.({
						totalBatches,
						completedBatches,
						totalChapters: chapters.length,
						processedChapters: Math.min(chapters.length, processedChapters),
						activeBatch,
					});
				}, 10_000);
				const parseBatchWithRetry = async (
					targetBatch: BookChapterMeta[],
					retryDepth = 0,
				): Promise<BookChapterMeta[]> => {
					const targetOutlineBase = targetBatch.map((ch) => ({
						chapter: ch.chapter,
						currentTitle: ch.title,
					}));
					const targetOutline = shouldUseLocalFileContext
						? targetOutlineBase
						: targetBatch.map((ch) => ({
								chapter: ch.chapter,
								currentTitle: ch.title,
								startOffset: Math.max(0, Math.trunc(Number(ch.startOffset || 0))),
								endOffset: Math.max(0, Math.trunc(Number(ch.endOffset || 0))),
								snippet: buildChapterSnippet(
									raw,
									ch,
									snippetMaxChars,
								),
							}));
						const parsePrompt = [
							"你是小说分析助手。请基于章节片段，返回严格 JSON。",
						'格式：{"chapters":[{"chapter":1,"title":"更准确标题","summary":"一句话摘要","keywords":["关键词1","关键词2"],"coreConflict":"A想要X但被B阻碍","characters":[{"name":"角色名","description":"外观/身份/性格"}],"props":[{"name":"道具","description":"材质/特征/用途","narrativeImportance":"critical|supporting|background","visualNeed":"must_render|shared_scene_only|mention_only","functionTags":["plot_trigger|combat|threat|identity_marker|continuity_anchor|transaction|environment_clutter"],"reusableAssetPreferred":true,"independentlyFramable":true}],"scenes":[{"name":"场景","description":"空间/光线/氛围"}],"locations":[{"name":"地点","description":"地理位置/环境"}]}]}',
						"要求：",
						"- chapter 必须对应输入 chapter",
						"- title 简洁准确",
						"- summary 20-80字",
						"- keywords 3-8个，不重复",
						"- characters/props/scenes/locations 按出场重要性排序，每项 0-8 条",
						"- 每个实体对象至少包含 name，description 可选但建议有",
							"- props 必须做语义判断：只有确实值得单独建立可复用视觉资产的道具，visualNeed 才能标为 must_render 或 reusableAssetPreferred=true",
							"- 日常背景杂物、环境堆叠、可由场景整体承载的物件，必须标为 shared_scene_only 或 mention_only，而不是一律当独立道具",
							...(executionMode === "single"
								? [
										"- 当前是单章快速提取路径：你必须在这一回合直接给出完整章节元数据，不要再拆分团队步骤或等待 checker 二次补全。",
								  ]
								: []),
							...(shouldUseLocalFileContext && localSourceFilePathForAgents
								? [
										`- 源文件在本地：${localSourceFilePathForAgents}`,
									...(privilegedLocalAccess
										? [
												"- 已开启特权本地访问：允许使用 bash/read_file/write_file/edit_file 对 project-data 下内容进行读取与必要中间文件处理。",
												"- 解析必须以本地源文件为准，不得凭记忆编造。",
												"- 若可获得章节索引/边界信息，必须先按边界定点读取目标片段，禁止先通读全文。",
												"- 同一轮内禁止对同一路径使用相同参数重复读取。",
										  ]
										: [
												"- 你必须使用 bash 直接读取本地源文件。",
												"- 只允许使用纯 shell 文本工具（grep/sed/awk/head/tail/cut/sort/uniq/wc/tr），禁止 python/python3/node 等解释器。",
												`- 在任何语义分析前，必须先执行并确认成功：bash -lc 'test -r \"${localSourceFilePathForAgents}\" && sed -n \"1,5p\" \"${localSourceFilePathForAgents}\" >/dev/null && echo __READ_OK__'`,
												"- 若未得到 __READ_OK__，必须直接返回：{\"error\":\"MUST_READ_LOCAL_FILE_VIA_BASH\"}",
												"- 若可获得章节索引/边界信息，必须先按边界定点读取目标片段，禁止先通读全文。",
												"- 同一轮内禁止对同一路径使用相同参数重复读取 bash。",
										  ]),
									"- 你自行决定如何从原文中定位与抽取章节文本（可按标题、行号、上下文块等策略），不要依赖固定 offset。",
									"- 不要假设章节内容，必须以本地文件读取结果为准。",
									`- 如果无法读取本地源文件，必须直接返回错误 JSON：{"error":"${privilegedLocalAccess ? "LOCAL_FILE_ACCESS_FAILED" : "MUST_READ_LOCAL_FILE_VIA_BASH"}"}。`,
							  ]
							: []),
						...(isDeep ? ["- 深度模式：尽量减少漏提角色与道具，章节语义抽取要更完整"] : []),
						"- 严格输出 JSON，不要额外解释",
						JSON.stringify(
							shouldUseLocalFileContext && localSourceFilePathForAgents
								? {
										sourceFile: localSourceFilePathForAgents,
										chapters: targetOutline,
								  }
								: { chapters: targetOutline },
						),
						].join("\n");
					try {
						const parserExtras =
							executionMode === "team"
								? {
										systemPrompt: buildBookMetadataTeamSystemPrompt("parser"),
										bridgeTimeoutMs: getAgentsBridgeTimeoutByMode(isDeep ? "deep" : "standard"),
										requiredSkills: [BOOK_METADATA_TEAM_SKILL],
										...(shouldUseLocalFileContext && localSourceFilePathForAgents
											? {
													...(privilegedLocalAccess
														? { privilegedLocalAccess: true }
														: { forceLocalResourceViaBash: true }),
													localResourcePaths: [localSourceFilePathForAgents],
											  }
											: {}),
								  }
								: {
										bridgeTimeoutMs: getAgentsBridgeTimeoutByMode(isDeep ? "deep" : "standard"),
										...(shouldUseLocalFileContext && localSourceFilePathForAgents
											? {
													...(privilegedLocalAccess
														? { privilegedLocalAccess: true }
														: { forceLocalResourceViaBash: true }),
													localResourcePaths: [localSourceFilePathForAgents],
											  }
											: {}),
								  };
						const parseResult = await runAgentsBridgeChatTask(c, userId, {
							kind: "chat",
							prompt: parsePrompt,
							extras: parserExtras,
						});
						const parseText =
							typeof (parseResult as any)?.raw?.text === "string"
								? (parseResult as any).raw.text
								: "";
						const parseJson = extractFirstJsonObject(parseText) as any;
						if (parseJson && typeof parseJson === "object" && typeof parseJson.error === "string") {
							const parserErr = String(parseJson.error || "").trim();
							const parserErrUpper = parserErr.toUpperCase();
							const canRetryMustRead =
								retryDepth < 3 && parserErrUpper.includes("MUST_READ_LOCAL_FILE_VIA_BASH");
							if (canRetryMustRead) {
								return await parseBatchWithRetry(targetBatch, retryDepth + 1);
							}
							if (parserErr) {
								throw new Error(`agents-cli parser error: ${parserErr}`);
							}
						}
						const parseList = Array.isArray(parseJson?.chapters) ? parseJson.chapters : [];
						let batchMerged = mergeChapterMetadataFromAgent(targetBatch, parseList);
						try {
							return assertAgentsChaptersComplete(batchMerged);
						} catch {
							// run checker
						}
						const canRetrySplitByIncomplete =
							retryDepth < 6 &&
							targetBatch.length > 2 &&
							(oneShot || shouldSkipCheckerForBatch);
						if (canRetrySplitByIncomplete) {
							const mid = Math.floor(targetBatch.length / 2);
							const left = targetBatch.slice(0, mid);
							const right = targetBatch.slice(mid);
							const leftResult = await parseBatchWithRetry(left, retryDepth + 1);
							const rightResult = await parseBatchWithRetry(right, retryDepth + 1);
							return [...leftResult, ...rightResult].sort((a, b) => a.chapter - b.chapter);
						}
						const canRetrySingleTurn =
							executionMode === "single" &&
							retryDepth < 2 &&
							targetBatch.length === 1;
						if (canRetrySingleTurn) {
							return await parseBatchWithRetry(targetBatch, retryDepth + 1);
						}
						if (shouldSkipCheckerForBatch || oneShot) {
							throw new Error("agents-cli parser output incomplete");
						}
						const checkerPrompt = [
							"你是章节元数据 QA 审校代理。请检查 parser 输出并补全缺失字段。",
							"输出章节数量必须与输入章节数量一致，不得漏章。",
							"每章都要有：title、summary、keywords、coreConflict、characters、props、scenes、locations。",
							"props 必须包含 AI 判断后的结构化视觉语义字段，不能只回 name/description。",
							'props[].narrativeImportance 只能是 critical|supporting|background；visualNeed 只能是 must_render|shared_scene_only|mention_only。',
							'严格输出 JSON：{"chapters":[...]}',
							JSON.stringify({
								chaptersInput: targetOutline,
								chaptersParsed: batchMerged.map((picked) => ({
									chapter: picked.chapter,
									title: picked.title,
									summary: picked.summary || "",
									keywords: picked.keywords || [],
									coreConflict: picked.coreConflict || "",
									characters: picked.characters || [],
									props: picked.props || [],
									scenes: picked.scenes || [],
									locations: picked.locations || [],
								})),
							}),
						].join("\n");
						const checkerResult = await runAgentsBridgeChatTask(c, userId, {
							kind: "chat",
							prompt: checkerPrompt,
							extras: {
								systemPrompt: buildBookMetadataTeamSystemPrompt("checker"),
								bridgeTimeoutMs: getAgentsBridgeTimeoutByMode(isDeep ? "deep" : "standard"),
								requiredSkills: [BOOK_METADATA_TEAM_SKILL],
								...(shouldUseLocalFileContext && localSourceFilePathForAgents
									? {
											...(privilegedLocalAccess
												? { privilegedLocalAccess: true }
												: { forceLocalResourceViaBash: true }),
											localResourcePaths: [localSourceFilePathForAgents],
									  }
									: {}),
							},
						});
						const checkerText =
							typeof (checkerResult as any)?.raw?.text === "string"
								? (checkerResult as any).raw.text
								: "";
						const checkerJson = extractFirstJsonObject(checkerText) as any;
						const checkerList = Array.isArray(checkerJson?.chapters) ? checkerJson.chapters : [];
						batchMerged = mergeChapterMetadataFromAgent(batchMerged, checkerList);
						return assertAgentsChaptersComplete(batchMerged);
					} catch (err) {
						const shouldRetrySplit =
							retryDepth < 4 &&
							targetBatch.length > 2 &&
							isAgentsBridgeUnavailableError(err) &&
							!isAgentsBridgeDnsOrConfigError(err);
						if (!shouldRetrySplit) throw err;
						const mid = Math.floor(targetBatch.length / 2);
						const left = targetBatch.slice(0, mid);
						const right = targetBatch.slice(mid);
						const leftResult = await parseBatchWithRetry(left, retryDepth + 1);
						const rightResult = await parseBatchWithRetry(right, retryDepth + 1);
						return [...leftResult, ...rightResult].sort((a, b) => a.chapter - b.chapter);
					}
				};
					try {
						const finalized = await parseBatchWithRetry(batch, 0);
						if (typeof onBatchDone === "function") {
							await onBatchDone(finalized);
						}
						completedBatches += 1;
						processedChapters += batch.length;
					await progressHandler?.({
						totalBatches,
						completedBatches,
						totalChapters: chapters.length,
						processedChapters: Math.min(chapters.length, processedChapters),
						activeBatch,
					});
					return finalized;
				} finally {
					clearInterval(heartbeat);
					const elapsedSec = Math.max(1, Math.round((Date.now() - startTs) / 1000));
					await progressHandler?.({
						totalBatches,
						completedBatches,
						totalChapters: chapters.length,
						processedChapters: Math.min(chapters.length, processedChapters),
						activeBatch,
					});
					console.log(
						`[book-metadata] batch ${activeBatch}/${totalBatches} done, chapters=${batch.length}, elapsed=${elapsedSec}s`,
					);
				}
			},
		);
		for (const batchMerged of batchResults) {
			merged = mergeChapterMetadataFromAgent(merged, batchMerged);
		}
	}
	if (merged.length !== chapters.length) {
		throw new Error("agents-cli chapters count mismatch");
	}
	return { chapters: assertAgentsChaptersComplete(merged), usedAgents: true };
}

function getPublicBase(c: Pick<AppContext, "env" | "req">): string {
	return resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
}

/**
 * 上传视频的服务端 poster（best-effort）：对象此刻已在 TOS，让 media-worker 按 key 抽首帧。
 * 失败/未启用返回 null，asset 行照常落库——画布壳层仍有客户端抓帧兜底，但那会让每个新访客
 * 首开画布批量拉 mp4 range（存量已由 scripts/backfill-video-posters.ts 回填，这里堵新增源头）。
 */
async function captureUploadedVideoPoster(
	userId: string,
	key: string,
): Promise<string | null> {
	try {
		const viaWorker = await extractPosterViaMediaWorker({
			videoR2Key: key,
			userId,
			timeoutMs: 30_000,
		});
		return viaWorker?.posterUrl ?? null;
	} catch {
		return null;
	}
}

function detectUploadExtension(file: File): string {
	const name = (file as any).name as string | undefined;
	const rawType = file.type || "";
	const contentType = rawType.split(";")[0].trim();
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
	};
	if (contentType && known[contentType]) return known[contentType];
	if (name && typeof name === "string") {
		const match = name.match(/\.([a-zA-Z0-9]+)$/);
		if (match && match[1]) return match[1].toLowerCase();
	}
	if (contentType.startsWith("image/")) {
		return contentType.slice("image/".length) || "png";
	}
	return "bin";
}

function buildUserUploadKey(userId: string, ext: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const now = new Date();
	const datePrefix = `${now.getUTCFullYear()}${String(
		now.getUTCMonth() + 1,
	).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	return `uploads/user/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;
}

function isHostedUrl(url: string, publicBase: string): boolean {
	const trimmed = (url || "").trim();
	if (!trimmed) return false;
	if (publicBase) {
		return trimmed.startsWith(`${publicBase}/`);
	}
	// Fallback: default generated asset key prefix
	return /^\/?gen\//.test(trimmed);
}

const ASSET_LIST_TEXT_MAX_CHARS = 8_000;

function trimAssetTextForList(value: unknown): {
	text: string;
	truncated: boolean;
	originalLength: number;
} {
	const raw = String(value || "");
	const originalLength = raw.length;
	if (originalLength <= ASSET_LIST_TEXT_MAX_CHARS) {
		return { text: raw, truncated: false, originalLength };
	}
	return {
		text: raw.slice(0, ASSET_LIST_TEXT_MAX_CHARS),
		truncated: true,
		originalLength,
	};
}

function compactAssetDataForList(data: unknown): unknown {
	if (!data || typeof data !== "object") return data;
	const next = { ...(data as Record<string, unknown>) };
	let truncated = false;
	let maxOriginalLength = 0;
	const textKeys = ["content", "prompt"];
	for (const key of textKeys) {
		if (typeof next[key] !== "string") continue;
		const { text, truncated: flag, originalLength } = trimAssetTextForList(next[key]);
		next[key] = text;
		if (flag) truncated = true;
		maxOriginalLength = Math.max(maxOriginalLength, originalLength);
	}
	if (Array.isArray(next.textResults)) {
		const list = (next.textResults as unknown[])
			.slice(0, 10)
			.map((item) => {
				if (!item || typeof item !== "object") return item;
				const row = { ...(item as Record<string, unknown>) };
				if (typeof row.text === "string") {
					const { text, truncated: flag, originalLength } = trimAssetTextForList(row.text);
					row.text = text;
					if (flag) truncated = true;
					maxOriginalLength = Math.max(maxOriginalLength, originalLength);
				}
				return row;
			});
		next.textResults = list;
	}
	if (truncated) {
		(next as any).contentTruncated = true;
		(next as any).contentOriginalLength = maxOriginalLength;
	}
	return next;
}

assetRouter.get("/", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	const cursor = c.req.query("cursor") || null;
	const projectId = c.req.query("projectId") || null;
	const projectIds = Array.from(
		new Set(
			(c.req.queries("projectId") || [])
				.map((value) => String(value).trim())
				.filter(Boolean),
		),
	).slice(0, 100);
	const kind = c.req.query("kind") || null;
	const fullData = String(c.req.query("fullData") || "").trim() === "1";

	const rows = await listAssetsForUser(c.env.DB, userId, {
		limit,
		cursor,
		projectId,
		projectIds,
		kind,
	});
	const payload = rows.map((row) =>
		ServerAssetSchema.parse({
			id: row.id,
			name: row.name,
			data: row.data
				? fullData
					? JSON.parse(row.data)
					: compactAssetDataForList(JSON.parse(row.data))
				: null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			userId: row.owner_id,
			projectId: row.project_id,
		}),
	);
	const nextCursor = rows.length ? rows[rows.length - 1].created_at : null;
	return c.json({ items: payload, cursor: nextCursor });
});

assetRouter.post("/", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateAssetSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const textContent = extractTextUploadContentFromAssetData(parsed.data.data);
	if (typeof textContent === "string") {
		const contentBytes = getUtf8TextByteLength(textContent);
		if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
			return c.json(buildTextUploadTooLargePayload(contentBytes), 413);
		}
	}
	const nowIso = new Date().toISOString();
	const row = await createAssetRow(
		c.env.DB,
		userId,
		{
			name: parsed.data.name,
			data: parsed.data.data,
			projectId: parsed.data.projectId,
		},
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId: row.owner_id,
		projectId: row.project_id,
	});
	return c.json(payload);
});

async function ingestBookFromContent(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		title: string;
		content: string;
		sourceBytes: Uint8Array;
		source: BookSourceMetadataV1;
		strictAgents?: boolean;
		onProgress?: (progress: {
			phase: string;
			percent: number;
			message?: string;
			totalChapters?: number;
			processedChapters?: number;
		}) => Promise<void> | void;
	},
): Promise<{
	ok: true;
	bookId: string;
	title: string;
	chapterCount: number;
	processedBy: string;
	warnings: string[];
}> {
	const project = await getProjectForOwner(c.env.DB, input.projectId, userId);
	if (!project) {
		throw new Error("project not found");
	}
	const projectBooksRoot = buildProjectBooksRoot(input.projectId, userId);
	await fs.mkdir(projectBooksRoot, { recursive: true });
	const safeTitle = sanitizePathSegment(input.title) || "book";
	const bookId = `${safeTitle}-${Date.now()}`;
	const bookDir = path.join(projectBooksRoot, bookId);
	await fs.mkdir(bookDir, { recursive: true });

	const sourceDirectory = path.join(bookDir, "source");
	const storedSourcePath = path.join(
		sourceDirectory,
		storedBookSourceFileName(input.source.format),
	);
	await fs.mkdir(sourceDirectory, { recursive: true });
	await fs.writeFile(storedSourcePath, input.sourceBytes);
	const source: BookSourceMetadataV1 = {
		...input.source,
		storedPath: path.relative(process.cwd(), storedSourcePath),
	};
	const rawPath = path.join(bookDir, "raw.md");
	await fs.writeFile(rawPath, input.content, "utf8");

	const index = await buildBookIndexFromContent(c as any, userId, {
		bookId,
		projectId: input.projectId,
		title: input.title,
		content: input.content,
		rawPath,
		prevIndex: null,
		strictAgents: input.strictAgents !== false,
		onProgress: input.onProgress,
	});
	const indexWithChunks = await writeBookRawChunksAndAttachMetadata({
		bookDir,
		rawContent: input.content,
		chapters: Array.isArray(index?.chapters) ? (index.chapters as BookChapterMeta[]) : [],
		index,
	});
	const persistedIndex = await attachFreshBookEvidenceIndex({
		bookDirectory: bookDir,
		bookId,
		projectId: input.projectId,
		title: input.title,
		rawText: input.content,
		index: indexWithChunks as BookIndexRecord,
		source,
	});
	const indexPath = path.join(bookDir, "index.json");
	await replaceBookIndex(indexPath, persistedIndex);

	const nowIso = new Date().toISOString();

	await createAssetRow(
		c.env.DB,
		userId,
		{
			name: input.title,
			projectId: input.projectId,
			data: {
				kind: "novelBook",
				bookId,
				title: input.title,
				chapterCount: Number(persistedIndex.chapterCount || 0) || 0,
				indexPath: path.relative(process.cwd(), indexPath),
				rawPath: path.relative(process.cwd(), rawPath),
				source,
				evidenceIndex: persistedIndex.evidenceIndex,
				updatedAt: persistedIndex.updatedAt,
			},
		},
		nowIso,
	);

	// Sync every chapter into the DB immediately so data is never lost if the
	// local file system is wiped. Local raw.md / chunks remain for agents-cli
	// only. ON CONFLICT preserves user-managed fields (status, continuity_context,
	// style_profile_override) while updating title, summary, and book links.
	const bookChapters = Array.isArray(persistedIndex?.chapters)
		? (persistedIndex.chapters as BookChapterMeta[])
		: [];
	if (bookChapters.length > 0) {
		await upsertChaptersFromBook({
			db: c.env.DB,
			ownerId: userId,
			projectId: input.projectId,
			bookId,
			chapters: bookChapters.map((ch) => ({
				chapter: ch.chapter,
				title: ch.title,
				summary: typeof ch.summary === "string" ? ch.summary : null,
			})),
			nowIso,
		});
	}

	return {
		ok: true,
		bookId,
		title: input.title,
		chapterCount: Number(persistedIndex.chapterCount || 0) || 0,
		processedBy: String(persistedIndex.processedBy || ""),
		warnings: Array.isArray(persistedIndex.derivationWarnings) ? persistedIndex.derivationWarnings : [],
	};
}

assetRouter.post("/books/ingest", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isNodeRuntime()) {
		return c.json({ error: "books ingest requires node runtime" }, 400);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = IngestProjectBookSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const contentBytes = getUtf8TextByteLength(parsed.data.content);
	if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
		return c.json(buildTextUploadTooLargePayload(contentBytes), 413);
	}
	const activeJob = await findActiveBookUploadJob(parsed.data.projectId, userId);
	if (activeJob) {
		return c.json(
			{
				error: "当前项目有小说上传任务进行中，请等待完成后再上传",
				code: "BOOK_UPLOAD_JOB_ACTIVE",
				job: toBookUploadJobPublic(activeJob),
			},
			409,
		);
	}
	try {
		const sourceBytes = new TextEncoder().encode(parsed.data.content);
		const parsedSource = parseBookSource({
			fileName: `${parsed.data.title}.txt`,
			bytes: sourceBytes,
		});
		const result = await runBookDerivationQueued(() =>
			ingestBookFromContent(c as any, userId, {
				projectId: parsed.data.projectId,
				title: parsed.data.title,
				content: parsedSource.text,
				sourceBytes,
				source: parsedSource.metadata,
				strictAgents: true,
			}),
		);
		return c.json(result);
	} catch (err: any) {
		if (String(err?.message || "").includes("project not found")) {
			return c.json({ error: "project not found" }, 404);
		}
		const mapped = mapBookAgentsDeriveError(err);
		return c.json(mapped.payload, mapped.status as 400 | 401 | 403 | 404 | 500);
	}
});

assetRouter.post("/books/upload/start", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isNodeRuntime()) {
		return c.json({ error: "books upload requires node runtime" }, 400);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = StartProjectBookUploadSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const projectId = parsed.data.projectId;
	const title = parsed.data.title.trim();
	const sourceFileName = sanitizeUploadName(parsed.data.sourceFileName);
	const contentBytes = Math.max(0, Math.trunc(parsed.data.contentBytes));
	if (!sourceFileName || !isSupportedBookSourceFileName(sourceFileName)) {
		return c.json(
			{
				error: "仅支持 .txt、.text、.md、.markdown、.docx、.epub 书籍源文件",
				code: "BOOK_SOURCE_UNSUPPORTED_TYPE",
			},
			400,
		);
	}
	if (contentBytes === 0) {
		return c.json(
			{ error: "书籍源文件为空", code: "BOOK_SOURCE_EMPTY" },
			400,
		);
	}
	if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
		return c.json(buildTextUploadTooLargePayload(contentBytes), 413);
	}
	const activeJob = await findActiveBookUploadJob(projectId, userId);
	if (activeJob) {
		return c.json(
			{
				error: "当前项目有小说上传任务进行中，请等待完成后再上传",
				code: "BOOK_UPLOAD_JOB_ACTIVE",
				job: toBookUploadJobPublic(activeJob),
			},
			409,
		);
	}
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	const uploadId = crypto.randomUUID();
	const nowIso = new Date().toISOString();
	const tmpPath = buildBookUploadTmpPath(projectId, userId, uploadId);
	await fs.mkdir(path.dirname(tmpPath), { recursive: true });
	await fs.writeFile(tmpPath, new Uint8Array());
	await writeBookUploadSession({
		id: uploadId,
		userId,
		projectId,
		title,
		sourceFileName,
		tmpPath,
		bytes: 0,
		contentBytes,
		createdAt: nowIso,
		updatedAt: nowIso,
	});
	return c.json({ ok: true, uploadId, projectId, title, sourceFileName });
});

assetRouter.post("/books/upload/:uploadId/append", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isNodeRuntime()) {
		return c.json({ error: "books upload requires node runtime" }, 400);
	}
	const uploadId = sanitizePathSegment(c.req.param("uploadId") || "");
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!uploadId) return c.json({ error: "uploadId is required" }, 400);
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const contentType = normalizeContentType(c.req.header("content-type"));
	if (contentType !== "application/octet-stream") {
		return c.json(
			{
				error: "book upload chunk Content-Type must be application/octet-stream",
				code: "BOOK_UPLOAD_CONTENT_TYPE_INVALID",
			},
			415,
		);
	}
	const offset = Number(c.req.query("offset"));
	if (!Number.isInteger(offset) || offset < 0) {
		return c.json(
			{ error: "offset must be a non-negative integer", code: "BOOK_UPLOAD_OFFSET_INVALID" },
			400,
		);
	}
	let chunk: Uint8Array;
	try {
		chunk = new Uint8Array(await c.req.arrayBuffer());
	} catch (error) {
		return c.json(
			{
				error: "读取书籍上传分块失败",
				code: "BOOK_UPLOAD_CHUNK_READ_FAILED",
				details: { reason: readUnknownErrorMessage(error) },
			},
			400,
		);
	}
	if (chunk.byteLength === 0) {
		return c.json(
			{ error: "book upload chunk is empty", code: "BOOK_UPLOAD_CHUNK_EMPTY" },
			400,
		);
	}
	if (chunk.byteLength > BOOK_UPLOAD_CHUNK_MAX_BYTES) {
		return c.json(
			{
				error: `book upload chunk exceeds ${BOOK_UPLOAD_CHUNK_MAX_BYTES} bytes`,
				code: "BOOK_UPLOAD_CHUNK_TOO_LARGE",
				maxBytes: BOOK_UPLOAD_CHUNK_MAX_BYTES,
			},
			413,
		);
	}
	try {
		const locked = await withBookUploadSessionLock({
			sessionMetaPath: buildBookUploadMetaPath(projectId, userId, uploadId),
			operation: async () => {
				const session = await readBookUploadSession(projectId, userId, uploadId);
				if (!session) return c.json({ error: "upload session not found" }, 404);
				if (session.finalizedJobId) {
					return c.json(
						{
							error: "book upload session is already finalized",
							code: "BOOK_UPLOAD_SESSION_FINALIZED",
							jobId: session.finalizedJobId,
						},
						409,
					);
				}
				if (offset !== session.bytes) {
					return c.json(
						{
							error: "book upload offset does not match persisted bytes",
							code: "BOOK_UPLOAD_OFFSET_MISMATCH",
							expectedOffset: session.bytes,
							receivedOffset: offset,
						},
						409,
					);
				}
				const storedBytesBeforeAppend = await readBookUploadSourceSize(session);
				if (storedBytesBeforeAppend !== session.bytes) {
					throw new BookSourceParseError(
						"book_source_size_mismatch",
						"书籍上传临时源与会话已记录字节数不一致",
						{
							uploadId,
							sessionBytes: session.bytes,
							storedBytes: storedBytesBeforeAppend,
						},
					);
				}
				const nextBytes = session.bytes + chunk.byteLength;
				if (nextBytes > TEXT_UPLOAD_MAX_BYTES) {
					return c.json(buildTextUploadTooLargePayload(nextBytes), 413);
				}
				if (nextBytes > session.contentBytes) {
					return c.json(
						{
							error: "book upload bytes exceed the declared source file size",
							code: "BOOK_UPLOAD_SIZE_MISMATCH",
							expectedBytes: session.contentBytes,
							nextBytes,
						},
						409,
					);
				}
				await fs.appendFile(session.tmpPath, chunk);
				const storedBytesAfterAppend = await readBookUploadSourceSize(session);
				if (storedBytesAfterAppend !== nextBytes) {
					throw new BookSourceParseError(
						"book_source_size_mismatch",
						"书籍上传分块写入后的文件字节数不一致",
						{
							uploadId,
							expectedBytes: nextBytes,
							storedBytes: storedBytesAfterAppend,
						},
					);
				}
				session.bytes = nextBytes;
				session.updatedAt = new Date().toISOString();
				await writeBookUploadSession(session);
				return c.json({ ok: true, uploadId, bytes: session.bytes });
			},
		});
		if (locked.status === "busy") {
			return c.json(
				{
					error: "book upload session is busy; retry the same offset",
					code: "BOOK_UPLOAD_SESSION_BUSY",
					receivedOffset: offset,
				},
				409,
			);
		}
		return locked.value;
	} catch (error) {
		if (error instanceof BookUploadSessionLockError) {
			reportBookUploadSessionLockError({ error, projectId, userId, uploadId });
			return c.json(
				{ error: error.message, code: error.code },
				500,
			);
		}
		if (error instanceof BookSourceParseError) {
			const mapped = mapBookAgentsDeriveError(error);
			return c.json(
				mapped.payload,
				mapped.status as 400 | 409 | 422 | 500,
			);
		}
		throw error;
	}
});

assetRouter.post("/books/upload/:uploadId/finish", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isNodeRuntime()) {
		return c.json({ error: "books upload requires node runtime" }, 400);
	}
	const uploadId = sanitizePathSegment(c.req.param("uploadId") || "");
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!uploadId) return c.json({ error: "uploadId is required" }, 400);
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FinishProjectBookUploadSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	try {
		const locked = await withBookUploadSessionLock({
			sessionMetaPath: buildBookUploadMetaPath(projectId, userId, uploadId),
			operation: async () => {
				const session = await readBookUploadSession(projectId, userId, uploadId);
				if (!session) return c.json({ error: "upload session not found" }, 404);
				if (session.finalizedJobId) {
					const finalizedJob = await readBookUploadJob(
						projectId,
						userId,
						session.finalizedJobId,
					);
					if (!finalizedJob) {
						return c.json(
							{
								error: "finalized book upload job metadata is missing",
								code: "BOOK_UPLOAD_FINALIZED_JOB_MISSING",
								jobId: session.finalizedJobId,
							},
							409,
						);
					}
					if (finalizedJob.status === "failed") {
						return c.json(
							{
								error: "finalized book upload job failed",
								code: "BOOK_UPLOAD_FINALIZED_JOB_FAILED",
								job: toBookUploadJobPublic(finalizedJob),
							},
							409,
						);
					}
					return c.json(
						{
							ok: true,
							reused: true,
							job: toBookUploadJobPublic(finalizedJob),
						},
						finalizedJob.status === "succeeded" ? 200 : 202,
					);
				}
				const activeJob = await findActiveBookUploadJob(projectId, userId);
				if (activeJob) {
					return c.json(
						{
							error: "当前项目有小说上传任务进行中，请等待完成后再上传",
							code: "BOOK_UPLOAD_JOB_ACTIVE",
							job: toBookUploadJobPublic(activeJob),
						},
						409,
					);
				}
				const storedBytes = await readBookUploadSourceSize(session);
				if (storedBytes === 0) {
					return c.json(
						{ error: "uploaded source file is empty", code: "BOOK_SOURCE_EMPTY" },
						400,
					);
				}
				if (
					session.bytes !== session.contentBytes ||
					storedBytes !== session.contentBytes
				) {
					return c.json(
						{
							error: "uploaded source file is incomplete",
							code: "BOOK_UPLOAD_SIZE_MISMATCH",
							expectedBytes: session.contentBytes,
							sessionBytes: session.bytes,
							storedBytes,
						},
						409,
					);
				}
				const now = new Date().toISOString();
				const job: BookUploadJobMeta = {
					id: crypto.randomUUID(),
					uploadId: session.id,
					userId,
					projectId: session.projectId,
					title: session.title,
					strictAgents: parsed.data.strictAgents !== false,
					status: "queued",
					progress: {
						phase: "queued",
						percent: 0,
						message: "任务已入队，等待执行",
					},
					error: null,
					createdAt: now,
					updatedAt: now,
				};
				await writeBookUploadJob(job);
				session.finalizedJobId = job.id;
				session.updatedAt = now;
				try {
					await writeBookUploadSession(session);
				} catch (error) {
					const finalizationError = new BookSourceParseError(
						"book_source_upload_read_failed",
						"写入书籍上传会话完成状态失败",
						{
							uploadId,
							jobId: job.id,
							reason: readUnknownErrorMessage(error),
						},
					);
					job.status = "failed";
					job.progress = {
						phase: "failed",
						percent: 100,
						message: "任务入队失败",
					};
					job.error = {
						code: finalizationError.code.toUpperCase(),
						message: finalizationError.message,
						details: finalizationError.details,
					};
					job.finishedAt = new Date().toISOString();
					job.updatedAt = job.finishedAt;
					await writeBookUploadJob(job);
					throw finalizationError;
				}
				enqueueBookUploadJob({
					jobId: job.id,
					userId,
					projectId: job.projectId,
					env: c.env,
					requestUrl: c.req.url,
					authorization: (c.req.header("authorization") || "").trim() || undefined,
					apiKey: (c.req.header("x-api-key") || "").trim() || undefined,
				});
				void drainBookUploadJobs();
				return c.json({ ok: true, reused: false, job: toBookUploadJobPublic(job) }, 202);
			},
		});
		if (locked.status === "busy") {
			return c.json(
				{
					error: "book upload session is busy; retry finish",
					code: "BOOK_UPLOAD_SESSION_BUSY",
				},
				409,
			);
		}
		return locked.value;
	} catch (error) {
		if (error instanceof BookUploadSessionLockError) {
			reportBookUploadSessionLockError({ error, projectId, userId, uploadId });
			return c.json({ error: error.message, code: error.code }, 500);
		}
		const mapped = mapBookAgentsDeriveError(error);
		return c.json(
			mapped.payload,
			mapped.status as 400 | 401 | 403 | 404 | 409 | 422 | 500,
		);
	}
});

assetRouter.get("/books/upload/jobs/latest", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	const jobs = await listBookUploadJobsForProject(projectId, userId);
	const latest = await resolveBookUploadJobRuntimeState(jobs[0] || null);
	return c.json({ job: latest ? toBookUploadJobPublic(latest) : null });
});

assetRouter.get("/books/upload/jobs/:jobId", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const jobId = sanitizePathSegment(c.req.param("jobId") || "");
	if (!jobId) return c.json({ error: "jobId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	const job = await resolveBookUploadJobRuntimeState(
		await readBookUploadJob(projectId, userId, jobId),
	);
	if (!job || job.userId !== userId) return c.json({ error: "job not found" }, 404);
	return c.json({ job: toBookUploadJobPublic(job) });
});

assetRouter.get("/books/reconfirm/jobs/latest", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const bookId = String(c.req.query("bookId") || "").trim();
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	const jobs = await listBookReconfirmJobsForProject(projectId, userId);
	const latest =
		jobs.find(
			(job) =>
				job.userId === userId && (!bookId || String(job.bookId || "").trim() === bookId),
		) || null;
	return c.json({ job: latest ? toBookReconfirmJobPublic(latest) : null });
});

assetRouter.get("/books/reconfirm/jobs/:jobId", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const jobId = sanitizePathSegment(c.req.param("jobId") || "");
	if (!jobId) return c.json({ error: "jobId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	const job = await readBookReconfirmJob(projectId, userId, jobId);
	if (!job || job.userId !== userId) return c.json({ error: "job not found" }, 404);
	return c.json({ job: toBookReconfirmJobPublic(job) });
});

assetRouter.post("/books/:bookId/update", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isNodeRuntime()) {
		return c.json({ error: "books update requires node runtime" }, 400);
	}
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const content = String(body?.content || "").trim();
	if (!content) return c.json({ error: "content is required" }, 400);
	const title = String(body?.title || "").trim();

	const bookDir = path.join(buildProjectBooksRoot(projectId, userId), bookId);
	const rawPath = path.join(bookDir, "raw.md");
	const indexPath = path.join(bookDir, "index.json");
	const prevIndex = await readBookIndexSafe(indexPath);
	if (!prevIndex) return c.json({ error: "book not found" }, 404);
	await fs.mkdir(bookDir, { recursive: true });
	await fs.writeFile(rawPath, content, "utf8");
		let nextIndex: any;
		try {
			nextIndex = await runBookDerivationQueued(() =>
				buildBookIndexFromContent(c as any, userId, {
					bookId,
					projectId,
					title: title || String(prevIndex?.title || bookId),
					content,
					rawPath,
					prevIndex,
					strictAgents: true,
				}),
			);
		} catch (err) {
			const mapped = mapBookAgentsDeriveError(err);
			return c.json(mapped.payload, mapped.status as 400 | 401 | 403 | 404 | 500);
		}
	nextIndex = await writeBookRawChunksAndAttachMetadata({
		bookDir,
		rawContent: content,
		chapters: Array.isArray(nextIndex?.chapters) ? (nextIndex.chapters as BookChapterMeta[]) : [],
		index: nextIndex,
	});
	nextIndex = await commitDerivedBookIndex({
		indexPath,
		base: prevIndex,
		derived: nextIndex as BookIndexRecord,
	});
	await touchProjectActivity({
		db: c.env.DB,
		projectId,
		ownerId: userId,
		nowIso: new Date().toISOString(),
	});
	if (String(nextIndex?.processedBy || "") === "agents-cli-on-demand") {
		await scheduleBookReconfirmJobIfIdle({
			env: c.env,
			requestUrl: c.req.url,
			authorization: c.req.header("authorization") || undefined,
			apiKey: c.req.header("x-api-key") || undefined,
			projectId,
			userId,
			bookId,
			title: String(nextIndex?.title || prevIndex?.title || bookId),
			chapterCount: Number(nextIndex?.chapterCount || 0) || 0,
		});
	}
	return c.json({
		ok: true,
		bookId,
		title: nextIndex.title,
		chapterCount: Number(nextIndex.chapterCount || 0) || 0,
		updatedAt: nextIndex.updatedAt,
		processedBy: String(nextIndex.processedBy || ""),
		warnings: Array.isArray(nextIndex.derivationWarnings) ? nextIndex.derivationWarnings : [],
	});
});

assetRouter.post("/books/:bookId/reconfirm", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isNodeRuntime()) {
		return c.json({ error: "books reconfirm requires node runtime" }, 400);
	}
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const mode: BookDerivationMode = body?.mode === "deep" ? "deep" : "standard";
	const asyncRequestedRaw = body?.async;
	const asyncRequested =
		typeof asyncRequestedRaw === "boolean"
			? asyncRequestedRaw
			: mode === "deep";

	const bookDir = path.join(buildProjectBooksRoot(projectId, userId), bookId);
	const rawPath = path.join(bookDir, "raw.md");
	const indexPath = path.join(bookDir, "index.json");
	const prevIndex = await readBookIndexSafe(indexPath);
	if (!prevIndex) return c.json({ error: "book not found" }, 404);
	const rawContent = await fs.readFile(rawPath, "utf8").catch(() => "");
	if (!rawContent.trim()) {
		return c.json({ error: "book raw content not found" }, 404);
	}

	if (asyncRequested) {
		const active = await findActiveBookReconfirmJob(projectId, userId, bookId);
		if (active && active.userId === userId) {
			return c.json(
				{
					ok: true,
					async: true,
					message: "当前小说已有重建任务在执行",
					job: toBookReconfirmJobPublic(active),
				},
				202,
			);
		}
		const now = new Date().toISOString();
		const job: BookReconfirmJobMeta = {
			id: crypto.randomUUID(),
			bookId,
			userId,
			projectId,
			title: String(prevIndex?.title || bookId),
			mode,
			strictAgents: true,
			status: "queued",
			progress: {
				phase: "queued",
				percent: 0,
				message: "任务已入队，等待执行",
				totalChapters: Number(prevIndex?.chapterCount || 0) || undefined,
				processedChapters: 0,
			},
			createdAt: now,
			updatedAt: now,
			error: null,
		};
		await writeBookReconfirmJob(job);
		enqueueBookReconfirmJob({
			jobId: job.id,
			userId,
			bookId,
			projectId,
			env: c.env,
			requestUrl: c.req.url,
			authorization: c.req.header("authorization") || undefined,
			apiKey: c.req.header("x-api-key") || undefined,
		});
		void drainBookReconfirmJobs();
		return c.json({ ok: true, async: true, job: toBookReconfirmJobPublic(job) }, 202);
	}

	let nextIndex: any;
	try {
		nextIndex = await runBookDerivationQueued(() =>
			buildBookIndexFromContentFullReconfirm(c as any, userId, {
				bookId,
				projectId,
				title: String(prevIndex?.title || bookId),
				content: rawContent,
				rawPath,
				prevIndex,
				mode,
			}),
		);
	} catch (err) {
		const mapped = mapBookAgentsDeriveError(err);
		return c.json(mapped.payload, mapped.status as 400 | 401 | 403 | 404 | 500);
	}
	nextIndex = await writeBookRawChunksAndAttachMetadata({
		bookDir,
		rawContent: rawContent,
		chapters: Array.isArray(nextIndex?.chapters) ? (nextIndex.chapters as BookChapterMeta[]) : [],
		index: nextIndex,
	});
	try {
		nextIndex = await attachFreshBookEvidenceIndex({
			bookDirectory: bookDir,
			bookId,
			projectId,
			title: String(nextIndex?.title || prevIndex.title || bookId),
			rawText: rawContent,
			index: nextIndex as BookIndexRecord,
			source: prevIndex.source,
		});
		nextIndex = await commitDerivedBookIndex({
			indexPath,
			base: prevIndex,
			derived: nextIndex as BookIndexRecord,
		});
	} catch (error) {
		const mapped = mapBookAgentsDeriveError(error);
		return c.json(
			mapped.payload,
			mapped.status as 400 | 401 | 403 | 404 | 409 | 422 | 500,
		);
	}
	return c.json({
		ok: true,
		async: false,
		bookId,
		title: nextIndex.title,
		chapterCount: Number(nextIndex.chapterCount || 0) || 0,
		updatedAt: nextIndex.updatedAt,
		processedBy: String(nextIndex.processedBy || ""),
		mode,
		warnings: Array.isArray(nextIndex.derivationWarnings) ? nextIndex.derivationWarnings : [],
		index: nextIndex,
	});
});

assetRouter.get("/books", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json([]);

	const booksRoot = buildProjectBooksRoot(projectId, userId);
	try {
		const entries = await fs.readdir(booksRoot, { withFileTypes: true });
		const items: any[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const indexPath = path.join(booksRoot, entry.name, "index.json");
			const idx = await readBookIndexSafe(indexPath);
			if (!idx) continue;
			items.push({
				bookId: String(idx.bookId || entry.name),
				title: String(idx.title || entry.name),
				chapterCount: Number(idx.chapterCount || 0) || 0,
				updatedAt: String(idx.updatedAt || ""),
			});
		}
		items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
		return c.json(items);
	} catch (error) {
		if (hasNodeErrorCode(error, "ENOENT")) return c.json([]);
		throw error;
	}
});

assetRouter.get("/books/:bookId/index", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	return c.json(idx);
});

assetRouter.get("/books/:bookId/storyboard/history", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const taskIdFilter = String(c.req.query("taskId") || "").trim();
	const limitRaw = Number(c.req.query("limit") || 120);
	const limit = Number.isFinite(limitRaw)
		? Math.max(1, Math.min(500, Math.trunc(limitRaw)))
		: 120;

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	const processItemsMerged: any[] = [];
	const processSnapshot = await readBookStoryboardProcessSafe(
		buildBookProcessDir(projectId, userId, bookId),
	);
	if (Array.isArray(processSnapshot.items)) {
		processItemsMerged.push(...processSnapshot.items);
	}
	const dedupByShot = new Map<string, any>();
	for (const item of processItemsMerged) {
		const shotNo = Math.trunc(Number(item?.shotNo || 0));
		const taskId =
			String(item?.taskId || "").trim() ||
			`legacy-task-ch${Math.max(1, Math.trunc(Number(item?.chapter || 1)))}`;
		if (shotNo <= 0 || !taskId) continue;
		const key = `${taskId}:${shotNo}`;
		const prev = dedupByShot.get(key);
		if (!prev) {
			dedupByShot.set(key, item);
			continue;
		}
		const prevTs = Date.parse(String(prev?.updatedAt || prev?.createdAt || ""));
		const nextTs = Date.parse(String(item?.updatedAt || item?.createdAt || ""));
		if ((Number.isFinite(nextTs) ? nextTs : 0) >= (Number.isFinite(prevTs) ? prevTs : 0)) {
			dedupByShot.set(key, item);
		}
	}
	const processItems = Array.from(dedupByShot.values());
	const normalizedItems = processItems
		.map((item: any) => {
			const shotNo = Math.trunc(Number(item?.shotNo || 0));
			const taskId =
				String(item?.taskId || "").trim() ||
				`legacy-task-ch${Math.max(1, Math.trunc(Number(item?.chapter || 1)))}`;
			const script = String(item?.script || "").trim();
			const imageUrl = String(item?.imageUrl || "").trim();
			const updatedAt = String(item?.updatedAt || "").trim();
			const createdAt = String(item?.createdAt || "").trim();
			if (shotNo <= 0 || !taskId) return null;
			return {
				version: 1,
				projectId,
				bookId,
				taskId,
				chunkId: String(item?.chunkId || "").trim(),
				chunkIndex: Math.max(0, Math.trunc(Number(item?.chunkIndex || 0))),
				groupSize: normalizeStoryboardGroupSize(item?.groupSize),
				shotNo,
				shotIndexInChunk: Math.max(0, Math.trunc(Number(item?.shotIndexInChunk || 0))),
				script,
				imageUrl,
				selectedImageUrl: String(item?.selectedImageUrl || "").trim() || undefined,
				selectedCandidateId: String(item?.selectedCandidateId || "").trim() || undefined,
				imageCandidates: Array.isArray(item?.imageCandidates) ? item.imageCandidates : [],
				selectionHistory: Array.isArray(item?.selectionHistory) ? item.selectionHistory : [],
				references: Array.isArray(item?.references) ? item.references : [],
				roleCardAnchors: Array.isArray(item?.roleCardAnchors) ? item.roleCardAnchors : [],
				modelThinking:
					item?.modelThinking && typeof item.modelThinking === "object"
						? item.modelThinking
						: {},
				worldEvolutionThinking: String(item?.worldEvolutionThinking || "").trim(),
				createdAt,
				updatedAt,
				updatedBy: String(item?.updatedBy || "").trim(),
			};
		})
		.filter((x): x is NonNullable<typeof x> => !!x)
		.filter((x) => (taskIdFilter ? x.taskId === taskIdFilter : true))
		.sort((a, b) => {
			if (b.shotNo !== a.shotNo) return b.shotNo - a.shotNo;
			const bt = Date.parse(String(b.updatedAt || b.createdAt || ""));
			const at = Date.parse(String(a.updatedAt || a.createdAt || ""));
			return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
		});
	const progress = computeBookStoryboardProgressFromIndex({
		index: idx,
		processItems: normalizedItems,
	});
	return c.json({
		ok: true,
		bookId,
		progress,
		total: normalizedItems.length,
		items: normalizedItems.slice(0, limit),
	});
});

assetRouter.delete("/books/:bookId/storyboard/history/:shotNo", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	const taskId = String(c.req.query("taskId") || "").trim();
	const shotNoRaw = Number(c.req.param("shotNo") || 0);
	const shotNo = Number.isFinite(shotNoRaw) && shotNoRaw > 0 ? Math.trunc(shotNoRaw) : 0;
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	if (!taskId) return c.json({ error: "taskId is required" }, 400);
	if (!shotNo) return c.json({ error: "shotNo is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const processDirs = [buildBookProcessDir(projectId, userId, bookId)];

	let deleted = false;
	for (const processDir of processDirs) {
		try {
			// eslint-disable-next-line no-await-in-loop
			const entries = await fs.readdir(processDir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				const name = String(entry.name || "");
				const m = name.match(/^shot-(\d{4,})\.json$/i);
				if (m) {
					const n = Math.trunc(Number(m[1] || 0));
					if (!Number.isFinite(n) || n < shotNo) continue;
					// eslint-disable-next-line no-await-in-loop
					const shotRaw = await fs.readFile(path.join(processDir, name), "utf8").catch(() => "");
					if (!shotRaw) continue;
					let shotParsed: any = null;
					try {
						shotParsed = JSON.parse(shotRaw);
					} catch {
						shotParsed = null;
					}
					const shotTaskId =
						String(shotParsed?.taskId || "").trim() ||
						`legacy-task-ch${Math.max(1, Math.trunc(Number(shotParsed?.chapter || 1)))}`;
					if (shotTaskId !== taskId) continue;
					// eslint-disable-next-line no-await-in-loop
					await fs.unlink(path.join(processDir, name)).catch(() => undefined);
					deleted = true;
					continue;
				}
				if (!/^ch\d+-g\d+-i\d+\.json$/i.test(name)) continue;
				// eslint-disable-next-line no-await-in-loop
				const raw = await fs.readFile(path.join(processDir, name), "utf8").catch(() => "");
				if (!raw) continue;
				let parsed: any = null;
				try {
					parsed = JSON.parse(raw);
				} catch {
					parsed = null;
				}
				const chunkTaskId =
					String(parsed?.taskId || "").trim() ||
					`legacy-task-ch${Math.max(1, Math.trunc(Number(parsed?.chapter || 1)))}`;
				if (chunkTaskId !== taskId) continue;
				const shotEnd = Math.trunc(Number(parsed?.shotEnd || 0));
				if (!Number.isFinite(shotEnd) || shotEnd < shotNo) continue;
				// eslint-disable-next-line no-await-in-loop
				await fs.unlink(path.join(processDir, name)).catch(() => undefined);
				deleted = true;
			}
		} catch {
			// ignore missing dir
		}
	}
	if (!deleted) {
		return c.json({ error: "storyboard shot not found", code: "storyboard_shot_not_found" }, 404);
	}

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	const processItemsMerged: any[] = [];
	for (const processDir of processDirs) {
		// eslint-disable-next-line no-await-in-loop
		const processSnapshot = await readBookStoryboardProcessSafe(processDir);
		if (Array.isArray(processSnapshot.items)) processItemsMerged.push(...processSnapshot.items);
	}
	const dedupByShot = new Map<string, any>();
	for (const item of processItemsMerged) {
		const shot = Math.trunc(Number(item?.shotNo || 0));
		const taskId =
			String(item?.taskId || "").trim() ||
			`legacy-task-ch${Math.max(1, Math.trunc(Number(item?.chapter || 1)))}`;
		if (shot <= 0 || !taskId) continue;
		const key = `${taskId}:${shot}`;
		const prev = dedupByShot.get(key);
		if (!prev) {
			dedupByShot.set(key, item);
			continue;
		}
		const prevTs = Date.parse(String(prev?.updatedAt || prev?.createdAt || ""));
		const nextTs = Date.parse(String(item?.updatedAt || item?.createdAt || ""));
		if ((Number.isFinite(nextTs) ? nextTs : 0) >= (Number.isFinite(prevTs) ? prevTs : 0)) {
			dedupByShot.set(key, item);
		}
	}
	const processItems = Array.from(dedupByShot.values());
	const normalizedItems = processItems
		.map((item: any) => {
			const shot = Math.trunc(Number(item?.shotNo || 0));
			const taskId =
				String(item?.taskId || "").trim() ||
				`legacy-task-ch${Math.max(1, Math.trunc(Number(item?.chapter || 1)))}`;
			if (shot <= 0 || !taskId) return null;
			return item;
		})
		.filter((x): x is NonNullable<typeof x> => !!x);
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const assets = cloneBookIndexAssets(current);
		const chunks = normalizeBookStoryboardChunks(assets.storyboardChunks);
		const keptChunks = chunks.filter((item) => {
			const chunkTaskId =
				String(item.taskId || "").trim() ||
				`legacy-task-ch${Math.max(1, Math.trunc(Number(item.chapter || 1)))}`;
			if (chunkTaskId !== taskId) return true;
			const end = Math.trunc(Number(item.shotEnd || 0));
			return Number.isFinite(end) && end > 0 ? end < shotNo : true;
		});
		assets.storyboardChunks = keptChunks;
		const next = { ...current, assets, updatedAt: new Date().toISOString() };
		return { next, result: next };
	});
	const progress = computeBookStoryboardProgressFromIndex({
		index: updated.index,
		processItems: normalizedItems,
	});
	if (progress) {
		const progressPayload = {
			version: 1,
			mode: "book_progressive",
			totalShots: progress.totalShots,
			completedShots: progress.completedShots,
			progress01: progress.progress01,
			next: progress.next,
			updatedAt: new Date().toISOString(),
			updatedBy: userId,
		};
		for (const processDir of processDirs) {
			// eslint-disable-next-line no-await-in-loop
			await fs.mkdir(processDir, { recursive: true }).catch(() => undefined);
			// eslint-disable-next-line no-await-in-loop
			await fs
				.writeFile(
					path.join(processDir, "index.json"),
					`${JSON.stringify(progressPayload, null, 2)}\n`,
					"utf8",
				)
				.catch(() => undefined);
		}
	}
	return c.json({
		ok: true,
		bookId,
		deletedShotNo: shotNo,
		deletedFromShotNo: shotNo,
		progress,
		total: normalizedItems.length,
	});
});

assetRouter.post("/books/:bookId/metadata/ensure-window", authMiddleware, async (c) => {
	const requestStartMs = Date.now();
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const chapterRaw = Number(body?.chapter);
	const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : 0;
	if (!chapter) return c.json({ error: "chapter is required" }, 400);
	const mode: BookDerivationMode = body?.mode === "deep" ? "deep" : "standard";
	const forceRefreshChapter = body?.forceRefreshChapter === true;
	const windowSizeRaw = Number(body?.windowSize);
	const defaultWindowSize = readBookMetadataStageWindowChapters(mode);
	const windowSize =
		Number.isFinite(windowSizeRaw) && windowSizeRaw > 0
			? Math.max(1, Math.min(200, Math.trunc(windowSizeRaw)))
			: defaultWindowSize;
	const ensureLockKey = `${projectId}::${bookId}`;
	if (bookMetadataEnsureWindowLocks.has(ensureLockKey)) {
		const progress = bookMetadataEnsureWindowProgress.get(ensureLockKey) || null;
		return c.json(
			{
				error: "book metadata ensure-window is already running for this book",
				code: "BOOK_METADATA_ENSURE_WINDOW_BUSY",
				progress,
			},
			409,
		);
	}
	bookMetadataEnsureWindowLocks.add(ensureLockKey);
	try {

	const bookDir = path.join(buildProjectBooksRoot(projectId, userId), bookId);
	const rawPath = path.join(bookDir, "raw.md");
	const indexPath = path.join(bookDir, "index.json");
	const prevIndex = await readBookIndexSafe(indexPath);
	if (!prevIndex) return c.json({ error: "book not found" }, 404);
	const rawContent = await fs.readFile(rawPath, "utf8").catch(() => "");
	if (!rawContent.trim()) {
		return c.json({ error: "book raw content not found" }, 404);
	}

	const chapterResolve = resolveBookChaptersFromText(rawContent);
	const baseChapters = chapterResolve.chapters;
	if (!baseChapters.length) {
		return c.json(
			{
				error:
					"agents-cli chapter boundaries not detected: missing recognizable chapter headings in source text",
			},
			400,
		);
	}
	const prevChapters = Array.isArray((prevIndex as any)?.chapters)
		? ((prevIndex as any).chapters as BookChapterMeta[])
		: [];
	const prevChapterMap = new Map<number, BookChapterMeta>();
	for (const item of prevChapters) {
		const n = Number(item?.chapter);
		if (!Number.isFinite(n) || n <= 0) continue;
		prevChapterMap.set(Math.trunc(n), item);
	}
	let chapters = baseChapters.map((item) =>
		mergeChapterMetaWithExisting(item, prevChapterMap.get(item.chapter) || null),
	);
	if (chapterResolve.usedSingleChapterFallback) {
		const warnings = Array.isArray((prevIndex as any)?.derivationWarnings)
			? ((prevIndex as any).derivationWarnings as unknown[])
					.map((x) => String(x || "").trim())
					.filter(Boolean)
			: [];
		if (!warnings.includes("chapter-boundaries-single-chapter-fallback")) {
			(prevIndex as any).derivationWarnings = [...warnings, "chapter-boundaries-single-chapter-fallback"];
		}
	}

	const totalChapters = chapters.length;
	const safeChapter = Math.min(totalChapters, Math.max(1, chapter));
	const windowStart = Math.floor((safeChapter - 1) / windowSize) * windowSize + 1;
	const windowEnd = Math.min(totalChapters, windowStart + windowSize - 1);
	const windowChapters = chapters.filter(
		(item) => item.chapter >= windowStart && item.chapter <= windowEnd,
	);
	if (!windowChapters.length) {
		return c.json({ error: "chapter window not found" }, 404);
	}
	const nowIsoForProgress = new Date().toISOString();
	bookMetadataEnsureWindowProgress.set(ensureLockKey, {
		startedAt: nowIsoForProgress,
		updatedAt: nowIsoForProgress,
		phase: "prepare",
		bookId,
		projectId,
		chapter: safeChapter,
		mode,
		windowStart,
		windowEnd,
		windowSize,
		metadataUpdated: false,
		missingBeforeCount: 0,
		metadataTargetChapters: 0,
	});

	const missingBefore = windowChapters
		.filter((item) => !isChapterMetadataComplete(item))
		.map((item) => item.chapter);
	const targetChapterNumbers = resolveBookMetadataTargetChapterNumbers({
		windowChapterNumbers: windowChapters.map((item) => item.chapter),
		missingChapterNumbers: missingBefore,
		safeChapter,
		forceRefreshChapter,
	});
	let metadataUpdated = false;
	let metadataElapsedMs = 0;
	let metadataTargetChapters = 0;
	let metadataQueueWaitMs = 0;
	let metadataBatchMaxChars = 0;
	let metadataBatchMaxChapters = 0;
	let metadataBatchConcurrency = 0;
	let metadataSnippetMaxChars = 0;
	let characterProfilesElapsedMs = 0;
	let characterGraphElapsedMs = 0;
	if (targetChapterNumbers.length > 0) {
		const targetChapterSet = new Set<number>(targetChapterNumbers);
		const targetWindowChapters = windowChapters.filter((item) =>
			targetChapterSet.has(item.chapter),
		);
		const progressStart = bookMetadataEnsureWindowProgress.get(ensureLockKey);
		if (progressStart) {
			progressStart.updatedAt = new Date().toISOString();
			progressStart.phase = "chapter_metadata";
			progressStart.missingBeforeCount = missingBefore.length;
			progressStart.metadataTargetChapters = targetWindowChapters.length;
			bookMetadataEnsureWindowProgress.set(ensureLockKey, progressStart);
		}
		metadataTargetChapters = targetWindowChapters.length;
		const metadataStartMs = Date.now();
		metadataSnippetMaxChars = readNodeEnvInt("BOOK_METADATA_ENSURE_WINDOW_SNIPPET_MAX_CHARS", 1800, {
			min: 600,
			max: 12_000,
		});
		metadataBatchMaxChars = readNodeEnvInt("BOOK_METADATA_ENSURE_WINDOW_BATCH_MAX_CHARS", 60_000, {
			min: 10_000,
			max: 1_000_000,
		});
		metadataBatchMaxChapters = readNodeEnvInt(
			"BOOK_METADATA_ENSURE_WINDOW_BATCH_MAX_CHAPTERS",
			8,
			{ min: 2, max: 64 },
		);
		metadataBatchConcurrency = readNodeEnvInt("BOOK_METADATA_ENSURE_WINDOW_BATCH_CONCURRENCY", 3, {
			min: 1,
			max: 50,
		});
		try {
			let queuedTaskExecutionMs = 0;
			let checkpointWriteChain: Promise<void> = Promise.resolve();
			const enriched = await runBookDerivationQueued(async () => {
				const runStartMs = Date.now();
				try {
					return await enrichBookMetaWithAgents(
						c as any,
						userId,
						rawContent,
						targetWindowChapters,
						mode,
							{
								batchMaxChars: metadataBatchMaxChars,
								batchMaxChapters: metadataBatchMaxChapters,
								batchConcurrency: metadataBatchConcurrency,
								snippetMaxChars: metadataSnippetMaxChars,
								useLocalFileContext: false,
								oneShot: targetWindowChapters.length <= 1,
								preferSingleTurn: mode === "standard" && targetWindowChapters.length <= 1,
								privilegedLocalAccess: false,
								onBatchDone: async (batchMerged) => {
									checkpointWriteChain = checkpointWriteChain.then(async () => {
										chapters = mergeChapterMetaListByChapter(chapters, batchMerged);
										const checkpointIndex = {
											...(prevIndex as any),
											bookId: String((prevIndex as any)?.bookId || bookId),
											projectId,
											title: String((prevIndex as any)?.title || bookId),
											chapterCount: totalChapters,
											chapters,
											assets:
												prevIndex && typeof (prevIndex as any).assets === "object"
													? ((prevIndex as any).assets as Record<string, unknown>)
													: {},
											updatedAt: new Date().toISOString(),
										};
										await commitDerivedBookIndex({
											indexPath,
											base: prevIndex,
											derived: checkpointIndex as BookIndexRecord,
										});
									});
									await checkpointWriteChain;
								},
							},
							async (p) => {
							const current = bookMetadataEnsureWindowProgress.get(ensureLockKey);
							if (!current) return;
							const prevCompleted = Number(current.completedBatches || 0);
							const prevProcessed = Number(current.processedChapters || 0);
							current.updatedAt = new Date().toISOString();
							current.phase = "chapter_metadata";
							current.totalBatches = p.totalBatches;
							current.completedBatches = p.completedBatches;
							current.processedChapters = p.processedChapters;
							current.totalChapters = p.totalChapters;
							current.activeBatch = p.activeBatch;
							current.lastBatchElapsedMs = Date.now() - metadataStartMs;
							bookMetadataEnsureWindowProgress.set(ensureLockKey, current);
							const nextCompleted = Number(p.completedBatches || 0);
							const nextProcessed = Number(p.processedChapters || 0);
							if (nextCompleted > prevCompleted || nextProcessed > prevProcessed) {
								console.info(
									`[book-metadata.ensure-window.progress] project=${projectId} book=${bookId} chapter=${safeChapter} batches=${p.completedBatches}/${p.totalBatches} processed=${p.processedChapters}/${p.totalChapters} activeBatch=${p.activeBatch || 0}`,
								);
							}
						},
					);
				} finally {
					queuedTaskExecutionMs = Date.now() - runStartMs;
				}
			});
			await checkpointWriteChain;
			chapters = mergeChapterMetaListByChapter(chapters, enriched.chapters);
			metadataUpdated = true;
			metadataElapsedMs = Date.now() - metadataStartMs;
			metadataQueueWaitMs = Math.max(0, metadataElapsedMs - queuedTaskExecutionMs);
			const progressDone = bookMetadataEnsureWindowProgress.get(ensureLockKey);
			if (progressDone) {
				progressDone.updatedAt = new Date().toISOString();
				progressDone.metadataUpdated = true;
				progressDone.phase = "chapter_metadata_done";
				bookMetadataEnsureWindowProgress.set(ensureLockKey, progressDone);
			}
		} catch (err) {
			const mapped = mapBookAgentsDeriveError(err);
			return c.json(mapped.payload, mapped.status as 400 | 401 | 403 | 404 | 500);
		}
	}

	const nowIso = new Date().toISOString();
	const assets =
		prevIndex && typeof (prevIndex as any).assets === "object" && (prevIndex as any).assets
			? { ...((prevIndex as any).assets as Record<string, unknown>) }
			: {};
	const graphWindowStart = windowStart;
	const graphWindowEnd = windowEnd;
	const graphWindowSource = "window";

	// Intentional: metadata ensure-window no longer auto-derives character profiles/graph.
	// Character relation curation is handled by dedicated pre-storyboard steps.
	const mergedProfiles = normalizeCharacterProfiles((assets as any)?.characterProfiles);
	let nextIndex = {
		...(prevIndex as any),
		bookId: String((prevIndex as any)?.bookId || bookId),
		projectId,
		title: String((prevIndex as any)?.title || bookId),
		chapterCount: totalChapters,
		chapters,
		assets,
		updatedAt: nowIso,
	};
	nextIndex = await commitDerivedBookIndex({
		indexPath,
		base: prevIndex,
		derived: nextIndex as BookIndexRecord,
	});

	const missingAfter = chapters
		.filter((item) => item.chapter >= windowStart && item.chapter <= windowEnd)
		.filter((item) => !isChapterMetadataComplete(item))
		.map((item) => item.chapter);
	const totalElapsedMs = Date.now() - requestStartMs;
	const progressFinalize = bookMetadataEnsureWindowProgress.get(ensureLockKey);
	if (progressFinalize) {
		progressFinalize.updatedAt = new Date().toISOString();
		progressFinalize.phase = "done";
		bookMetadataEnsureWindowProgress.set(ensureLockKey, progressFinalize);
	}
	console.info(
		`[book-metadata.ensure-window] project=${projectId} book=${bookId} chapter=${safeChapter} mode=${mode} window=${windowStart}-${windowEnd} size=${windowSize} graphWindow=${graphWindowStart}-${graphWindowEnd} graphWindowSource=${graphWindowSource} graphAutoSkipped=1 missingBefore=${missingBefore.length} targetChapters=${metadataTargetChapters} metadataUpdated=${metadataUpdated ? 1 : 0} metadataElapsedMs=${metadataElapsedMs} queueWaitMs=${metadataQueueWaitMs} profilesElapsedMs=${characterProfilesElapsedMs} graphElapsedMs=${characterGraphElapsedMs} totalElapsedMs=${totalElapsedMs} batchMaxChars=${metadataBatchMaxChars} batchMaxChapters=${metadataBatchMaxChapters} batchConcurrency=${metadataBatchConcurrency} snippetMaxChars=${metadataSnippetMaxChars}`,
	);

	return c.json({
		ok: true,
		bookId,
		projectId,
		chapter: safeChapter,
		mode,
		windowStart,
		windowEnd,
		windowSize,
		graphWindowStart,
		graphWindowEnd,
		graphWindowSource,
		totalChapters,
		metadataUpdated,
		missingBefore,
		missingAfter,
		missingBeforeCount: missingBefore.length,
		missingAfterCount: missingAfter.length,
		metadataTargetChapters,
		metadataElapsedMs,
		metadataQueueWaitMs,
		metadataBatchMaxChars,
		metadataBatchMaxChapters,
		metadataBatchConcurrency,
		metadataSnippetMaxChars,
		characterProfilesElapsedMs,
		characterGraphElapsedMs,
		characterGraphAutoSkipped: true,
		totalElapsedMs,
		characterProfilesCount: mergedProfiles.length,
		characterGraphNodesCount: Array.isArray((assets as any)?.characterGraph?.nodes)
			? ((assets as any).characterGraph.nodes as any[]).length
			: 0,
	});
	} finally {
		bookMetadataEnsureWindowLocks.delete(ensureLockKey);
		bookMetadataEnsureWindowProgress.delete(ensureLockKey);
	}
});

assetRouter.delete("/books/:bookId", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const bookDir = path.join(buildProjectBooksRoot(projectId, userId), bookId);
	const indexPath = path.join(bookDir, "index.json");
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);

	await fs.rm(bookDir, { recursive: true, force: true }).catch(() => {});
	await deleteBookPointerAssetsForUser(c.env.DB, userId, projectId, bookId);
	return c.json({ ok: true, bookId });
});

assetRouter.post("/books/:bookId/style/confirm", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const parsedBody = await c.req.json().catch(() => ({}));
	const body =
		parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
			? (parsedBody as Record<string, unknown>)
			: {};
	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const nowIso = new Date().toISOString();
	let updated: { index: BookIndexRecord; result: unknown };
	try {
		updated = await updateBookIndexForAsset(indexPath, (current) => {
			const assets = cloneBookIndexAssets(current);
			const prevStyle =
				assets.styleBible && typeof assets.styleBible === "object" && !Array.isArray(assets.styleBible)
					? assets.styleBible
					: {};
			assets.styleBible = confirmBookStyleBible({
				previous: prevStyle,
				request: body,
				userId,
				nowIso,
			});
			return {
				next: { ...current, assets, updatedAt: nowIso },
				result: assets.styleBible,
			};
		});
	} catch (error) {
		if (error instanceof BookStyleBibleNotReadyError) {
			return c.json({ error: error.message, code: error.code }, 409);
		}
		if (error instanceof AppError) throw error;
		return c.json(
			{ error: error instanceof Error ? error.message : String(error), code: "BOOK_STYLE_BIBLE_INVALID" },
			400,
		);
	}
	return c.json(updated.index);
});

assetRouter.post("/books/:bookId/role-cards/upsert", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const roleName = String(body?.roleName || "").trim();
	if (!roleName) return c.json({ error: "roleName is required" }, 400);
	const roleIdInput = String(body?.roleId || "").trim();
	const chapterInputRaw = Number(body?.chapter);
	const chapterStartRaw = Number(body?.chapterStart);
	const chapterEndRaw = Number(body?.chapterEnd);
	const chapterSpanInput = normalizeChapterHints(body?.chapterSpan, 160);
	const nodeId = String(body?.nodeId || "").trim();
	const prompt = String(body?.prompt || "").trim();
	const modelKey = String(body?.modelKey || "").trim();
	const imageUrl = String(body?.imageUrl || "").trim();
	const threeViewImageUrl = String(body?.threeViewImageUrl || "").trim();
	const rawCharacterBible =
		body?.characterBible && typeof body.characterBible === "object" && !Array.isArray(body.characterBible)
			? (body.characterBible as Record<string, unknown>)
			: null;
	const requestedCharacterBibleId = String(body?.characterBibleId || "").trim();
	const stateDescription = String(body?.stateDescription || "").trim();
	const stateKey = normalizeSemanticStateKey(body?.stateKey || stateDescription);
	const ageDescription = String(body?.ageDescription || "").trim();
	const stateLabel = String(body?.stateLabel || "").trim();
	const healthStatus = String(body?.healthStatus || "").trim();
	const injuryStatus = String(body?.injuryStatus || "").trim();
	const statusRaw = String(body?.status || "").trim().toLowerCase();
	const status: "draft" | "generated" =
		statusRaw === "generated" ? "generated" : "draft";
	const referenceKindRaw = String(body?.referenceKind || "").trim();
	const referenceKind: StoryboardReferenceCardKind =
		referenceKindRaw === "group_cast" ? "group_cast" : "single_character";
	const promptSchemaVersion =
		String(body?.promptSchemaVersion || STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION).trim() ||
		STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION;
	const generatedFrom = String(body?.generatedFrom || "manual").trim() || "manual";
	const bodyConfirmed = typeof body?.confirmed === "boolean" ? body.confirmed !== false : undefined;
	const bodyConfirmationMode = normalizeAssetConfirmationMode(body?.confirmationMode);
	const nowIso = new Date().toISOString();

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	const assets = cloneBookIndexAssets(idx);
	const graphNodes = Array.isArray((assets as any)?.characterGraph?.nodes)
		? ((assets as any).characterGraph.nodes as any[])
		: [];
	const roleIdByName = new Map<string, string>();
	for (const node of graphNodes) {
		const n = String(node?.name || "").trim().toLowerCase();
		const id = String(node?.id || "").trim();
		if (!n || !id) continue;
		if (!roleIdByName.has(n)) roleIdByName.set(n, id);
	}
	const roleId =
		roleIdInput ||
		roleIdByName.get(roleName.toLowerCase()) ||
		"";
	const startChapter = resolveRoleStartChapterFromAssets({
		assets: assets as Record<string, unknown>,
		roleName,
		roleId,
	});
	const chapter =
		Number.isFinite(chapterInputRaw) && chapterInputRaw > 0
			? Math.trunc(chapterInputRaw)
			: typeof startChapter === "number" && startChapter > 0
				? startChapter
				: undefined;
	const chapterStart =
		chapterSpanInput.length > 0
			? chapterSpanInput[0]
			: Number.isFinite(chapterStartRaw) && chapterStartRaw > 0
				? Math.trunc(chapterStartRaw)
				: chapter;
	const chapterEnd =
		chapterSpanInput.length > 0
			? chapterSpanInput[chapterSpanInput.length - 1]
			: Number.isFinite(chapterEndRaw) && chapterEndRaw > 0
				? Math.trunc(chapterEndRaw)
				: chapterStart;
	const normalizedChapterSpan = chapterSpanInput.length > 0 ? chapterSpanInput : [];
	const cards = normalizeBookRoleCards((assets as any)?.roleCards);
	const characterBibles = normalizeBookCharacterBibles((assets as Record<string, unknown>)?.characterBibles);
	const normalizedInputCharacterBible = rawCharacterBible
		? normalizeBookCharacterBibles([rawCharacterBible])[0] || null
		: null;
	const resolvedCharacterBible =
		normalizedInputCharacterBible ||
		findCharacterBibleForRoleCard({
			characterBibles,
			characterBibleId: requestedCharacterBibleId,
			roleName,
			roleId,
		});
	if (requestedCharacterBibleId && !resolvedCharacterBible) {
		return c.json({ error: "characterBibleId not found" }, 400);
	}
	if (
		normalizedInputCharacterBible &&
		requestedCharacterBibleId &&
		normalizedInputCharacterBible.id !== requestedCharacterBibleId
	) {
		return c.json({ error: "characterBibleId does not match characterBible.id" }, 400);
	}
	const resolvedCharacterBibleId = String(
		normalizedInputCharacterBible?.id ||
		resolvedCharacterBible?.id ||
		requestedCharacterBibleId,
	).trim();
	const normalizedRoleKey = String(roleId || roleName).trim().toLowerCase();
	const cardIdRaw = String(body?.cardId || "").trim();
	const cardId =
		cardIdRaw ||
		(roleId
			? `card-${roleId}-${Date.now().toString(36)}`
			: `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
	const targetChapterScopeKey = buildRoleCardChapterKey({
		cardId: cardId || "__tmp__",
		roleName,
		...(roleId ? { roleId } : null),
		status,
		...(typeof chapter === "number" ? { chapter } : null),
		...(typeof chapterStart === "number" ? { chapterStart } : null),
		...(typeof chapterEnd === "number" ? { chapterEnd } : null),
		...(normalizedChapterSpan.length ? { chapterSpan: normalizedChapterSpan } : null),
		createdAt: nowIso,
		updatedAt: nowIso,
		createdBy: userId,
		updatedBy: userId,
	});
	const existingIndex =
		cards.findIndex((x) => x.cardId === cardId) >= 0
			? cards.findIndex((x) => x.cardId === cardId)
			: cards.findIndex((x) => {
					const keyRole = String(x.roleId || x.roleName || "").trim().toLowerCase();
					if (!keyRole || keyRole !== normalizedRoleKey) return false;
					return buildRoleCardChapterKey(x) === targetChapterScopeKey;
				});
	if (existingIndex >= 0) {
		const prev = cards[existingIndex]!;
		const confirmationState = resolveUpsertConfirmationState({
			status,
			hasExecutableAsset: isRemoteAssetUrl(threeViewImageUrl) || isRemoteAssetUrl(imageUrl),
			prevConfirmedAt: prev.confirmedAt,
			prevConfirmedBy: prev.confirmedBy,
			prevConfirmationMode: prev.confirmationMode || null,
			bodyConfirmed,
			bodyConfirmationMode,
			nowIso,
			userId,
		});
		cards[existingIndex] = {
			...prev,
			roleName,
			status,
			...(resolvedCharacterBibleId ? { characterBibleId: resolvedCharacterBibleId } : null),
			...(roleId ? { roleId } : null),
			referenceKind,
			promptSchemaVersion,
			generatedFrom,
			...(stateDescription ? { stateDescription } : null),
			...(stateKey ? { stateKey } : null),
			...(ageDescription ? { ageDescription } : null),
			...(stateLabel ? { stateLabel } : null),
			...(healthStatus ? { healthStatus } : null),
			...(injuryStatus ? { injuryStatus } : null),
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(normalizedChapterSpan.length ? { chapterSpan: normalizedChapterSpan } : null),
			...(nodeId ? { nodeId } : null),
			...(prompt ? { prompt } : null),
			...(modelKey ? { modelKey } : null),
			...(imageUrl ? { imageUrl } : null),
			...(threeViewImageUrl ? { threeViewImageUrl } : null),
			confirmationMode: confirmationState.confirmationMode,
			confirmedAt: confirmationState.confirmedAt,
			confirmedBy: confirmationState.confirmedBy,
			updatedAt: nowIso,
			updatedBy: userId,
		};
	} else {
		const confirmationState = resolveUpsertConfirmationState({
			status,
			hasExecutableAsset: isRemoteAssetUrl(threeViewImageUrl) || isRemoteAssetUrl(imageUrl),
			bodyConfirmed,
			bodyConfirmationMode,
			nowIso,
			userId,
		});
		cards.push({
			cardId,
			roleName,
			status,
			...(resolvedCharacterBibleId ? { characterBibleId: resolvedCharacterBibleId } : null),
			...(roleId ? { roleId } : null),
			referenceKind,
			promptSchemaVersion,
			generatedFrom,
			...(stateDescription ? { stateDescription } : null),
			...(stateKey ? { stateKey } : null),
			...(ageDescription ? { ageDescription } : null),
			...(stateLabel ? { stateLabel } : null),
			...(healthStatus ? { healthStatus } : null),
			...(injuryStatus ? { injuryStatus } : null),
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(normalizedChapterSpan.length ? { chapterSpan: normalizedChapterSpan } : null),
			...(nodeId ? { nodeId } : null),
			...(prompt ? { prompt } : null),
			...(modelKey ? { modelKey } : null),
			...(imageUrl ? { imageUrl } : null),
			...(threeViewImageUrl ? { threeViewImageUrl } : null),
			confirmationMode: confirmationState.confirmationMode,
			confirmedAt: confirmationState.confirmedAt,
			confirmedBy: confirmationState.confirmedBy,
			createdAt: nowIso,
			updatedAt: nowIso,
			createdBy: userId,
			updatedBy: userId,
		});
	}
	const dedupedCards = new Map<string, BookRoleCardRecord>();
	for (const item of cards) {
		const key = buildRoleCardChapterKey(item);
		if (!key || key === "#0") {
			dedupedCards.set(`__card__:${item.cardId}`, item);
			continue;
		}
		dedupedCards.set(key, item);
	}
	const nextCards = Array.from(dedupedCards.values());
	const savedCard =
		nextCards.find((x) => x.cardId === cardId) ||
		nextCards.find((x) => {
			const keyRole = String(x.roleId || x.roleName || "").trim().toLowerCase();
			if (keyRole !== normalizedRoleKey) return false;
			return buildRoleCardChapterKey(x) === targetChapterScopeKey;
		}) ||
		null;
	assets.roleCards = nextCards.slice(-500);
	let characterBibleToPersist: BookCharacterBibleRecord | null = null;
	if (normalizedInputCharacterBible) {
		const normalizedCharacterBible = normalizeBookCharacterBibles([
			{
				...normalizedInputCharacterBible,
				...(String(savedCard?.cardId || cardId).trim()
					? { roleCardId: String(savedCard?.cardId || cardId).trim() }
					: null),
			},
		])[0];
		if (normalizedCharacterBible) {
			characterBibleToPersist = normalizedCharacterBible;
			const nextCharacterBibles = [
				...characterBibles.filter((item) => item.id !== normalizedCharacterBible.id),
				normalizedCharacterBible,
			];
			(assets as Record<string, unknown>).characterBibles = nextCharacterBibles.slice(-500);
		}
	}
	if (!savedCard) {
		throw new AppError("role card upsert produced no record", {
			status: 500,
			code: "book_role_card_upsert_failed",
		});
	}
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const latestAssets = cloneBookIndexAssets(current);
		const latestCards = normalizeBookRoleCards(latestAssets.roleCards).filter(
			(item) => item.cardId !== savedCard.cardId && buildRoleCardChapterKey(item) !== targetChapterScopeKey,
		);
		latestCards.push(savedCard);
		latestAssets.roleCards = latestCards.slice(-500);
		if (characterBibleToPersist) {
			const latestBibles = normalizeBookCharacterBibles(latestAssets.characterBibles).filter(
				(item) => item.id !== characterBibleToPersist.id,
			);
			latestBibles.push(characterBibleToPersist);
			latestAssets.characterBibles = latestBibles.slice(-500);
		}
		return {
			next: { ...current, assets: latestAssets, updatedAt: nowIso },
			result: {
				roleCards: latestAssets.roleCards,
				characterBibles: normalizeBookCharacterBibles(latestAssets.characterBibles),
			},
		};
	});
	return c.json({
		ok: true,
		cardId: savedCard.cardId,
		roleCards: updated.result.roleCards,
		characterBibles: updated.result.characterBibles,
	});
});

assetRouter.post("/books/:bookId/visual-refs/upsert", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const category = normalizeVisualRefCategory(body?.category);
	const name = String(body?.name || "").trim();
	if (!name) return c.json({ error: "name is required" }, 400);
	const chapterInputRaw = Number(body?.chapter);
	const chapterStartRaw = Number(body?.chapterStart);
	const chapterEndRaw = Number(body?.chapterEnd);
	const chapterSpanInput = normalizeChapterHints(body?.chapterSpan, 160);
	const tags = normalizeVisualRefTags(body?.tags, 20);
	const nodeId = String(body?.nodeId || "").trim();
	const prompt = String(body?.prompt || "").trim();
	const modelKey = String(body?.modelKey || "").trim();
	const imageUrl = String(body?.imageUrl || "").trim();
	const stateDescription = String(body?.stateDescription || "").trim();
	const stateKey = normalizeSemanticStateKey(body?.stateKey || stateDescription);
	const statusRaw = String(body?.status || "").trim().toLowerCase();
	const status: "draft" | "generated" = statusRaw === "generated" ? "generated" : "draft";
	const referenceKindRaw = String(body?.referenceKind || "").trim();
	const referenceKind: StoryboardReferenceVisualKind =
		referenceKindRaw === "spell_fx"
			? "spell_fx"
			: category === "spell_fx"
				? "spell_fx"
				: "scene_prop_grid";
	const promptSchemaVersion =
		String(body?.promptSchemaVersion || STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION).trim() ||
		STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION;
	const generatedFrom = String(body?.generatedFrom || "manual").trim() || "manual";
	const bodyConfirmed = typeof body?.confirmed === "boolean" ? body.confirmed !== false : undefined;
	const bodyConfirmationMode = normalizeAssetConfirmationMode(body?.confirmationMode);
	const nowIso = new Date().toISOString();

	const chapter =
		Number.isFinite(chapterInputRaw) && chapterInputRaw > 0 ? Math.trunc(chapterInputRaw) : undefined;
	const chapterStart =
		chapterSpanInput.length > 0
			? chapterSpanInput[0]
			: Number.isFinite(chapterStartRaw) && chapterStartRaw > 0
				? Math.trunc(chapterStartRaw)
				: chapter;
	const chapterEnd =
		chapterSpanInput.length > 0
			? chapterSpanInput[chapterSpanInput.length - 1]
			: Number.isFinite(chapterEndRaw) && chapterEndRaw > 0
				? Math.trunc(chapterEndRaw)
				: chapterStart;

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	const assets = cloneBookIndexAssets(idx);
	const refs = normalizeBookVisualRefs((assets as any)?.visualRefs);
	const refIdRaw = String(body?.refId || "").trim();
	const refId =
		refIdRaw || `vref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const targetScopeKey = buildVisualRefChapterKey({
		category,
		name,
		...(stateKey ? { stateKey } : null),
		...(typeof chapter === "number" ? { chapter } : null),
		...(typeof chapterStart === "number" ? { chapterStart } : null),
		...(typeof chapterEnd === "number" ? { chapterEnd } : null),
		...(chapterSpanInput.length ? { chapterSpan: chapterSpanInput } : null),
	});
	const existingIndex =
		refs.findIndex((x) => x.refId === refId) >= 0
			? refs.findIndex((x) => x.refId === refId)
			: refs.findIndex((x) => {
					if (x.category !== category) return false;
					if (String(x.name || "").trim().toLowerCase() !== name.toLowerCase()) return false;
					return buildVisualRefChapterKey(x) === targetScopeKey;
				});
	if (existingIndex >= 0) {
		const prev = refs[existingIndex]!;
		const confirmationState = resolveUpsertConfirmationState({
			status,
			hasExecutableAsset: isRemoteAssetUrl(imageUrl),
			prevConfirmedAt: prev.confirmedAt,
			prevConfirmedBy: prev.confirmedBy,
			prevConfirmationMode: prev.confirmationMode || null,
			bodyConfirmed,
			bodyConfirmationMode,
			nowIso,
			userId,
		});
		refs[existingIndex] = {
			...prev,
			category,
			name,
			status,
			referenceKind,
			promptSchemaVersion,
			generatedFrom,
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(chapterSpanInput.length ? { chapterSpan: chapterSpanInput } : null),
			...(tags.length ? { tags } : null),
			...(stateDescription ? { stateDescription } : null),
			...(stateKey ? { stateKey } : null),
			...(nodeId ? { nodeId } : null),
			...(prompt ? { prompt } : null),
			...(modelKey ? { modelKey } : null),
			...(imageUrl ? { imageUrl } : null),
			confirmationMode: confirmationState.confirmationMode,
			confirmedAt: confirmationState.confirmedAt,
			confirmedBy: confirmationState.confirmedBy,
			updatedAt: nowIso,
			updatedBy: userId,
		};
	} else {
		const confirmationState = resolveUpsertConfirmationState({
			status,
			hasExecutableAsset: isRemoteAssetUrl(imageUrl),
			bodyConfirmed,
			bodyConfirmationMode,
			nowIso,
			userId,
		});
		refs.push({
			refId,
			category,
			name,
			status,
			referenceKind,
			promptSchemaVersion,
			generatedFrom,
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(chapterSpanInput.length ? { chapterSpan: chapterSpanInput } : null),
			...(tags.length ? { tags } : null),
			...(stateDescription ? { stateDescription } : null),
			...(stateKey ? { stateKey } : null),
			...(nodeId ? { nodeId } : null),
			...(prompt ? { prompt } : null),
			...(modelKey ? { modelKey } : null),
			...(imageUrl ? { imageUrl } : null),
			confirmationMode: confirmationState.confirmationMode,
			confirmedAt: confirmationState.confirmedAt,
			confirmedBy: confirmationState.confirmedBy,
			createdAt: nowIso,
			updatedAt: nowIso,
			createdBy: userId,
			updatedBy: userId,
		});
	}
	const dedupedRefs = new Map<string, BookVisualRefRecord>();
	for (const item of refs) {
		const key = buildVisualRefChapterKey(item);
		if (!key || key.endsWith("#0")) {
			dedupedRefs.set(`__vref__:${item.refId}`, item);
			continue;
		}
		dedupedRefs.set(key, item);
	}
	const nextRefs = Array.from(dedupedRefs.values());
	const savedRef =
		nextRefs.find((x) => x.refId === refId) ||
		nextRefs.find((x) => {
			if (x.category !== category) return false;
			if (String(x.name || "").trim().toLowerCase() !== name.toLowerCase()) return false;
			return buildVisualRefChapterKey(x) === targetScopeKey;
		}) ||
		null;
	assets.visualRefs = nextRefs.slice(-800);
	if (!savedRef) {
		throw new AppError("visual ref upsert produced no record", {
			status: 500,
			code: "book_visual_ref_upsert_failed",
		});
	}
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const latestAssets = cloneBookIndexAssets(current);
		const latestRefs = normalizeBookVisualRefs(latestAssets.visualRefs).filter(
			(item) => item.refId !== savedRef.refId && buildVisualRefChapterKey(item) !== targetScopeKey,
		);
		latestRefs.push(savedRef);
		latestAssets.visualRefs = latestRefs.slice(-800);
		return {
			next: { ...current, assets: latestAssets, updatedAt: nowIso },
			result: latestAssets.visualRefs,
		};
	});
	return c.json({
		ok: true,
		refId: savedRef.refId,
		visualRefs: updated.result,
	});
});

assetRouter.post("/books/:bookId/semantic-assets/upsert", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const mediaKind = normalizeSemanticAssetMediaKind(body?.mediaKind);
	if (!mediaKind) return c.json({ error: "mediaKind is required" }, 400);
	const statusRaw = String(body?.status || "").trim().toLowerCase();
	const status: "draft" | "generated" = statusRaw === "generated" ? "generated" : "draft";
	const semanticIdRaw = String(body?.semanticId || "").trim();
	const nodeId = String(body?.nodeId || "").trim();
	const nodeKind = String(body?.nodeKind || "").trim();
	const taskId = String(body?.taskId || "").trim();
	const planId = String(body?.planId || "").trim();
	const chunkId = String(body?.chunkId || "").trim();
	const imageUrl = String(body?.imageUrl || "").trim();
	const videoUrl = String(body?.videoUrl || "").trim();
	const thumbnailUrl = String(body?.thumbnailUrl || "").trim();
	const chapterInputRaw = Number(body?.chapter);
	const chapterStartRaw = Number(body?.chapterStart);
	const chapterEndRaw = Number(body?.chapterEnd);
	const chapterSpanInput = normalizeChapterHints(body?.chapterSpan, 160);
	const shotNoRaw = Number(body?.shotNo);
	const shotNo =
		Number.isFinite(shotNoRaw) && shotNoRaw > 0 ? Math.trunc(shotNoRaw) : undefined;
	const stateDescription = String(body?.stateDescription || "").trim();
	const prompt = String(body?.prompt || "").trim();
	const anchorBindings = normalizePublicFlowAnchorBindings(body?.anchorBindings);
	const productionLayer = String(body?.productionLayer || "").trim();
	const creationStage = String(body?.creationStage || "").trim();
	const approvalStatus = String(body?.approvalStatus || "").trim();
	const bodyConfirmed = typeof body?.confirmed === "boolean" ? body.confirmed !== false : undefined;
	const bodyConfirmationMode = normalizeAssetConfirmationMode(body?.confirmationMode);
	const nowIso = new Date().toISOString();

	const chapter =
		Number.isFinite(chapterInputRaw) && chapterInputRaw > 0 ? Math.trunc(chapterInputRaw) : undefined;
	const chapterStart =
		chapterSpanInput.length > 0
			? chapterSpanInput[0]
			: Number.isFinite(chapterStartRaw) && chapterStartRaw > 0
				? Math.trunc(chapterStartRaw)
				: chapter;
	const chapterEnd =
		chapterSpanInput.length > 0
			? chapterSpanInput[chapterSpanInput.length - 1]
			: Number.isFinite(chapterEndRaw) && chapterEndRaw > 0
				? Math.trunc(chapterEndRaw)
				: chapterStart;

	const semanticId =
		semanticIdRaw ||
		(nodeId
			? `node-${nodeId}-${mediaKind}-${String(shotNo || 0)}`
			: `${mediaKind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	const assets = cloneBookIndexAssets(idx);
	const semanticAssets = normalizeBookSemanticAssets((assets as any)?.semanticAssets);
	const targetScopeKey = buildSemanticAssetScopeKey({
		semanticId,
		nodeId,
		mediaKind,
		...(typeof chapter === "number" ? { chapter } : null),
		...(typeof chapterStart === "number" ? { chapterStart } : null),
		...(typeof chapterEnd === "number" ? { chapterEnd } : null),
		...(chapterSpanInput.length ? { chapterSpan: chapterSpanInput } : null),
		...(typeof shotNo === "number" ? { shotNo } : null),
	});
	const existingIndex =
		semanticAssets.findIndex((item) => item.semanticId === semanticId) >= 0
			? semanticAssets.findIndex((item) => item.semanticId === semanticId)
			: semanticAssets.findIndex(
					(item) =>
						buildSemanticAssetScopeKey({
							semanticId: item.semanticId,
							nodeId: item.nodeId,
							mediaKind: item.mediaKind,
							chapter: item.chapter,
							chapterStart: item.chapterStart,
							chapterEnd: item.chapterEnd,
							chapterSpan: item.chapterSpan,
							shotNo: item.shotNo,
						}) === targetScopeKey,
				);
	if (existingIndex >= 0) {
		const prev = semanticAssets[existingIndex]!;
		const confirmationState = resolveUpsertConfirmationState({
			status,
			hasExecutableAsset:
				(mediaKind === "image" && isRemoteAssetUrl(imageUrl)) ||
				(mediaKind === "video" && isRemoteAssetUrl(videoUrl)),
			prevConfirmedAt: prev.confirmedAt,
			prevConfirmedBy: prev.confirmedBy,
			prevConfirmationMode: prev.confirmationMode || null,
			bodyConfirmed,
			bodyConfirmationMode,
			nowIso,
			userId,
		});
		semanticAssets[existingIndex] = {
			...prev,
			semanticId,
			mediaKind,
			status,
			...(nodeId ? { nodeId } : null),
			...(nodeKind ? { nodeKind } : null),
			...(taskId ? { taskId } : null),
			...(planId ? { planId } : null),
			...(chunkId ? { chunkId } : null),
			...(imageUrl ? { imageUrl } : null),
			...(videoUrl ? { videoUrl } : null),
			...(thumbnailUrl ? { thumbnailUrl } : null),
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(chapterSpanInput.length ? { chapterSpan: chapterSpanInput } : null),
			...(typeof shotNo === "number" ? { shotNo } : null),
			...(stateDescription ? { stateDescription } : null),
			...(prompt ? { prompt } : null),
			...(anchorBindings.length ? { anchorBindings } : null),
			...(productionLayer ? { productionLayer } : null),
			...(creationStage ? { creationStage } : null),
			...(approvalStatus ? { approvalStatus } : null),
			confirmationMode: confirmationState.confirmationMode,
			confirmedAt: confirmationState.confirmedAt,
			confirmedBy: confirmationState.confirmedBy,
			updatedAt: nowIso,
			updatedBy: userId,
		};
	} else {
		const confirmationState = resolveUpsertConfirmationState({
			status,
			hasExecutableAsset:
				(mediaKind === "image" && isRemoteAssetUrl(imageUrl)) ||
				(mediaKind === "video" && isRemoteAssetUrl(videoUrl)),
			bodyConfirmed,
			bodyConfirmationMode,
			nowIso,
			userId,
		});
		semanticAssets.push({
			semanticId,
			mediaKind,
			status,
			...(nodeId ? { nodeId } : null),
			...(nodeKind ? { nodeKind } : null),
			...(taskId ? { taskId } : null),
			...(planId ? { planId } : null),
			...(chunkId ? { chunkId } : null),
			...(imageUrl ? { imageUrl } : null),
			...(videoUrl ? { videoUrl } : null),
			...(thumbnailUrl ? { thumbnailUrl } : null),
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(chapterSpanInput.length ? { chapterSpan: chapterSpanInput } : null),
			...(typeof shotNo === "number" ? { shotNo } : null),
			...(stateDescription ? { stateDescription } : null),
			...(prompt ? { prompt } : null),
			...(anchorBindings.length ? { anchorBindings } : null),
			...(productionLayer ? { productionLayer } : null),
			...(creationStage ? { creationStage } : null),
			...(approvalStatus ? { approvalStatus } : null),
			confirmationMode: confirmationState.confirmationMode,
			confirmedAt: confirmationState.confirmedAt,
			confirmedBy: confirmationState.confirmedBy,
			createdAt: nowIso,
			updatedAt: nowIso,
			createdBy: userId,
			updatedBy: userId,
		});
	}
	const deduped = new Map<string, BookSemanticAssetRecord>();
	for (const item of semanticAssets) {
		deduped.set(buildSemanticAssetScopeKey(item), item);
	}
	assets.semanticAssets = Array.from(deduped.values()).slice(-2000);
	const semanticAssetToPersist = normalizeBookSemanticAssets(assets.semanticAssets).find(
		(item) => item.semanticId === semanticId || buildSemanticAssetScopeKey(item) === targetScopeKey,
	);
	if (!semanticAssetToPersist) {
		throw new AppError("semantic asset upsert produced no record", {
			status: 500,
			code: "book_semantic_asset_upsert_failed",
		});
	}
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const latestAssets = cloneBookIndexAssets(current);
		const latestSemanticAssets = normalizeBookSemanticAssets(latestAssets.semanticAssets).filter(
			(item) =>
				item.semanticId !== semanticAssetToPersist.semanticId &&
				buildSemanticAssetScopeKey(item) !== targetScopeKey,
		);
		latestSemanticAssets.push(semanticAssetToPersist);
		const latestDeduped = new Map<string, BookSemanticAssetRecord>();
		for (const item of latestSemanticAssets) latestDeduped.set(buildSemanticAssetScopeKey(item), item);
		latestAssets.semanticAssets = Array.from(latestDeduped.values()).slice(-2000);
		return {
			next: { ...current, assets: latestAssets, updatedAt: nowIso },
			result: latestAssets.semanticAssets,
		};
	});
	return c.json({
		ok: true,
		semanticId,
		semanticAssets: updated.result,
	});
});

assetRouter.post("/books/:bookId/role-cards/:cardId/confirm", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	const cardId = sanitizePathSegment(c.req.param("cardId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	if (!cardId) return c.json({ error: "cardId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const hasConfirmedFlag = typeof body?.confirmed === "boolean";
	const confirmed = hasConfirmedFlag ? body.confirmed !== false : true;
	const nowIso = new Date().toISOString();
	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const assets = cloneBookIndexAssets(current);
		const cards = normalizeBookRoleCards(assets.roleCards);
		const targetIndex = cards.findIndex((item) => item.cardId === cardId);
		if (targetIndex < 0) {
			throw new AppError("role card not found", { status: 404, code: "book_role_card_not_found" });
		}
		const previous = cards[targetIndex]!;
		cards[targetIndex] = {
			...previous,
			confirmationMode: confirmed ? "manual" : null,
			confirmedAt: confirmed ? nowIso : null,
			confirmedBy: confirmed ? userId : null,
			updatedAt: nowIso,
			updatedBy: userId,
		};
		assets.roleCards = cards.slice(-500);
		return {
			next: { ...current, assets, updatedAt: nowIso },
			result: assets.roleCards,
		};
	});
	return c.json({
		ok: true,
		cardId,
		roleCards: updated.result,
	});
});

assetRouter.post("/books/:bookId/visual-refs/:refId/confirm", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	const refId = sanitizePathSegment(c.req.param("refId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	if (!refId) return c.json({ error: "refId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const hasConfirmedFlag = typeof body?.confirmed === "boolean";
	const confirmed = hasConfirmedFlag ? body.confirmed !== false : true;
	const nowIso = new Date().toISOString();
	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const assets = cloneBookIndexAssets(current);
		const refs = normalizeBookVisualRefs(assets.visualRefs);
		const targetIndex = refs.findIndex((item) => item.refId === refId);
		if (targetIndex < 0) {
			throw new AppError("visual ref not found", { status: 404, code: "book_visual_ref_not_found" });
		}
		const previous = refs[targetIndex]!;
		refs[targetIndex] = {
			...previous,
			confirmationMode: confirmed ? "manual" : null,
			confirmedAt: confirmed ? nowIso : null,
			confirmedBy: confirmed ? userId : null,
			updatedAt: nowIso,
			updatedBy: userId,
		};
		assets.visualRefs = refs.slice(-800);
		return {
			next: { ...current, assets, updatedAt: nowIso },
			result: assets.visualRefs,
		};
	});
	return c.json({
		ok: true,
		refId,
		visualRefs: updated.result,
	});
});

assetRouter.post("/books/:bookId/storyboard-plans/upsert", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const taskId = String(body?.taskId || "").trim();
	if (!taskId) return c.json({ error: "taskId is required" }, 400);
	const taskTitle = String(body?.taskTitle || "").trim();
	const chapter = normalizeOptionalPositiveChapter(body?.chapter);
	if (!chapter) return c.json({ error: "chapter is required" }, 400);
	const modeRaw = String(body?.mode || "").trim().toLowerCase();
	const mode: "single" | "full" = modeRaw === "full" ? "full" : "single";
	const overwriteModeRaw = String(body?.overwriteMode || "merge").trim().toLowerCase();
	const overwriteMode: "merge" | "replace" =
		overwriteModeRaw === "replace" ? "replace" : "merge";
	const resetChapterChunks = body?.resetChapterChunks === true;
	const groupSize = normalizeStoryboardGroupSize(body?.groupSize);
	const persistencePayload = requireStoryboardV12ArtifactPayload({
		storyboardStructured: body?.storyboardStructured,
		shotPrompts: body?.shotPrompts,
		maxShotPrompts: 1_200,
		contextLabel: "storyboard plan upsert",
	});
	const storyboardArtifact = persistencePayload.artifact;
	const artifactSha256 = persistencePayload.artifactSha256;
	const storyboardStructured = persistencePayload.structured;
	const shotPrompts = persistencePayload.shotPrompts;
	const outputAssetId = String(body?.outputAssetId || "").trim();
	const runId = String(body?.runId || "").trim();
	const storyboardContent = JSON.stringify(storyboardArtifact, null, 2);
	const next1Raw = Number(body?.nextChunkIndexByGroup?.["1"]);
	const next4Raw = Number(body?.nextChunkIndexByGroup?.["4"]);
	const next9Raw = Number(body?.nextChunkIndexByGroup?.["9"]);
	const next25Raw = Number(body?.nextChunkIndexByGroup?.["25"]);
	const nextChunkIndexByGroup = {
		...(Number.isFinite(next1Raw) && next1Raw >= 0 ? { "1": Math.trunc(next1Raw) } : null),
		...(Number.isFinite(next4Raw) && next4Raw >= 0 ? { "4": Math.trunc(next4Raw) } : null),
		...(Number.isFinite(next9Raw) && next9Raw >= 0 ? { "9": Math.trunc(next9Raw) } : null),
		...(Number.isFinite(next25Raw) && next25Raw >= 0 ? { "25": Math.trunc(next25Raw) } : null),
	};

	const nowIso = new Date().toISOString();
	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	const assets = cloneBookIndexAssets(idx);
	const plans = normalizeBookStoryboardPlans((assets as any)?.storyboardPlans);
	const planIdInput = String(body?.planId || "").trim();
	const newestTaskPlan = plans
		.filter((plan) => plan.taskId === taskId)
		.sort((left, right) => {
			const updatedSort = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
			if (updatedSort !== 0) return updatedSort;
			return String(right.planId || "").localeCompare(String(left.planId || ""));
		})[0];
	const planId =
		planIdInput ||
		(newestTaskPlan?.planId || `plan-${taskId}-${Date.now().toString(36)}`);
	const existingIndex = plans.findIndex((plan) => plan.planId === planId);
	const existing = existingIndex >= 0 ? plans[existingIndex] : null;
	const nextPlan: BookStoryboardPlanRecord =
		overwriteMode === "replace"
			? {
					planId,
					taskId,
					...(chapter ? { chapter } : existing?.chapter ? { chapter: existing.chapter } : null),
					...(taskTitle ? { taskTitle } : existing?.taskTitle ? { taskTitle: existing.taskTitle } : null),
					mode,
					groupSize,
					...(outputAssetId ? { outputAssetId } : null),
					...(runId ? { runId } : null),
					...(storyboardContent ? { storyboardContent } : null),
					storyboardArtifact,
					artifactSha256,
					storyboardStructured,
					shotPrompts,
					...(Object.keys(nextChunkIndexByGroup).length ? { nextChunkIndexByGroup } : null),
					createdAt: existing?.createdAt || nowIso,
					updatedAt: nowIso,
					createdBy: existing?.createdBy || userId,
					updatedBy: userId,
				}
			: {
					planId,
					taskId,
					...(chapter ? { chapter } : null),
					...(taskTitle ? { taskTitle } : existing?.taskTitle ? { taskTitle: existing.taskTitle } : null),
					mode,
					groupSize,
					outputAssetId: outputAssetId || existing?.outputAssetId,
					runId: runId || existing?.runId,
					storyboardContent: storyboardContent || existing?.storyboardContent,
					storyboardArtifact,
					artifactSha256,
					storyboardStructured,
					shotPrompts,
					nextChunkIndexByGroup: Object.keys(nextChunkIndexByGroup).length
						? nextChunkIndexByGroup
						: existing?.nextChunkIndexByGroup,
					createdAt: existing?.createdAt || nowIso,
					updatedAt: nowIso,
					createdBy: existing?.createdBy || userId,
					updatedBy: userId,
				};
	const mergedPlans =
		overwriteMode === "replace"
			? plans.filter((plan) => plan.planId !== planId)
			: [...plans];
	if (overwriteMode === "merge" && existingIndex >= 0) mergedPlans[existingIndex] = nextPlan;
	else mergedPlans.push(nextPlan);

	assets.storyboardPlans = mergedPlans
		.sort((a, b) => String(a.taskId || "").localeCompare(String(b.taskId || "")))
		.slice(-200);
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const latestAssets = cloneBookIndexAssets(current);
		const latestPersistencePayload = requireStoryboardV12ArtifactPayload({
			storyboardStructured: body?.storyboardStructured,
			shotPrompts: body?.shotPrompts,
			maxShotPrompts: 1_200,
			contextLabel: "storyboard plan upsert",
		});
		const persistedPlan: BookStoryboardPlanRecord = {
			...nextPlan,
			storyboardContent: JSON.stringify(latestPersistencePayload.artifact, null, 2),
			storyboardArtifact: latestPersistencePayload.artifact,
			artifactSha256: latestPersistencePayload.artifactSha256,
			storyboardStructured: latestPersistencePayload.structured,
			shotPrompts: latestPersistencePayload.shotPrompts,
		};
		const latestPlans = normalizeBookStoryboardPlans(latestAssets.storyboardPlans).filter(
			(item) => item.planId !== planId,
		);
		latestPlans.push(persistedPlan);
		latestAssets.storyboardPlans = latestPlans
			.sort((a, b) => String(a.taskId || "").localeCompare(String(b.taskId || "")))
			.slice(-200);
		let removedChunkCount = 0;
		if (overwriteMode === "replace" && resetChapterChunks) {
			const latestChunks = normalizeBookStoryboardChunks(latestAssets.storyboardChunks);
			const keptChunks = latestChunks.filter((item) => item.taskId !== taskId);
			removedChunkCount = latestChunks.length - keptChunks.length;
			latestAssets.storyboardChunks = keptChunks;
		}
		return {
			next: { ...current, assets: latestAssets, updatedAt: nowIso },
			result: {
				storyboardPlans: latestAssets.storyboardPlans,
				updatedPlan: persistedPlan,
				removedChunkCount,
			},
		};
	});
	return c.json({
		ok: true,
		planId,
		overwriteMode,
		resetChapterChunks,
		removedChunkCount: updated.result.removedChunkCount,
		updatedPlan: updated.result.updatedPlan,
		storyboardPlans: updated.result.storyboardPlans,
	});
});

assetRouter.post("/books/:bookId/storyboard-chunks/upsert", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const taskId = String(body?.taskId || "").trim();
	if (!taskId) return c.json({ error: "taskId is required" }, 400);
	const chapter = normalizeOptionalPositiveChapter(body?.chapter);
	if (!chapter) return c.json({ error: "chapter is required" }, 400);
	const groupSize = normalizeStoryboardGroupSize(body?.groupSize);
	const chunkIndexRaw = Number(body?.chunkIndex);
	const chunkIndex = Number.isFinite(chunkIndexRaw) && chunkIndexRaw >= 0 ? Math.trunc(chunkIndexRaw) : 0;
	const shotStartRaw = Number(body?.shotStart);
	const shotStart = Number.isFinite(shotStartRaw) && shotStartRaw > 0 ? Math.trunc(shotStartRaw) : chunkIndex * groupSize + 1;
	const shotEndRaw = Number(body?.shotEnd);
	const shotEnd = Number.isFinite(shotEndRaw) && shotEndRaw >= shotStart ? Math.trunc(shotEndRaw) : shotStart + groupSize - 1;
	const planId = String(body?.planId || "").trim();
	if (!planId) return c.json({ error: "planId is required" }, 400);
	const previousChunkId = String(body?.previousChunkId || "").trim();
	if (chunkIndex > 0 && !previousChunkId) {
		return c.json({ error: "previousChunkId is required when chunkIndex > 0" }, 400);
	}
	const nodeId = String(body?.nodeId || "").trim();
	const frameUrls = Array.isArray(body?.frameUrls)
		? body.frameUrls.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 64)
		: [];
	const roleCardRefIds = Array.isArray(body?.roleCardRefIds)
		? body.roleCardRefIds.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 24)
		: [];
	const scenePropRefId = String(body?.scenePropRefId || "").trim();
	const scenePropRefLabel = String(body?.scenePropRefLabel || "").trim();
	const spellFxRefId = String(body?.spellFxRefId || "").trim();
	const spellFxRefLabel = String(body?.spellFxRefLabel || "").trim();
	const tailFrameUrl = String(body?.tailFrameUrl || "").trim();
	if (!tailFrameUrl) return c.json({ error: "tailFrameUrl is required" }, 400);
	const chunkIdInput = String(body?.chunkId || "").trim();
	const chunkId = chunkIdInput || `plan-${planId}-g${groupSize}-i${chunkIndex}`;

	const nowIso = new Date().toISOString();
	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	const assets = cloneBookIndexAssets(idx);
	const chunks = normalizeBookStoryboardChunks((assets as any)?.storyboardChunks);
	const plans = normalizeBookStoryboardPlans((assets as any)?.storyboardPlans);
	const exactPlan = plans.find((plan) => plan.planId === planId) || null;
	if (!exactPlan || exactPlan.taskId !== taskId || Number(exactPlan.chapter || 0) !== chapter) {
		return c.json(
			{
				error: "未找到与 taskId/chapter 精确匹配的 storyboard plan",
				code: "storyboard_plan_scope_mismatch",
			},
			409,
		);
	}
	const previousChunk =
		chunkIndex > 0
			? chunks.find((item) => item.chunkId === previousChunkId)
			: undefined;
	if (
		chunkIndex > 0 &&
		(!previousChunk ||
			previousChunk.taskId !== taskId ||
			Number(previousChunk.chapter || 0) !== chapter ||
			previousChunk.groupSize !== groupSize ||
			previousChunk.chunkIndex !== chunkIndex - 1)
	) {
		return c.json(
			{
				error: "previousChunkId 与当前 task/chapter/group/chunkIndex 不构成直接前驱关系",
				code: "storyboard_previous_chunk_scope_mismatch",
			},
			409,
		);
	}
	const persistencePayload = requireStoryboardV12ArtifactPayload({
		storyboardStructured: body?.storyboardStructured,
		previousStoryboardArtifact: previousChunk?.storyboardArtifact,
		requirePreviousHandoff: chunkIndex > 0,
		shotPrompts: body?.shotPrompts,
		maxShotPrompts: 128,
		contextLabel: "storyboard chunk upsert",
	});
	const storyboardArtifact = persistencePayload.artifact;
	const artifactSha256 = persistencePayload.artifactSha256;
	const storyboardStructured = persistencePayload.structured;
	const shotPrompts = persistencePayload.shotPrompts;
	if (exactPlan.artifactSha256 !== artifactSha256) {
		return c.json(
			{
				error: "chunk artifact 与精确 storyboard plan 不一致",
				code: "storyboard_chunk_plan_artifact_mismatch",
			},
			409,
		);
	}
	const prompt = shotPrompts.join("\n\n");
	if (chunkIndex > 0) {
		const prevTailFrameUrl = String(previousChunk?.tailFrameUrl || "").trim();
		if (!prevTailFrameUrl) {
			return c.json(
				{
					error: "未找到上一分组 tailFrameUrl，无法保证分镜连续性，请先生成上一组",
					code: "storyboard_prev_tail_missing",
				},
				400,
			);
		}
		const expectedShotStart = Number(previousChunk?.shotEnd || 0) + 1;
		if (expectedShotStart > 1 && shotStart !== expectedShotStart) {
			return c.json(
				{
					error: `shotStart must equal previous shotEnd + 1 (expected ${expectedShotStart}, got ${shotStart})`,
					code: "storyboard_shot_range_invalid",
				},
				400,
			);
		}
	}
	const existingIndex = chunks.findIndex(
		(x) =>
			x.chunkId === chunkId ||
			(x.planId === planId && x.groupSize === groupSize && x.chunkIndex === chunkIndex),
	);
	const existing = existingIndex >= 0 ? chunks[existingIndex] : null;
	const nextChunk: BookStoryboardChunkRecord = {
		chunkId,
		planId,
		...(previousChunkId ? { previousChunkId } : null),
		taskId,
		...(chapter ? { chapter } : existing?.chapter ? { chapter: existing.chapter } : null),
		groupSize,
		chunkIndex,
		shotStart,
		shotEnd,
		...(nodeId ? { nodeId } : existing?.nodeId ? { nodeId: existing.nodeId } : null),
		prompt,
		storyboardArtifact,
		artifactSha256,
		storyboardStructured,
		...(persistencePayload.handoffEvidence
			? { handoffEvidence: persistencePayload.handoffEvidence }
			: null),
		shotPrompts: shotPrompts.length ? shotPrompts : existing?.shotPrompts || [],
		frameUrls: frameUrls.length ? frameUrls : existing?.frameUrls || [],
		tailFrameUrl,
		roleCardRefIds: roleCardRefIds.length ? roleCardRefIds : existing?.roleCardRefIds || [],
		scenePropRefId: scenePropRefId || existing?.scenePropRefId,
		scenePropRefLabel: scenePropRefLabel || existing?.scenePropRefLabel,
		spellFxRefId: spellFxRefId || existing?.spellFxRefId,
		spellFxRefLabel: spellFxRefLabel || existing?.spellFxRefLabel,
		createdAt: existing?.createdAt || nowIso,
		updatedAt: nowIso,
		createdBy: existing?.createdBy || userId,
		updatedBy: userId,
	};
	if (existingIndex >= 0) chunks[existingIndex] = nextChunk;
	else chunks.push(nextChunk);

	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const latestAssets = cloneBookIndexAssets(current);
		const latestChunks = normalizeBookStoryboardChunks(latestAssets.storyboardChunks);
		const latestPlans = normalizeBookStoryboardPlans(latestAssets.storyboardPlans);
		const latestExactPlan = latestPlans.find((plan) => plan.planId === planId) || null;
		if (!latestExactPlan || latestExactPlan.taskId !== taskId || Number(latestExactPlan.chapter || 0) !== chapter) {
			throw new AppError("未找到与 taskId/chapter 精确匹配的 storyboard plan", {
				status: 409,
				code: "storyboard_plan_scope_mismatch",
			});
		}
		if (chunkIndex > 0) {
			const previousChunk = latestChunks.find((item) => item.chunkId === previousChunkId);
			if (
				!previousChunk ||
				previousChunk.taskId !== taskId ||
				Number(previousChunk.chapter || 0) !== chapter ||
				previousChunk.groupSize !== groupSize ||
				previousChunk.chunkIndex !== chunkIndex - 1
			) {
				throw new AppError(
					"previousChunkId 与当前 task/chapter/group/chunkIndex 不构成直接前驱关系",
					{ status: 409, code: "storyboard_previous_chunk_scope_mismatch" },
				);
			}
			const previousTailFrameUrl = String(previousChunk?.tailFrameUrl || "").trim();
			if (!previousTailFrameUrl) {
				throw new AppError("未找到上一分组 tailFrameUrl，无法保证分镜连续性，请先生成上一组", {
					status: 400,
					code: "storyboard_prev_tail_missing",
				});
			}
			const expectedShotStart = Number(previousChunk?.shotEnd || 0) + 1;
			if (expectedShotStart > 1 && shotStart !== expectedShotStart) {
				throw new AppError(
					`shotStart must equal previous shotEnd + 1 (expected ${expectedShotStart}, got ${shotStart})`,
					{ status: 400, code: "storyboard_shot_range_invalid" },
				);
			}
		}
		const latestPreviousChunk =
			chunkIndex > 0
				? latestChunks.find((item) => item.chunkId === previousChunkId)
				: undefined;
		const latestPersistencePayload = requireStoryboardV12ArtifactPayload({
			storyboardStructured: body?.storyboardStructured,
			previousStoryboardArtifact: latestPreviousChunk?.storyboardArtifact,
			requirePreviousHandoff: chunkIndex > 0,
			shotPrompts: body?.shotPrompts,
			maxShotPrompts: 128,
			contextLabel: "storyboard chunk upsert",
		});
		if (latestExactPlan.artifactSha256 !== latestPersistencePayload.artifactSha256) {
			throw new AppError("chunk artifact 与精确 storyboard plan 不一致", {
				status: 409,
				code: "storyboard_chunk_plan_artifact_mismatch",
			});
		}
		const latestExistingIndex = latestChunks.findIndex(
			(item) =>
				item.chunkId === chunkId ||
				(item.planId === planId && item.groupSize === groupSize && item.chunkIndex === chunkIndex),
		);
		const latestExisting = latestExistingIndex >= 0 ? latestChunks[latestExistingIndex] : null;
		const persistedChunk: BookStoryboardChunkRecord = {
			...nextChunk,
			prompt: latestPersistencePayload.shotPrompts.join("\n\n"),
			storyboardArtifact: latestPersistencePayload.artifact,
			artifactSha256: latestPersistencePayload.artifactSha256,
			storyboardStructured: latestPersistencePayload.structured,
			shotPrompts: latestPersistencePayload.shotPrompts,
			...(latestPersistencePayload.handoffEvidence
				? { handoffEvidence: latestPersistencePayload.handoffEvidence }
				: null),
			createdAt: latestExisting?.createdAt || nextChunk.createdAt,
			createdBy: latestExisting?.createdBy || nextChunk.createdBy,
			updatedAt: nowIso,
			updatedBy: userId,
		};
		if (latestExistingIndex >= 0) latestChunks[latestExistingIndex] = persistedChunk;
		else latestChunks.push(persistedChunk);
		latestAssets.storyboardChunks = latestChunks
			.sort((a, b) => {
				const taskSort = String(a.taskId || "").localeCompare(String(b.taskId || ""));
				return taskSort !== 0 ? taskSort : a.chunkIndex - b.chunkIndex;
			})
			.slice(-2000);
		return {
			next: { ...current, assets: latestAssets, updatedAt: nowIso },
			result: {
				chunk: persistedChunk,
				storyboardChunks: latestAssets.storyboardChunks,
			},
		};
	});
	await persistStoryboardChunkMemory(c, {
		userId,
		projectId,
		bookId,
		chunkId,
		sourceId: taskId,
		groupSize,
		chunkIndex,
		shotStart,
		shotEnd,
		tailFrameUrl,
		frameUrls: updated.result.chunk.frameUrls,
		roleCardRefIds: updated.result.chunk.roleCardRefIds,
		scenePropRefId: updated.result.chunk.scenePropRefId,
		scenePropRefLabel: updated.result.chunk.scenePropRefLabel,
		spellFxRefId: updated.result.chunk.spellFxRefId,
		spellFxRefLabel: updated.result.chunk.spellFxRefLabel,
	});
	return c.json({
		ok: true,
		chunkId,
		storyboardChunks: updated.result.storyboardChunks,
	});
});

assetRouter.delete("/books/:bookId/role-cards/:cardId", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	const cardId = sanitizePathSegment(c.req.param("cardId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	if (!cardId) return c.json({ error: "cardId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const nowIso = new Date().toISOString();
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const assets = cloneBookIndexAssets(current);
		const cards = normalizeBookRoleCards(assets.roleCards);
		const nextCards = cards.filter((item) => item.cardId !== cardId);
		if (nextCards.length === cards.length) {
			throw new AppError("role card not found", { status: 404, code: "book_role_card_not_found" });
		}
		assets.roleCards = nextCards;
		return {
			next: { ...current, assets, updatedAt: nowIso },
			result: nextCards,
		};
	});
	return c.json({
		ok: true,
		cardId,
		roleCards: updated.result,
	});
});

assetRouter.delete("/books/:bookId/visual-refs/:refId", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	const refId = sanitizePathSegment(c.req.param("refId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	if (!refId) return c.json({ error: "refId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const nowIso = new Date().toISOString();
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const assets = cloneBookIndexAssets(current);
		const refs = normalizeBookVisualRefs(assets.visualRefs);
		const nextRefs = refs.filter((item) => item.refId !== refId);
		if (nextRefs.length === refs.length) {
			throw new AppError("visual ref not found", { status: 404, code: "book_visual_ref_not_found" });
		}
		assets.visualRefs = nextRefs;
		return {
			next: { ...current, assets, updatedAt: nowIso },
			result: nextRefs,
		};
	});
	return c.json({
		ok: true,
		refId,
		visualRefs: updated.result,
	});
});

assetRouter.post("/books/:bookId/graph/update", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const nodes = normalizeGraphNodes(body?.nodes);
	if (!nodes.length) {
		return c.json({ error: "nodes is required" }, 400);
	}
	const nodeIds = new Set(nodes.map((x) => x.id));
	const edges = normalizeGraphEdges(body?.edges, nodeIds);

	const nowIso = new Date().toISOString();
	const updated = await updateBookIndexForAsset(indexPath, (current) => {
		const assets = cloneBookIndexAssets(current);
		assets.characterGraph = { nodes, edges };
		const next = { ...current, assets, updatedAt: nowIso };
		return { next, result: next };
	});
	return c.json(updated.index);
});

assetRouter.get("/books/:bookId/chapter", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const bookId = sanitizePathSegment(c.req.param("bookId") || "");
	const chapterRaw = Number(c.req.query("chapter") || 0);
	const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : 0;
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	if (!bookId) return c.json({ error: "bookId is required" }, 400);
	if (!chapter) return c.json({ error: "chapter is required" }, 400);
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "project not found" }, 404);
	if (!isNodeRuntime()) return c.json({ error: "node runtime required" }, 400);

	const bookDir = path.join(buildProjectBooksRoot(projectId, userId), bookId);
	const indexPath = buildBookIndexPath(projectId, userId, bookId);
	const rawPath = path.join(bookDir, "raw.md");
	const idx = await readBookIndexSafe(indexPath);
	if (!idx) return c.json({ error: "book not found" }, 404);
	const chapters = Array.isArray(idx.chapters) ? idx.chapters : [];
	const target = chapters.find((it: any) => Number(it?.chapter) === chapter);
	if (!target) return c.json({ error: "chapter not found" }, 404);
	const raw = await fs.readFile(rawPath, "utf8").catch(() => "");
	if (!raw) return c.json({ error: "book raw content not found" }, 404);
	const startOffset = Math.max(0, Number(target.startOffset || 0) || 0);
	const endOffset = Math.min(raw.length, Number(target.endOffset || raw.length) || raw.length);
	const content = sanitizeImportedBookText(raw.slice(startOffset, Math.max(startOffset, endOffset)));
	return c.json({
		bookId,
		projectId,
		chapter,
		title: sanitizeBookFieldText(String(target.title || `第${chapter}章`)) || `第${chapter}章`,
		content,
		startLine: Number(target.startLine || 0) || 0,
		endLine: Number(target.endLine || 0) || 0,
		summary: sanitizeBookFieldText(String(target.summary || "")),
		keywords: normalizeKeywords(target.keywords),
		coreConflict: sanitizeBookFieldText(String(target.coreConflict || "")),
		characters: normalizeEntityItems(target.characters, 20),
		props: normalizePropItems(target.props, 20),
		scenes: normalizeEntityItems(target.scenes, 20),
		locations: normalizeEntityItems(target.locations, 20),
	});
});

assetRouter.post("/ingest-material", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = IngestProjectMaterialSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const input = parsed.data;
	const contentBytes = getUtf8TextByteLength(input.content);
	if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
		return c.json(buildTextUploadTooLargePayload(contentBytes), 413);
	}

	const project = await getProjectForOwner(c.env.DB, input.projectId, userId);
	if (!project) {
		return c.json({ error: "project not found" }, 404);
	}

	// Base asset row (always persisted for fallback/replay).
	const nowIso = new Date().toISOString();
	const baseRow = await createAssetRow(
		c.env.DB,
		userId,
		{
			name: input.name.trim(),
			projectId: input.projectId,
			data: {
				kind: input.kind,
				content: input.content,
				chapter: input.chapter ?? null,
				source: "upload",
				ingestMode: "agents_cli_or_fallback",
			},
		},
		nowIso,
	);

	if (!isNodeRuntime()) {
		return c.json({
			ok: true,
			mode: "db_only",
			baseAssetId: baseRow.id,
			chaptersCreated: 0,
			message: "non-node runtime: skipped filesystem ingest",
		});
	}

	const repoRoot = resolveProjectDataRepoRoot();
	const projectRoot = path.join(repoRoot, "project-data", sanitizePathSegment(input.projectId));
	const kindDir = path.join(projectRoot, "materials", sanitizePathSegment(input.kind));
	const chaptersDir = path.join(kindDir, "chapters");
	const rawDir = path.join(kindDir, "raw");
	await fs.mkdir(chaptersDir, { recursive: true });
	await fs.mkdir(rawDir, { recursive: true });

	const baseName = sanitizePathSegment(input.name) || "material";
	const rawPath = path.join(rawDir, `${Date.now()}-${baseName}.md`);
	await fs.writeFile(rawPath, input.content, "utf8");

	let chapters: MaterialChapter[] = [];
	// 1) First try deterministic heading split (cheap + robust for large novels).
	chapters = splitByChapterHeadings(input.content);

	// 2) If no headings and content is very large, chunk by fixed size to avoid bridge body limits.
	if (!chapters.length && input.content.length > 300_000) {
		chapters = splitByFixedSize(input.content, 120_000);
	}

	// 3) For smaller non-structured text, ask agents-cli to split.
	try {
		if (!chapters.length) {
			const prompt = [
				"请将下面文本切分为章节并返回严格 JSON。",
				'返回格式：{"chapters":[{"chapter":1,"title":"...","content":"..."}]}',
				"要求：",
				"- chapter 从 1 递增",
				"- content 保留原文核心，不要总结",
				"- 如果原文无法识别章节，也至少输出 1 章",
				"",
				input.content,
			].join("\n");
			const result = await runAgentsBridgeChatTask(c as any, userId, {
				kind: "chat",
				prompt,
			});
			const text = typeof (result as any)?.raw?.text === "string" ? (result as any).raw.text : "";
			const parsedJson = extractFirstJsonObject(text);
			chapters = normalizeChapterList((parsedJson as any)?.chapters);
		}
	} catch {
		// fallback below
	}

	if (!chapters.length) {
		chapters = [
			{
				chapter: input.chapter ?? 1,
				title: input.name.trim() || "第1章",
				content: input.content,
			},
		];
	}

	let created = 0;
	for (const ch of chapters) {
		const chapterNo = Math.max(1, Math.trunc(ch.chapter));
		const chapterFile = path.join(chaptersDir, `${String(chapterNo).padStart(3, "0")}.md`);
		await fs.writeFile(chapterFile, ch.content, "utf8");
		await createAssetRow(
			c.env.DB,
			userId,
			{
				name: `${ch.title || `第${chapterNo}章`}`.slice(0, 200),
				projectId: input.projectId,
				data: {
					kind: input.kind,
					content: ch.content,
					chapter: chapterNo,
					chapterTitle: ch.title || `第${chapterNo}章`,
					source: "agents_ingest",
					filePath: path.relative(repoRoot, chapterFile),
					baseAssetId: baseRow.id,
				},
			},
			new Date().toISOString(),
		);
		created += 1;
	}

	const indexPath = path.join(kindDir, "index.json");
	await fs.writeFile(
		indexPath,
		JSON.stringify(
			{
				projectId: input.projectId,
				kind: input.kind,
				baseAssetId: baseRow.id,
				rawPath: path.relative(repoRoot, rawPath),
				updatedAt: new Date().toISOString(),
				chapters: chapters.map((ch) => ({
					chapter: ch.chapter,
					title: ch.title,
					file: path.relative(repoRoot, path.join(chaptersDir, `${String(Math.max(1, Math.trunc(ch.chapter))).padStart(3, "0")}.md`)),
					length: ch.content.length,
				})),
			},
			null,
			2,
		),
		"utf8",
	);

	return c.json({
		ok: true,
		mode: "agents_cli",
		baseAssetId: baseRow.id,
		chaptersCreated: created,
		projectPath: path.relative(repoRoot, projectRoot),
		indexPath: path.relative(repoRoot, indexPath),
	});
});

assetRouter.patch("/:id/data", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateAssetDataSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const textContent = extractTextUploadContentFromAssetData(parsed.data.data);
	if (typeof textContent === "string") {
		const contentBytes = getUtf8TextByteLength(textContent);
		if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
			return c.json(buildTextUploadTooLargePayload(contentBytes), 413);
		}
	}
	const nowIso = new Date().toISOString();
	await updateAssetDataRow(c.env.DB, userId, id, parsed.data.data, nowIso);
	const row = await getAssetByIdForUser(c.env.DB, id, userId);
	if (!row) {
		return c.json({ error: "asset not found or unauthorized" }, 404);
	}
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId: row.owner_id,
		projectId: row.project_id,
	});
	return c.json(payload);
});

assetRouter.put("/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RenameAssetSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const nowIso = new Date().toISOString();
	const row = await renameAssetRow(
		c.env.DB,
		userId,
		id,
		parsed.data.name,
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId: row.owner_id,
		projectId: row.project_id,
	});
	return c.json(payload);
});

assetRouter.delete("/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteAssetRow(c.env.DB, userId, id);
	return c.body(null, 204);
});

// Public backend proxy for the Node-local asset backend. Generated keys are UUID-based,
// immutable paths under assets/public; callers never receive filesystem paths.
assetRouter.get("/local/*", async (c) => {
	const localStorage = resolveLocalAssetStorageConfig();
	if (!localStorage) {
		return c.json({ error: "Local asset storage is unavailable" }, 503);
	}
	const pathname = new URL(c.req.url).pathname;
	const encodedKey = pathname.startsWith(`${LOCAL_ASSET_ROUTE_PREFIX}/`)
		? pathname.slice(LOCAL_ASSET_ROUTE_PREFIX.length + 1)
		: "";
	if (!encodedKey) return c.json({ error: "key is required" }, 400);

	let key: string;
	try {
		key = decodeURIComponent(encodedKey);
	} catch {
		return c.json({ error: "key is invalid" }, 400);
	}

	try {
		const asset = await readLocalAsset({
			config: localStorage,
			key,
			rangeHeader: c.req.header("range") || c.req.header("Range"),
		});
		const headers = new Headers({
			"Accept-Ranges": "bytes",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Expose-Headers":
				"Content-Length,Content-Range,Accept-Ranges",
			"Cache-Control": "public, max-age=31536000, immutable",
			"Content-Length": String(asset.contentLength),
			"Content-Type": asset.contentType,
		});
		if (asset.range) {
			headers.set(
				"Content-Range",
				`bytes ${asset.range.start}-${asset.range.end}/${asset.totalSize}`,
			);
		}
		return new Response(asset.stream, {
			status: asset.range ? 206 : 200,
			headers,
		});
	} catch (error: unknown) {
		if (error instanceof LocalAssetRangeError) {
			return new Response(null, {
				status: 416,
				headers: { "Content-Range": `bytes */${error.totalSize}` },
			});
		}
		return c.json({ error: "not found" }, 404);
	}
});

// Public asset proxy: serves objects from configured object storage by key.
assetRouter.get("/storage/*", async (c) => {
	const storage = resolveObjectStorageConfig(c.env);
	if (!storage) {
		return c.json({ error: "Object storage is not configured" }, 500);
	}

	const pathname = new URL(c.req.url).pathname;
	const prefix = "/assets/storage/";
	const key = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
	if (!key) {
		return c.json({ error: "key is required" }, 400);
	}

	const rangeHeader = c.req.header("range") || c.req.header("Range") || "";
	const range = rangeHeader ? parseHttpByteRangeHeader(rangeHeader) : null;
	const rangeValue = toHttpRangeHeader(range);

	try {
		const client = createObjectStorageClient(c.env);
		const res = await client.send(
			new GetObjectCommand({
				Bucket: storage.bucket,
				Key: key,
				Range: rangeValue || undefined,
			}),
		);
		if (!res.Body) return c.json({ error: "not found" }, 404);
		const headers = new Headers();
		headers.set(
			"Content-Type",
			typeof res.ContentType === "string"
				? res.ContentType
				: "application/octet-stream",
		);
		headers.set(
			"Cache-Control",
			typeof res.CacheControl === "string"
				? res.CacheControl
				: "public, max-age=31536000, immutable",
		);
		headers.set("Access-Control-Allow-Origin", "*");
		headers.set(
			"Access-Control-Expose-Headers",
			"Content-Length,Content-Range,Accept-Ranges,ETag",
		);
		headers.set("Accept-Ranges", "bytes");
		if (typeof res.ETag === "string") headers.set("ETag", res.ETag);
		if (typeof res.ContentRange === "string") {
			headers.set("Content-Range", res.ContentRange);
		}
		if (typeof res.ContentLength === "number") {
			headers.set("Content-Length", String(res.ContentLength));
		}
		const status = range ? 206 : 200;
		return new Response(res.Body as ReadableStream, { status, headers });
	} catch {
		return c.json({ error: "not found" }, 404);
	}
});

// Given a full first-party object URL, stream it through the authenticated
// S3 data plane. Only the configured public origin is accepted.
assetRouter.get("/storage-stream", async (c) => {
	const storage = resolveObjectStorageConfig(c.env);
	if (!storage) {
		return c.json({ error: "Object storage is not configured" }, 500);
	}

	const raw = (c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ error: "url is required" }, 400);
	}
	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		// ignore — use raw
	}

	const publicBase = getPublicBase(c).replace(/\/+$/, "");
	if (!publicBase || !target.startsWith(`${publicBase}/`)) {
		return c.json({ error: "url is not an active object storage asset" }, 400);
	}
	const key = target.slice(publicBase.length + 1).split(/[?#]/)[0];
	if (!key) {
		return c.json({ error: "key is required" }, 400);
	}

	const rangeHeader = c.req.header("range") || c.req.header("Range") || "";
	const range = rangeHeader ? parseHttpByteRangeHeader(rangeHeader) : null;
	const rangeValue = toHttpRangeHeader(range);

	try {
		const client = createObjectStorageClient(c.env);
		const res = await client.send(
			new GetObjectCommand({
				Bucket: storage.bucket,
				Key: key,
				Range: rangeValue || undefined,
			}),
		);
		if (!res.Body) return c.json({ error: "not found" }, 404);
		const headers = new Headers();
		headers.set(
			"Content-Type",
			typeof res.ContentType === "string" ? res.ContentType : "video/mp4",
		);
		headers.set("Cache-Control", "private, max-age=300");
		headers.set("Access-Control-Allow-Origin", c.req.header("origin") || "*");
		headers.set(
			"Access-Control-Expose-Headers",
			"Content-Length,Content-Range,Accept-Ranges,ETag",
		);
		headers.set("Accept-Ranges", "bytes");
		headers.set("Vary", "Origin");
		if (typeof res.ETag === "string") headers.set("ETag", res.ETag);
		if (typeof res.ContentRange === "string") {
			headers.set("Content-Range", res.ContentRange);
		}
		if (typeof res.ContentLength === "number") {
			headers.set("Content-Length", String(res.ContentLength));
		}
		const status = range ? 206 : 200;
		return new Response(res.Body as ReadableStream, { status, headers });
	} catch {
		return c.json({ error: "not found" }, 404);
	}
});

// Upload a user asset file to configured object storage and persist it as an asset row.
assetRouter.post("/upload", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) {
		return c.json({ error: "Object storage is not configured" }, 500);
	}

	const MAX_BYTES = 30 * 1024 * 1024;
	const isNode = isNodeRuntime();
	const contentTypeHeader = normalizeContentType(c.req.header("content-type"));
	const isMultipart = contentTypeHeader.includes("multipart/form-data");

	let kind: "image" | "video" | "audio" | null = null;
	let contentType = contentTypeHeader;
	let originalName: string | null = null;
	let size: number | null = null;
	let uploadValue: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | Blob | null = null;
	let uploadPump: Promise<void> | null = null;
	let name = "";
	let prompt: string | null = null;
	let vendor: string | null = null;
	let modelKey: string | null = null;
	let taskKind: string | null = null;
	let projectId: string | null = null;

	if (isMultipart) {
		const form = await c.req.formData();
		const file = form.get("file");
		if (!(file instanceof File)) {
			return c.json({ error: "file is required" }, 400);
		}

		originalName = sanitizeUploadName((file as any).name || "");
		contentType = normalizeContentType(file.type);
		kind = inferMediaKind({ contentType, fileName: originalName });
		if (!kind) {
			return c.json({ error: "only image/video/audio files are allowed" }, 400);
		}

		if (typeof file.size === "number") {
			size = file.size;
			if (size > MAX_BYTES) {
				return c.json({ error: "file is too large (max 30MB)" }, 413);
			}
		}

		const nameValue = form.get("name");
		const rawName =
			typeof nameValue === "string" && nameValue.trim()
				? nameValue.trim()
				: originalName || "";
		name = sanitizeUploadName(rawName) || (kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image");

		prompt = normalizeOptionalText(form.get("prompt"), 8000);
		vendor = normalizeOptionalText(form.get("vendor"), 64);
		modelKey = normalizeOptionalText(form.get("modelKey"), 128);
		taskKind = normalizeOptionalText(form.get("taskKind"), 64);
		projectId = normalizeOptionalText(form.get("projectId"), 128);

		uploadValue = file;
	} else {
		originalName = sanitizeUploadName(c.req.header("x-file-name") || "");
		contentType = contentTypeHeader;
		kind = inferMediaKind({ contentType, fileName: originalName || undefined });
		if (!kind) {
			return c.json({ error: "only image/video/audio files are allowed" }, 400);
		}

		const contentLengthHeader = c.req.header("content-length");
		const parsedLen =
			typeof contentLengthHeader === "string" && contentLengthHeader
				? Number(contentLengthHeader)
				: NaN;
		const hasContentLength = Number.isFinite(parsedLen);
		const declaredSizeHeader = c.req.header("x-file-size");
		const declaredSize =
			typeof declaredSizeHeader === "string" && declaredSizeHeader
				? Number(declaredSizeHeader)
				: NaN;

		size = hasContentLength
			? parsedLen
			: Number.isFinite(declaredSize)
				? declaredSize
				: null;
		if (size != null && size > MAX_BYTES) {
			return c.json({ error: "file is too large (max 30MB)" }, 413);
		}

		name = sanitizeUploadName(c.req.query("name") || "") || (kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image");
		prompt =
			normalizeOptionalText(
				c.req.header("x-asset-prompt") ||
					c.req.header("x-tap-asset-prompt") ||
					c.req.query("prompt") ||
					"",
				8000,
			) ?? null;
		vendor =
			normalizeOptionalText(
				c.req.header("x-asset-vendor") ||
					c.req.header("x-tap-asset-vendor") ||
					c.req.query("vendor") ||
					"",
				64,
			) ?? null;
		modelKey =
			normalizeOptionalText(
				c.req.header("x-asset-model-key") ||
					c.req.header("x-tap-asset-model-key") ||
					c.req.query("modelKey") ||
					"",
				128,
			) ?? null;
		taskKind =
			normalizeOptionalText(
				c.req.header("x-asset-task-kind") ||
					c.req.header("x-tap-asset-task-kind") ||
					c.req.query("taskKind") ||
					"",
				64,
			) ?? null;
		projectId =
			normalizeOptionalText(
				c.req.header("x-asset-project-id") ||
					c.req.header("x-tap-asset-project-id") ||
					c.req.query("projectId") ||
					"",
				128,
			) ?? null;
		const bodyStream = c.req.raw.body as ReadableStream<Uint8Array> | null;
		if (!bodyStream) {
			return c.json({ error: "request body is required" }, 400);
		}

		if (isNode) {
			try {
				const bytes = await readStreamToBytes(bodyStream, MAX_BYTES);
				size = bytes.byteLength;
				uploadValue = bytes;
			} catch (err: any) {
				const msg = String(err?.message || "");
				if (/too large/i.test(msg)) {
					return c.json({ error: "file is too large (max 30MB)" }, 413);
				}
				throw err;
			}
		} else if (hasContentLength) {
			uploadValue = bodyStream;
		} else if (size != null) {
				const fixed = new TransformStream<Uint8Array, Uint8Array>();
				uploadPump = bodyStream.pipeTo(fixed.writable);
				uploadValue = fixed.readable;
		} else {
			try {
				const bytes = await readStreamToBytes(bodyStream, MAX_BYTES);
				size = bytes.byteLength;
				uploadValue = bytes;
			} catch (err: any) {
				const msg = String(err?.message || "");
				if (/too large/i.test(msg)) {
					return c.json({ error: "file is too large (max 30MB)" }, 413);
				}
				throw err;
			}
		}
	}

	const ext = detectUploadExtensionFromMeta({
		contentType,
		fileName: originalName || undefined,
	});
	const key = buildUserUploadKey(userId, ext);

	if (!uploadValue) {
		return c.json({ error: "request body is required" }, 400);
	}
	try {
		const client = createObjectStorageClient(c.env);
		let tosBody: any = uploadValue;
		let tosContentLength: number | undefined =
			typeof size === "number" && Number.isFinite(size) ? size : undefined;

		if (isNode) {
			if (uploadValue instanceof Uint8Array) {
				tosBody = uploadValue;
				tosContentLength = uploadValue.byteLength;
			} else if (uploadValue instanceof ArrayBuffer) {
				const bytes = new Uint8Array(uploadValue);
				tosBody = bytes;
				tosContentLength = bytes.byteLength;
			} else if (uploadValue instanceof Blob) {
				const bytes = new Uint8Array(await uploadValue.arrayBuffer());
				tosBody = bytes;
				tosContentLength = bytes.byteLength;
			}
		}

		const putPromise = client.send(
			new PutObjectCommand({
				Bucket: storageConfig.bucket,
				Key: key,
				Body: tosBody,
				ContentType: contentType,
				CacheControl: "public, max-age=31536000, immutable",
				ContentLength: tosContentLength,
			}),
		);
		if (uploadPump) {
			await Promise.all([putPromise, uploadPump]);
		} else {
			await putPromise;
		}
	} catch (err: any) {
		const msg = String(err?.message || "");
		if (/too large/i.test(msg)) {
			return c.json({ error: "file is too large (max 30MB)" }, 413);
		}
		throw err;
	}

	const publicBase = getPublicBase(c);
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;
	const thumbnailUrl =
		kind === "video" ? await captureUploadedVideoPoster(userId, key) : null;

	const nowIso = new Date().toISOString();
	const row = await createAssetRow(
		c.env.DB,
		userId,
		{
			name,
			data: {
				kind: "upload",
				type: kind,
				url,
				...(thumbnailUrl ? { thumbnailUrl } : {}),
				contentType,
				size,
				originalName: originalName || null,
				key,
				prompt,
				vendor,
				modelKey,
				taskKind,
			},
			projectId,
		},
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId: row.owner_id,
		projectId: row.project_id,
	});
	return c.json(payload);
});

// ── Direct-to-OSS upload (presigned URL) ────────────────────────────────────
// Browser PUTs the file straight to TOS, bypassing this API's bandwidth and the
// 30MB raw-upload cap. Two short JSON exchanges:
//   1) POST /assets/upload/presign  → uploadUrl + key
//   2) (browser) PUT uploadUrl with file bytes
//   3) POST /assets/upload/commit   → persists asset row, returns DTO
const DIRECT_UPLOAD_MAX_BYTES_VIDEO = 5 * 1024 * 1024 * 1024; // 5GB single-PUT product limit
const DIRECT_UPLOAD_MAX_BYTES_AUDIO = 1024 * 1024 * 1024; // 1GB
const DIRECT_UPLOAD_MAX_BYTES_IMAGE = 100 * 1024 * 1024; // 100MB
const DIRECT_UPLOAD_PRESIGN_TTL_SECONDS = 15 * 60;

assetRouter.post("/upload/presign", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) {
		return c.json({ error: "Object storage is not configured" }, 500);
	}

	const body = (await c.req.json().catch(() => ({}))) as {
		contentType?: string;
		size?: number;
		fileName?: string;
		kind?: string;
	};
	const contentType = normalizeContentType(body.contentType);
	const fileName = sanitizeUploadName(body.fileName || "");
	const declaredKind =
		typeof body.kind === "string" && body.kind.trim()
			? body.kind.trim().toLowerCase()
			: null;
	const inferredKind = inferMediaKind({ contentType, fileName: fileName || undefined });
	const kind: "image" | "video" | "audio" | null =
		declaredKind === "image" || declaredKind === "video" || declaredKind === "audio"
			? declaredKind
			: inferredKind;
	if (!kind) {
		return c.json({ error: "only image/video/audio files are allowed" }, 400);
	}

	const size =
		typeof body.size === "number" && Number.isFinite(body.size) ? body.size : null;
	if (size == null || size <= 0) {
		return c.json({ error: "size is required" }, 400);
	}
	const cap = kind === "video"
		? DIRECT_UPLOAD_MAX_BYTES_VIDEO
		: kind === "audio"
			? DIRECT_UPLOAD_MAX_BYTES_AUDIO
			: DIRECT_UPLOAD_MAX_BYTES_IMAGE;
	if (size > cap) {
		return c.json(
			{ error: `file is too large (max ${Math.floor(cap / (1024 * 1024))}MB)` },
			413,
		);
	}

	const ext = detectUploadExtensionFromMeta({
		contentType,
		fileName: fileName || undefined,
	});
	const key = buildUserUploadKey(userId, ext);

	const client = createObjectStorageClient(c.env);
	const uploadUrl = await getSignedUrl(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		client as any,
		new PutObjectCommand({
			Bucket: storageConfig.bucket,
			Key: key,
			ContentType: contentType,
			CacheControl: "public, max-age=31536000, immutable",
		}),
		{ expiresIn: DIRECT_UPLOAD_PRESIGN_TTL_SECONDS },
	);

	const publicBase = getPublicBase(c);
	const publicUrl = publicBase ? `${publicBase}/${key}` : `/${key}`;

	return c.json({
		uploadUrl,
		key,
		method: "PUT" as const,
		// Headers the browser MUST send on the PUT — they were part of the signature.
		requiredHeaders: {
			"content-type": contentType,
			"cache-control": "public, max-age=31536000, immutable",
		},
		publicUrl,
		expiresIn: DIRECT_UPLOAD_PRESIGN_TTL_SECONDS,
		kind,
	});
});

assetRouter.post("/upload/commit", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) {
		return c.json({ error: "Object storage is not configured" }, 500);
	}

	const body = (await c.req.json().catch(() => ({}))) as {
		key?: string;
		name?: string;
		contentType?: string;
		size?: number;
		kind?: string;
		originalName?: string;
		projectId?: string;
		prompt?: string;
		vendor?: string;
		modelKey?: string;
		taskKind?: string;
	};
	const key = typeof body.key === "string" ? body.key.trim() : "";
	if (!key) return c.json({ error: "key is required" }, 400);

	// Sanity-check the key was minted by /upload/presign for this user — prevents
	// callers from committing arbitrary objects in the bucket as their own.
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	if (!key.startsWith(`uploads/user/${safeUser}/`)) {
		return c.json({ error: "key does not belong to caller" }, 403);
	}

	const client = createObjectStorageClient(c.env);
	let headSize: number | null = null;
	let headContentType = normalizeContentType(body.contentType);
	try {
		const head = await client.send(
			new HeadObjectCommand({ Bucket: storageConfig.bucket, Key: key }),
		);
		if (typeof head.ContentLength === "number") headSize = head.ContentLength;
		if (typeof head.ContentType === "string" && head.ContentType.trim()) {
			headContentType = normalizeContentType(head.ContentType);
		}
	} catch {
		return c.json({ error: "object not found in storage; upload first" }, 404);
	}

	const originalName = sanitizeUploadName(body.originalName || "");
	const declaredKind =
		typeof body.kind === "string" && body.kind.trim()
			? body.kind.trim().toLowerCase()
			: null;
	const inferred = inferMediaKind({
		contentType: headContentType,
		fileName: originalName || undefined,
	});
	const kind: "image" | "video" | "audio" | null =
		declaredKind === "image" || declaredKind === "video" || declaredKind === "audio"
			? declaredKind
			: inferred;
	if (!kind) {
		return c.json({ error: "uploaded object is not image/video/audio" }, 400);
	}

	const declaredSize = typeof body.size === "number" && Number.isFinite(body.size) ? body.size : null;
	const size = headSize ?? declaredSize ?? null;
	const cap = kind === "video"
		? DIRECT_UPLOAD_MAX_BYTES_VIDEO
		: kind === "audio"
			? DIRECT_UPLOAD_MAX_BYTES_AUDIO
			: DIRECT_UPLOAD_MAX_BYTES_IMAGE;
	if (size != null && size > cap) {
		return c.json(
			{ error: `file is too large (max ${Math.floor(cap / (1024 * 1024))}MB)` },
			413,
		);
	}

	const name =
		sanitizeUploadName(body.name || "") ||
		originalName ||
		(kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image");
	const projectId = normalizeOptionalText(body.projectId, 128);
	const prompt = normalizeOptionalText(body.prompt, 8000);
	const vendor = normalizeOptionalText(body.vendor, 64);
	const modelKey = normalizeOptionalText(body.modelKey, 128);
	const taskKind = normalizeOptionalText(body.taskKind, 64);

	const publicBase = getPublicBase(c);
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;
	const thumbnailUrl =
		kind === "video" ? await captureUploadedVideoPoster(userId, key) : null;

	const nowIso = new Date().toISOString();
	const row = await createAssetRow(
		c.env.DB,
		userId,
		{
			name,
			data: {
				kind: "upload",
				type: kind,
				url,
				...(thumbnailUrl ? { thumbnailUrl } : {}),
				contentType: headContentType,
				size,
				originalName: originalName || null,
				key,
				prompt,
				vendor,
				modelKey,
				taskKind,
			},
			projectId,
		},
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId: row.owner_id,
		projectId: row.project_id,
	});
	return c.json(payload);
});

// Public TapShow feed: all OSS-hosted image/video assets
assetRouter.get("/public", async (c) => {
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	const canViewAll = await canViewAllTapShowAssets(c);

	const typeParam = (c.req.query("type") || "").toLowerCase();
	const requestedType =
		typeParam === "image" || typeParam === "video" ? typeParam : null;

	const rows = await listPublicAssets(c.env.DB, {
		limit,
		scope: canViewAll ? "all" : "public_projects",
	});
	const items = rows
		.map((row) => {
			let parsed: any = null;
			try {
				parsed = row.data ? JSON.parse(row.data) : null;
			} catch {
				parsed = null;
			}
			const data = (parsed || {}) as any;
			const rawType =
				typeof data.type === "string"
					? (data.type.toLowerCase() as string)
					: "";
			const type =
				rawType === "image" || rawType === "video" ? rawType : null;
			const url = typeof data.url === "string" ? data.url : null;
			if (!type || !url) {
				return null;
			}

			const thumbnailSource =
				typeof data.thumbnailUrl === "string"
					? data.thumbnailUrl
					: null;
			const thumbnailUrl =
				type === "image"
					? thumbnailSource || url
					: thumbnailSource || null;
			const duration =
				typeof data.duration === "number" && Number.isFinite(data.duration)
					? data.duration
					: typeof data.durationSeconds === "number" && Number.isFinite(data.durationSeconds)
						? data.durationSeconds
						: typeof data.videoDurationSeconds === "number" && Number.isFinite(data.videoDurationSeconds)
							? data.videoDurationSeconds
							: null;
			const prompt =
				typeof data.prompt === "string" ? data.prompt : null;
			const vendor =
				typeof data.vendor === "string" ? data.vendor : null;
			const modelKey =
				typeof data.modelKey === "string" ? data.modelKey : null;

			return PublicAssetSchema.parse({
				id: row.id,
				name: row.name,
				type,
				url,
				thumbnailUrl,
				duration,
				prompt,
				vendor,
				modelKey,
				createdAt: row.created_at,
				ownerLogin: row.owner_login,
				ownerName: row.owner_name,
				ownerAvatarUrl: row.owner_avatar_url,
				projectName: row.project_name,
			});
		})
		.filter((v): v is ReturnType<typeof PublicAssetSchema.parse> => !!v)
		.filter((item) =>
			requestedType ? item.type === requestedType : true,
		);

	return c.json(items);
});

// Published videos for Tv show: only assets created via the publish flow (kind=publishRecord)
// from public projects, with a non-empty videoUrl.
assetRouter.get("/published", async (c) => {
	const viewerId = (await resolveAuth(c).catch(() => null))?.payload.sub;
	const requestedSurface = c.req.query("surface");
	if (requestedSurface && requestedSurface !== "homepage") {
		return c.json({ error: `Unsupported published asset surface: ${requestedSurface}` }, 400);
	}
	const homepageSurface = requestedSurface === "homepage";
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	// Fetch a larger pool to account for JS-side filtering
	const fetchLimit =
		typeof limit === "number" && !Number.isNaN(limit)
			? Math.min(limit * 4, 96)
			: 96;

	// 发布=公开快照：只认 publishRecord 行本身，原项目状态/存亡不影响展示
	const rows = await listPublishRecordAssets({ limit: fetchLimit });

	const items = rows
		.map((row) => {
			let parsed: unknown = null;
			try {
				parsed = row.data ? JSON.parse(row.data) : null;
			} catch {
				parsed = null;
			}
			const data = parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed as Record<string, unknown>
				: {};

			if (data.kind !== "publishRecord") return null;
			if (data.publicationStatus === "unpublished") return null;

			const videoUrl =
				typeof data.videoUrl === "string" ? data.videoUrl.trim() : "";
			if (!videoUrl) return null;

			const thumbnailUrl =
				typeof data.coverImageUrl === "string" && data.coverImageUrl.trim()
					? data.coverImageUrl.trim()
					: null;

			const sourceProjectId =
				typeof data.sourceProjectId === "string" && data.sourceProjectId.trim()
					? data.sourceProjectId.trim()
					: (row.project_id ?? null);
			const sourceProjectName =
				typeof data.sourceProjectName === "string" && data.sourceProjectName.trim()
					? data.sourceProjectName.trim()
					: row.project_name;
			const sourceOwnerType =
				data.ownerType === "project" || data.ownerType === "chapter" || data.ownerType === "shortFilm"
					? data.ownerType
					: null;
			const sourceOwnerId =
				typeof data.ownerId === "string" && data.ownerId.trim()
					? data.ownerId.trim()
					: null;
			const sourceChapterTitle =
				sourceOwnerType === "chapter" && typeof data.sourceChapterTitle === "string" && data.sourceChapterTitle.trim()
					? data.sourceChapterTitle.trim()
					: null;

			return {
				...PublicAssetSchema.parse({
					id: row.id,
					name: typeof data.title === "string" && data.title.trim()
						? data.title.trim()
						: row.name,
					type: "video" as const,
					url: videoUrl,
					thumbnailUrl,
					duration: null,
					prompt:
						typeof data.description === "string" ? data.description : null,
					vendor: null,
					modelKey: null,
					createdAt: row.created_at,
					ownerLogin: row.owner_login,
					ownerName: row.owner_name,
					ownerAvatarUrl: row.owner_avatar_url,
					projectName: sourceProjectName,
					projectId: row.project_id,
					sourceProjectId,
					sourceOwnerType,
					sourceOwnerId,
					sourceChapterTitle,
				}),
				pinWeight: 0,
			};
		})
		.filter((v): v is NonNullable<typeof v> => !!v);

	// 互动数据：短片卡的点赞数取自公开的源项目（社区计数）
	const sourceIds = Array.from(
		new Set(
			items
				.map((i) => i.sourceProjectId)
				.filter((v): v is string => typeof v === "string" && !!v),
		),
	);
	const projectRows = await listProjectsTvInfo(sourceIds, viewerId);
	const projectMap = new Map(projectRows.map((row) => [row.id, row]));
	const enriched = items.map((i) => {
		const info = i.sourceProjectId ? projectMap.get(i.sourceProjectId) : undefined;
		return {
			...i,
			likeCount: info ? info.like_count : null,
			favoriteCount: info ? info.favorite_count : null,
			favorited: info?.favorited ?? false,
			canvasPublic: info ? info.is_public === 1 : false,
		};
	});

	const [rankingConfig, moderationConfig] = await Promise.all([
		getHomepageVideoRankingConfig(),
		getHomepageVideoModerationConfig(),
	]);
	const blockedAssetIds = new Set(moderationConfig.config.blockedAssetIds);
	const rankingCandidates = filterHomepageModeratedAssets(enriched, blockedAssetIds, homepageSurface);
	const ranking = calculateRanking(
		rankingCandidates.map((item) => ({
			id: item.id,
			metric: Math.max(0, item.likeCount ?? 0) + Math.max(0, item.favoriteCount ?? 0) * 2,
			createdAt: item.createdAt,
		})),
		{
			metricWeight: rankingConfig.config.engagementWeight,
			freshnessWeight: rankingConfig.config.freshnessWeight,
			freshnessHalfLifeDays: rankingConfig.config.freshnessHalfLifeDays,
			items: rankingConfig.config.items,
		},
	);
	const rankingById = new Map(ranking.map((item) => [item.id, item]));
	const ranked = rankingCandidates
		.map((item) => {
			const score = rankingById.get(item.id);
			if (!score) throw new Error(`homepage video ranking missing: ${item.id}`);
			return {
				...item,
				pinWeight: score.pinned ? 100 : score.recommended ? 10 : 0,
				algorithmScore: score.algorithmScore,
				manualBoost: score.manualBoost,
				effectiveScore: score.effectiveScore,
				recommended: score.recommended,
				pinned: score.pinned,
				displayOrder: score.displayOrder,
				rank: score.rank,
			};
		})
		.sort((left, right) => left.rank - right.rank)
		.slice(0, typeof limit === "number" && !Number.isNaN(limit) ? limit : 48);

	return c.json(ranked);
});

// Homepage carousel: publicly readable, admin-configured slides
assetRouter.get("/homepage-carousel", async (c) => {
	const carouselRow = await getGlobalAssetByName("homepageCarousel");
	if (!carouselRow) return c.json({ slides: [] });
	let parsed: any = null;
	try {
		parsed = JSON.parse(carouselRow.data || "{}");
	} catch {
		parsed = {};
	}
	const slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
	return c.json({
		slides: slides
			.filter((s: any) => typeof s?.imageUrl === "string" && s.imageUrl.trim())
			.map((s: any) => ({
				imageUrl: s.imageUrl.trim(),
				title: typeof s.title === "string" ? s.title.trim() : null,
				linkUrl: typeof s.linkUrl === "string" ? s.linkUrl.trim() : null,
			})),
	});
});

// Homepage decoration: publicly readable（登录页视频必须匿名可读）
assetRouter.get("/homepage-decoration", async (c) => {
	const row = await getGlobalAssetByName("homepageDecoration");
	let parsed: unknown = null;
	try {
		parsed = row?.data ? JSON.parse(row.data) : null;
	} catch {
		parsed = null;
	}
	return c.json(sanitizeHomepageDecoration(parsed));
});

function isBlockedProxyImageHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase();
	if (!host) return true;
	if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
	if (host.endsWith(".local")) return true;
	if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
	if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
	if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
	if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
	return false;
}

// Proxy image: /assets/proxy-image?url=...
// Used by the 3D image view editor so remote reference images can be textured without relying on third-party WebGL CORS.
assetRouter.get("/proxy-image", authMiddleware, async (c) => {
	const raw = (c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}
	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		// ignore
	}
	if (!/^https?:\/\//i.test(target)) {
		return c.json({ message: "only http/https urls are allowed" }, 400);
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return c.json({ message: "invalid url" }, 400);
	}

	if (isBlockedProxyImageHost(parsed.hostname)) {
		return c.json({ message: "upstream host is not allowed" }, 400);
	}

	try {
		const resp = await fetchWithHttpDebugLog(
			c,
			target,
			{
				headers: {
					Accept: "image/*",
					Origin: "https://tapcanvas.local",
				},
			},
			{ tag: "asset:proxy-image" },
		);
		if (!resp.ok) {
			return c.json({ message: `fetch upstream failed: ${resp.status}` }, 502);
		}

		const contentType = resp.headers.get("content-type") || "";
		if (!/^image\//i.test(contentType)) {
			return c.json({ message: `upstream is not an image: ${contentType || "unknown"}` }, 400);
		}

		const headers = new Headers();
		headers.set("Content-Type", contentType || "image/jpeg");
		const contentLength = resp.headers.get("content-length");
		if (contentLength) headers.set("Content-Length", contentLength);
		headers.set("Cache-Control", "private, max-age=300");

		return new Response(resp.body, {
			status: 200,
			headers,
		});
	} catch (err: unknown) {
		return c.json(
			{ message: err instanceof Error ? err.message : "image proxy failed" },
			500,
		);
	}
});

// Proxy video: /assets/proxy-video?url=...
// Used by WebCut (which loads MP4 via fetch/streams and thus needs CORS-compatible responses).
assetRouter.get("/proxy-video", authMiddleware, async (c) => {
	const raw = (c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}
	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		// ignore
	}
	if (!/^https?:\/\//i.test(target)) {
		return c.json({ message: "only http/https urls are allowed" }, 400);
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return c.json({ message: "invalid url" }, 400);
	}

	// Safety: avoid becoming a general-purpose open proxy (even though it's auth-protected).
	// Extend this allowlist if you need to support more upstreams.
	const host = parsed.hostname.toLowerCase();
	let r2PublicHost: string | null = null;
	try {
		const r2PublicBase = getPublicBase(c);
		if (r2PublicBase) {
			r2PublicHost = new URL(r2PublicBase).hostname.toLowerCase();
		}
	} catch {
		r2PublicHost = null;
	}

	const allowed =
		host === "videos.openai.com" ||
		host.endsWith(".openai.com") ||
		host.endsWith(".openaiusercontent.com") ||
		(!!r2PublicHost && host === r2PublicHost);
	if (!allowed) {
		return c.json({ message: "upstream host is not allowed" }, 400);
	}

	try {
		const range = c.req.header("range") || c.req.header("Range") || null;
		const resp = await fetchWithHttpDebugLog(
			c,
			target,
			{
				headers: {
					Origin: "https://tapcanvas.local",
					...(range ? { Range: range } : null),
				},
			},
			{ tag: "asset:proxy-video" },
		);

		// Allow 200/206 only
		if (!(resp.status === 200 || resp.status === 206)) {
			return c.json(
				{ message: `fetch upstream failed: ${resp.status}` },
				502,
			);
		}

		const ct = resp.headers.get("content-type") || "";
		if (!/^video\//i.test(ct) && !/mp4/i.test(ct)) {
			return c.json({ message: `upstream is not a video: ${ct || "unknown"}` }, 400);
		}

		const headers = new Headers();
		headers.set("Content-Type", ct || "video/mp4");
		const contentLength = resp.headers.get("content-length");
		if (contentLength) headers.set("Content-Length", contentLength);
		const acceptRanges = resp.headers.get("accept-ranges");
		if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
		const contentRange = resp.headers.get("content-range");
		if (contentRange) headers.set("Content-Range", contentRange);
		const origin = c.req.header("origin") || "";
		headers.set("Access-Control-Allow-Origin", origin || "*");
		headers.set("Access-Control-Allow-Credentials", "true");
		headers.set(
			"Access-Control-Expose-Headers",
			"Content-Length,Content-Range,Accept-Ranges",
		);
		headers.set("Vary", "Origin");

		// Signed URLs should not be cached for long.
		headers.set("Cache-Control", "private, max-age=60");

		return new Response(resp.body, {
			status: resp.status,
			headers,
		});
	} catch (err: any) {
		return c.json(
			{ message: err?.message || "proxy video failed" },
			500,
		);
	}
});

assetRouter.post("/character-library/import", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const projectId = normalizeOptionalText(body.projectId, 128) ?? null;
	const sourceAuthorization = normalizeTapNowText(body.sourceAuthorization);
	const sourceDeviceId = normalizeTapNowText(body.sourceDeviceId) || crypto.randomUUID();
	const sourceTimezone = normalizeTapNowText(body.sourceTimezone) || "Asia/Shanghai";
	const sourceLanguage = normalizeTapNowText(body.sourceLanguage) || "zh-CN";
	const sourceBrowserLocale = normalizeTapNowText(body.sourceBrowserLocale) || sourceLanguage;
	const upstreamFilters: TapNowCharacterFilterInput = {
		filterWorldview: body.filterWorldview,
		filterTheme: body.filterTheme,
		gender: body.gender,
		ageGroup: body.ageGroup,
		species: body.species,
		physique: body.physique,
		heightLevel: body.heightLevel,
		skinColor: body.skinColor,
		hairLength: body.hairLength,
		hairColor: body.hairColor,
		temperament: body.temperament,
	};
	const limitUpload = createAsyncLimiter(5);

	if (!sourceAuthorization) {
		return c.json({ error: "sourceAuthorization is required" }, 400);
	}

	const existingRows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryCharacter",
		projectId,
		limit: 5000,
	});
	const existingMap = new Map<
		string,
		{ id: string; name: string; data: ImportedCharacterLibraryRecord }
	>();
	for (const row of existingRows) {
		const parsed = parseImportedCharacterAsset(parseAssetJson(row.data));
		if (!parsed) continue;
		existingMap.set(parsed.sourceCharacterUid, {
			id: row.id,
			name: row.name,
			data: parsed,
		});
	}

	let importedCount = 0;
	let updatedCount = 0;
	let offset = 0;
	let total = 0;
	const pageSize = 30;
	const nowIso = new Date().toISOString();

	while (true) {
		const page = await fetchTapNowCharacterPage({
			c,
			offset,
			limit: pageSize,
			sourceAuthorization,
			sourceDeviceId,
			sourceTimezone,
			sourceLanguage,
			sourceBrowserLocale,
			filters: upstreamFilters,
		});
		const records = page.characters;
		if (!total && page.total > 0) total = page.total;
		if (!records.length) break;

		await Promise.all(records.map(async (record) => {
			const sourceCharacterUid = buildImportedCharacterUid(record);
			const existing = existingMap.get(sourceCharacterUid) || null;
			const sourceImageUrls = {
				fullBody: normalizeTapNowText(record.full_body_image_url),
				threeView: normalizeTapNowText(record.three_view_image_url),
				expression: normalizeTapNowText(record.expression_image_url),
				closeup: normalizeTapNowText(record.closeup_image_url),
			};
			const importedImageUrls = {
				fullBody:
					existing?.data.sourceImageUrls.fullBody === sourceImageUrls.fullBody
						? existing.data.importedImageUrls.fullBody
						: await limitUpload(() => uploadImportedCharacterImage({
								c,
								userId,
								sourceUrl: sourceImageUrls.fullBody,
								sourceAuthorization,
								sourceDeviceId,
								sourceTimezone,
								sourceLanguage,
								sourceBrowserLocale,
							})),
				threeView:
					existing?.data.sourceImageUrls.threeView === sourceImageUrls.threeView
						? existing.data.importedImageUrls.threeView
						: await limitUpload(() => uploadImportedCharacterImage({
								c,
								userId,
								sourceUrl: sourceImageUrls.threeView,
								sourceAuthorization,
								sourceDeviceId,
								sourceTimezone,
								sourceLanguage,
								sourceBrowserLocale,
							})),
				expression:
					existing?.data.sourceImageUrls.expression === sourceImageUrls.expression
						? existing.data.importedImageUrls.expression
						: await limitUpload(() => uploadImportedCharacterImage({
								c,
								userId,
								sourceUrl: sourceImageUrls.expression,
								sourceAuthorization,
								sourceDeviceId,
								sourceTimezone,
								sourceLanguage,
								sourceBrowserLocale,
							})),
				closeup:
					existing?.data.sourceImageUrls.closeup === sourceImageUrls.closeup
						? existing.data.importedImageUrls.closeup
						: await limitUpload(() => uploadImportedCharacterImage({
								c,
								userId,
								sourceUrl: sourceImageUrls.closeup,
								sourceAuthorization,
								sourceDeviceId,
								sourceTimezone,
								sourceLanguage,
								sourceBrowserLocale,
							})),
			};

			const payload: ImportedCharacterLibraryRecord = {
				kind: "aiCharacterLibraryCharacter",
				source: "tapnow",
				sourceCharacterUid,
				sourceCharacterId: normalizeTapNowText(record.character_id),
				sourceGroupNumber: normalizeTapNowText(record.group_number),
				era: normalizeTapNowText(record.era),
				culturalRegion: normalizeTapNowText(record.cultural_region),
				genre: normalizeTapNowText(record.genre),
				timePeriod: normalizeTapNowText(record.time_period),
				appearanceBackground: normalizeTapNowText(record.appearance_background),
				scene: normalizeTapNowText(record.scene),
				gender: normalizeTapNowText(record.gender),
				ageGroup: normalizeTapNowText(record.age_group),
				species: normalizeTapNowText(record.species),
				physique: normalizeTapNowText(record.physique),
				heightLevel: normalizeTapNowText(record.height_level),
				skinColor: normalizeTapNowText(record.skin_color),
				hairLength: normalizeTapNowText(record.hair_length),
				hairColor: normalizeTapNowText(record.hair_color),
				temperament: normalizeTapNowText(record.temperament),
				outfit: normalizeTapNowText(record.outfit),
				distinctiveFeatures: normalizeTapNowText(record.distinctive_features),
				identityHint: normalizeTapNowText(record.identity_hint),
				filterWorldview: normalizeTapNowText(record.filter_worldview),
				filterTheme: normalizeTapNowText(record.filter_theme),
				filterScene: normalizeTapNowText(record.filter_scene),
				sourceImageUrls,
				importedImageUrls,
				importedAt: existing?.data.importedAt || nowIso,
				updatedAt: nowIso,
			};

			const assetName =
				normalizeTapNowText(record.identity_hint) ||
				normalizeTapNowText(record.character_id) ||
				normalizeTapNowText(record.id) ||
				"AI角色";
			if (existing?.id) {
				await updateAssetDataRow(c.env.DB, userId, existing.id, payload, nowIso);
				updatedCount += 1;
				existingMap.set(sourceCharacterUid, { id: existing.id, name: assetName, data: payload });
			} else {
				const created = await createAssetRow(
					c.env.DB,
					userId,
					{ name: assetName, data: payload, projectId },
					nowIso,
				);
				importedCount += 1;
				existingMap.set(sourceCharacterUid, { id: created.id, name: assetName, data: payload });
			}
		}));

		offset += records.length;
		if (records.length < pageSize) break;
		if (total > 0 && offset >= total) break;
	}

	const syncStateRows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryImportState",
		projectId,
		limit: 10,
	});
	const syncPayload: ImportedCharacterLibrarySyncState = {
		kind: "aiCharacterLibraryImportState",
		source: "tapnow",
		totalCharacters: total || existingMap.size,
		importedCharacters: existingMap.size,
		lastSyncedAt: nowIso,
	};
	const syncStateRow = syncStateRows[0] || null;
	if (syncStateRow?.id) {
		await updateAssetDataRow(c.env.DB, userId, syncStateRow.id, syncPayload, nowIso);
	} else {
		await createAssetRow(
			c.env.DB,
			userId,
			{ name: "AI角色库导入状态", data: syncPayload, projectId },
			nowIso,
		);
	}

	return c.json({
		ok: true,
		totalCharacters: total || existingMap.size,
		importedCharacters: importedCount,
		updatedCharacters: updatedCount,
		storedCharacters: existingMap.size,
		lastSyncedAt: nowIso,
	});
});

assetRouter.get("/character-library/characters", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const requestUrl = new URL(c.req.url);
	const projectId = normalizeOptionalText(c.req.query("projectId"), 128) ?? null;
	const query = normalizeTapNowText(c.req.query("q"));
	const pageRaw = Number(c.req.query("page") || 0);
	const pageSizeRaw = Number(c.req.query("pageSize") || 0);
	const offsetRaw = Number(c.req.query("offset") || 0);
	const limitRaw = Number(c.req.query("limit") || 30);
	const page =
		Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 0;
	const pageSize =
		Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
			? Math.max(1, Math.min(Math.trunc(pageSizeRaw), 200))
			: 0;
	const offset =
		Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.trunc(offsetRaw) : 0;
	const limit =
		Number.isFinite(limitRaw) && limitRaw > 0
			? Math.max(1, Math.min(Math.trunc(limitRaw), 200))
			: 30;
	const worldview = readTapNowFilterValuesFromUrl(requestUrl, "filter_worldview");
	const theme = readTapNowFilterValuesFromUrl(requestUrl, "filter_theme");
	const gender = readTapNowFilterValuesFromUrl(requestUrl, "gender");
	const ageGroup = readTapNowFilterValuesFromUrl(requestUrl, "age_group");
	const species = readTapNowFilterValuesFromUrl(requestUrl, "species");
	const physique = readTapNowFilterValuesFromUrl(requestUrl, "physique");
	const heightLevel = readTapNowFilterValuesFromUrl(requestUrl, "height_level");
	const skinColor = readTapNowFilterValuesFromUrl(requestUrl, "skin_color");
	const hairLength = readTapNowFilterValuesFromUrl(requestUrl, "hair_length");
	const hairColor = readTapNowFilterValuesFromUrl(requestUrl, "hair_color");
	const temperament = readTapNowFilterValuesFromUrl(requestUrl, "temperament");

	const rows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryCharacter",
		projectId,
		limit: 5000,
	});
	const items = rows
		.map((row) => {
			const parsed = parseImportedCharacterAsset(parseAssetJson(row.data));
			if (!parsed) return null;
			return buildImportedCharacterResponse({
				id: row.id,
				name: row.name,
				projectId: row.project_id,
				record: parsed,
			});
		})
		.filter((item): item is ImportedCharacterLibraryListItem => item !== null)
		.filter((item) => matchesImportedCharacterQuery(item, query))
		.filter((item) => {
			if (!matchesTapNowFilter(item.filter_worldview, worldview)) return false;
			if (!matchesTapNowFilter(item.filter_theme, theme)) return false;
			if (!matchesTapNowFilter(item.gender, gender)) return false;
			if (!matchesTapNowFilter(item.age_group, ageGroup)) return false;
			if (!matchesTapNowFilter(item.species, species)) return false;
			if (!matchesTapNowFilter(item.physique, physique)) return false;
			if (!matchesTapNowFilter(item.height_level, heightLevel)) return false;
			if (!matchesTapNowFilter(item.skin_color, skinColor)) return false;
			if (!matchesTapNowFilter(item.hair_length, hairLength)) return false;
			if (!matchesTapNowFilter(item.hair_color, hairColor)) return false;
			if (!matchesTapNowFilter(item.temperament, temperament)) return false;
			return true;
		})
		.sort((a, b) => {
			const bTime = Date.parse(b.updated_at || "");
			const aTime = Date.parse(a.updated_at || "");
			if (Number.isFinite(bTime) && Number.isFinite(aTime) && bTime !== aTime) {
				return bTime - aTime;
			}
			return a.name.localeCompare(b.name, "zh-CN");
		});
	const effectiveLimit = pageSize || limit;
	const effectiveOffset = page > 0 ? (page - 1) * effectiveLimit : offset;

	const syncStateRows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryImportState",
		projectId,
		limit: 10,
	});
	const syncState =
		parseImportedCharacterSyncState(parseAssetJson(syncStateRows[0]?.data ?? null)) ?? null;

	return c.json({
		characters: items.slice(effectiveOffset, effectiveOffset + effectiveLimit),
		total: items.length,
		page: page > 0 ? page : undefined,
		pageSize: effectiveLimit,
		syncState: toImportedCharacterSyncStateDto(syncState),
	});
});

assetRouter.post("/character-library/characters", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const nowIso = new Date().toISOString();
	const body = (await c.req.json().catch(() => null)) as unknown;
	if (!body || typeof body !== "object") {
		return c.json({ error: "角色库记录必须是对象" }, 400);
	}
	const payload = body as ImportedCharacterLibraryUpsertInput;
	const projectId = normalizeImportedCharacterProjectId(payload.projectId);
	try {
		const normalized = normalizeImportedCharacterPayload({
			raw: payload,
			nowIso,
		});
		const created = await createAssetRow(
			c.env.DB,
			userId,
			{ name: normalized.name, data: normalized.record, projectId },
			nowIso,
		);
		await refreshImportedCharacterLibrarySyncState({
			c,
			userId,
			projectId,
			nowIso,
		});
		return c.json({
			character: buildImportedCharacterResponse({
				id: created.id,
				name: created.name,
				projectId: created.project_id,
				record: normalized.record,
			}),
		});
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "创建角色库记录失败" },
			400,
		);
	}
});

assetRouter.put("/character-library/characters/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = normalizeTapNowText(c.req.param("id"));
	if (!id) return c.json({ error: "id is required" }, 400);
	const row = await getAssetByIdForUser(c.env.DB, id, userId);
	if (!row) return c.json({ error: "角色库记录不存在" }, 404);
	const existing = parseImportedCharacterAsset(parseAssetJson(row.data));
	if (!existing) return c.json({ error: "目标资产不是角色库记录" }, 400);
	const body = (await c.req.json().catch(() => null)) as unknown;
	if (!body || typeof body !== "object") {
		return c.json({ error: "角色库记录必须是对象" }, 400);
	}
	const payload = body as ImportedCharacterLibraryUpsertInput;
	const nowIso = new Date().toISOString();
	const projectId =
		normalizeImportedCharacterProjectId(payload.projectId) ??
		normalizeImportedCharacterProjectId(row.project_id);
	try {
		const normalized = normalizeImportedCharacterPayload({
			raw: payload,
			nowIso,
			existing,
		});
		await updateAssetDataRow(c.env.DB, userId, id, normalized.record, nowIso);
		if (normalizeTapNowText(payload.name) && normalizeTapNowText(payload.name) !== row.name) {
			await renameAssetRow(c.env.DB, userId, id, normalizeTapNowText(payload.name), nowIso);
		}
		await refreshImportedCharacterLibrarySyncState({
			c,
			userId,
			projectId,
			nowIso,
		});
		return c.json({
			character: buildImportedCharacterResponse({
				id,
				name: normalizeTapNowText(payload.name) || row.name,
				projectId,
				record: normalized.record,
			}),
		});
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "更新角色库记录失败" },
			400,
		);
	}
});

assetRouter.delete("/character-library/characters/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = normalizeTapNowText(c.req.param("id"));
	if (!id) return c.json({ error: "id is required" }, 400);
	const row = await getAssetByIdForUser(c.env.DB, id, userId);
	if (!row) return c.json({ error: "角色库记录不存在" }, 404);
	const existing = parseImportedCharacterAsset(parseAssetJson(row.data));
	if (!existing) return c.json({ error: "目标资产不是角色库记录" }, 400);
	const nowIso = new Date().toISOString();
	const projectId = normalizeImportedCharacterProjectId(row.project_id);
	await deleteAssetRow(c.env.DB, userId, id);
	await refreshImportedCharacterLibrarySyncState({
		c,
		userId,
		projectId,
		nowIso,
	});
	return c.json({ ok: true });
});

assetRouter.post("/character-library/import-json", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => null)) as unknown;
	const { projectId, charactersRaw } = extractCharacterLibraryImportEnvelope(body);
	if (!charactersRaw.length) {
		return c.json({ error: "JSON 导入内容不能为空。支持数组、{characters:[...]}，以及 code/content/payload 包裹的 JSON / ```json code``` 文本" }, 400);
	}
	const existingRows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryCharacter",
		projectId,
		limit: 5000,
	});
	const existingByUid = new Map<
		string,
		{ rowId: string; name: string; projectId: string | null; data: ImportedCharacterLibraryRecord }
	>();
	for (const row of existingRows) {
		const parsed = parseImportedCharacterAsset(parseAssetJson(row.data));
		if (!parsed) continue;
		existingByUid.set(parsed.sourceCharacterUid, {
			rowId: row.id,
			name: row.name,
			projectId: row.project_id,
			data: parsed,
		});
	}
	const nowIso = new Date().toISOString();
	let importedCount = 0;
	let updatedCount = 0;
	for (const item of charactersRaw) {
		const payload =
			item && typeof item === "object"
				? ({
						...(item as Record<string, unknown>),
						...(projectId ? { projectId } : {}),
					} as ImportedCharacterLibraryUpsertInput)
				: item;
		const draft = normalizeImportedCharacterPayload({
			raw: payload,
			nowIso,
		});
		const existing = existingByUid.get(draft.record.sourceCharacterUid) || null;
		const targetProjectId =
			projectId ??
			(existing ? normalizeImportedCharacterProjectId(existing.projectId) : null);
		if (existing?.rowId) {
			const merged = normalizeImportedCharacterPayload({
				raw: payload,
				nowIso,
				existing: existing.data,
			});
			await updateAssetDataRow(c.env.DB, userId, existing.rowId, merged.record, nowIso);
			if (merged.name !== existing.name) {
				await renameAssetRow(c.env.DB, userId, existing.rowId, merged.name, nowIso);
			}
			existingByUid.set(merged.record.sourceCharacterUid, {
				rowId: existing.rowId,
				name: merged.name,
				projectId: targetProjectId,
				data: merged.record,
			});
			updatedCount += 1;
		} else {
			const created = await createAssetRow(
				c.env.DB,
				userId,
				{
					name: draft.name,
					data: draft.record,
					projectId: targetProjectId,
				},
				nowIso,
			);
			existingByUid.set(draft.record.sourceCharacterUid, {
				rowId: created.id,
				name: draft.name,
				projectId: targetProjectId,
				data: draft.record,
			});
			importedCount += 1;
		}
	}
	const storedCount = await refreshImportedCharacterLibrarySyncState({
		c,
		userId,
		projectId,
		nowIso,
	});
	return c.json({
		ok: true,
		importedCharacters: importedCount,
		updatedCharacters: updatedCount,
		storedCharacters: storedCount,
		lastSyncedAt: nowIso,
	});
});

type ImportedCharacterLibraryRecord = {
	kind: "aiCharacterLibraryCharacter";
	source: "tapnow" | "json";
	sourceCharacterUid: string;
	sourceCharacterId: string;
	sourceGroupNumber: string;
	era: string;
	culturalRegion: string;
	genre: string;
	timePeriod: string;
	appearanceBackground: string;
	scene: string;
	gender: string;
	ageGroup: string;
	species: string;
	physique: string;
	heightLevel: string;
	skinColor: string;
	hairLength: string;
	hairColor: string;
	temperament: string;
	outfit: string;
	distinctiveFeatures: string;
	identityHint: string;
	filterWorldview: string;
	filterTheme: string;
	filterScene: string;
	sourceImageUrls: {
		fullBody: string;
		threeView: string;
		expression: string;
		closeup: string;
	};
	importedImageUrls: {
		fullBody: string;
		threeView: string;
		expression: string;
		closeup: string;
	};
	importedAt: string;
	updatedAt: string;
};

type ImportedCharacterLibrarySyncState = {
	kind: "aiCharacterLibraryImportState";
	source: "tapnow" | "local";
	totalCharacters: number;
	importedCharacters: number;
	lastSyncedAt: string;
};

type ImportedCharacterLibraryUpsertInput = AiCharacterLibraryUpsertPayload & {
	source_full_body_image_url?: unknown;
	source_three_view_image_url?: unknown;
	source_expression_image_url?: unknown;
	source_closeup_image_url?: unknown;
	imported_at?: unknown;
};

type TapNowCharacterRecord = {
	id?: string;
	character_id?: string;
	group_number?: string;
	era?: string;
	cultural_region?: string;
	genre?: string;
	time_period?: string;
	appearance_background?: string;
	scene?: string;
	gender?: string;
	age_group?: string;
	species?: string;
	physique?: string;
	height_level?: string;
	skin_color?: string;
	hair_length?: string;
	hair_color?: string;
	temperament?: string;
	outfit?: string;
	distinctive_features?: string;
	identity_hint?: string;
	full_body_image_url?: string;
	three_view_image_url?: string;
	expression_image_url?: string;
	closeup_image_url?: string;
	filter_worldview?: string;
	filter_theme?: string;
	filter_scene?: string;
};

type ImportedCharacterLibraryListItem = AiCharacterLibraryCharacterDto;

function normalizeTapNowText(value: unknown): string {
	return String(value || "").trim();
}

function normalizeImportedCharacterProjectId(value: unknown): string | null {
	const text = normalizeTapNowText(value);
	return text ? text.slice(0, 128) : null;
}

function stripJsonCodeFence(text: string): string {
	const raw = String(text || "").trim();
	const match = raw.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ? match[1].trim() : raw;
}

function tryParseJsonFromUnknown(value: unknown): unknown | null {
	if (typeof value !== "string") return null;
	const text = stripJsonCodeFence(value);
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

function extractCharacterLibraryImportEnvelope(
	input: unknown,
): { projectId: string | null; charactersRaw: unknown[] } {
	const tryExtract = (
		value: unknown,
		projectIdHint?: string | null,
	): { projectId: string | null; charactersRaw: unknown[] } | null => {
		if (Array.isArray(value)) {
			return {
				projectId: projectIdHint ?? null,
				charactersRaw: value,
			};
		}
		if (!value || typeof value !== "object") return null;
		const record = value as Record<string, unknown>;
		const nextProjectId =
			normalizeImportedCharacterProjectId(record.projectId) ?? projectIdHint ?? null;
		if (Array.isArray(record.characters)) {
			return {
				projectId: nextProjectId,
				charactersRaw: record.characters,
			};
		}
		const nestedKeys = ["code", "content", "payload", "data", "body", "json"];
		for (const key of nestedKeys) {
			if (!(key in record)) continue;
			const nestedValue = record[key];
			const parsedNested =
				tryParseJsonFromUnknown(nestedValue) ??
				(typeof nestedValue === "object" ? nestedValue : null);
			const extracted = tryExtract(parsedNested, nextProjectId);
			if (extracted?.charactersRaw.length) return extracted;
		}
		return null;
	};

	const parsedTopLevel = tryParseJsonFromUnknown(input);
	const extracted = tryExtract(parsedTopLevel ?? input);
	return extracted ?? { projectId: null, charactersRaw: [] };
}

function normalizeTapNowFilterValues(value: unknown): string[] {
	if (Array.isArray(value)) {
		return Array.from(
			new Set(
				value
					.map((item) => normalizeTapNowText(item).toLowerCase())
					.filter(Boolean),
			),
		);
	}
	const text = normalizeTapNowText(value).toLowerCase();
	return text ? [text] : [];
}

function readTapNowFilterValuesFromUrl(url: URL, key: string): string[] {
	return Array.from(
		new Set(
			url.searchParams
				.getAll(key)
				.map((item) => normalizeTapNowText(item).toLowerCase())
				.filter(Boolean),
		),
	);
}

function matchesTapNowFilter(value: string, filters: string[]): boolean {
	if (!filters.length) return true;
	return filters.includes(normalizeTapNowText(value).toLowerCase());
}

type TapNowCharacterFilterInput = {
	filterWorldview?: string | string[];
	filterTheme?: string | string[];
	gender?: string | string[];
	ageGroup?: string | string[];
	species?: string | string[];
	physique?: string | string[];
	heightLevel?: string | string[];
	skinColor?: string | string[];
	hairLength?: string | string[];
	hairColor?: string | string[];
	temperament?: string | string[];
};

function appendTapNowFilterQuery(
	searchParams: URLSearchParams,
	key: string,
	value?: string | string[],
): void {
	for (const item of normalizeTapNowFilterValues(value)) {
		searchParams.append(key, item);
	}
}

function createAsyncLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
	const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 1;
	let active = 0;
	const queue: Array<() => void> = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		if (active >= safeLimit) {
			await new Promise<void>((resolve) => {
				queue.push(resolve);
			});
		}
		active += 1;
		try {
			return await task();
		} finally {
			active = Math.max(0, active - 1);
			const next = queue.shift();
			if (next) next();
		}
	};
}

function buildImportedCharacterUid(record: TapNowCharacterRecord): string {
	const primary = normalizeTapNowText(record.id);
	if (primary) return primary;
	const fallback = `${normalizeTapNowText(record.group_number)}:${normalizeTapNowText(record.character_id)}`;
	if (fallback !== ":") return fallback;
	throw new Error("tapnow character record missing id");
}

function parseAssetJson(data: string | null | undefined): unknown {
	if (typeof data !== "string" || !data.trim()) return null;
	try {
		return JSON.parse(data);
	} catch {
		return null;
	}
}

function parseImportedCharacterAsset(data: unknown): ImportedCharacterLibraryRecord | null {
	if (!data || typeof data !== "object") return null;
	const raw = data as Record<string, unknown>;
	if (normalizeTapNowText(raw.kind) !== "aiCharacterLibraryCharacter") return null;
	const sourceCharacterUid = normalizeTapNowText(raw.sourceCharacterUid);
	if (!sourceCharacterUid) return null;
	const importedImageUrlsRaw =
		raw.importedImageUrls && typeof raw.importedImageUrls === "object"
			? (raw.importedImageUrls as Record<string, unknown>)
			: {};
	const sourceImageUrlsRaw =
		raw.sourceImageUrls && typeof raw.sourceImageUrls === "object"
			? (raw.sourceImageUrls as Record<string, unknown>)
			: {};
	return {
		kind: "aiCharacterLibraryCharacter",
		source: "tapnow",
		sourceCharacterUid,
		sourceCharacterId: normalizeTapNowText(raw.sourceCharacterId),
		sourceGroupNumber: normalizeTapNowText(raw.sourceGroupNumber),
		era: normalizeTapNowText(raw.era),
		culturalRegion: normalizeTapNowText(raw.culturalRegion),
		genre: normalizeTapNowText(raw.genre),
		timePeriod: normalizeTapNowText(raw.timePeriod),
		appearanceBackground: normalizeTapNowText(raw.appearanceBackground),
		scene: normalizeTapNowText(raw.scene),
		gender: normalizeTapNowText(raw.gender),
		ageGroup: normalizeTapNowText(raw.ageGroup),
		species: normalizeTapNowText(raw.species),
		physique: normalizeTapNowText(raw.physique),
		heightLevel: normalizeTapNowText(raw.heightLevel),
		skinColor: normalizeTapNowText(raw.skinColor),
		hairLength: normalizeTapNowText(raw.hairLength),
		hairColor: normalizeTapNowText(raw.hairColor),
		temperament: normalizeTapNowText(raw.temperament),
		outfit: normalizeTapNowText(raw.outfit),
		distinctiveFeatures: normalizeTapNowText(raw.distinctiveFeatures),
		identityHint: normalizeTapNowText(raw.identityHint),
		filterWorldview: normalizeTapNowText(raw.filterWorldview),
		filterTheme: normalizeTapNowText(raw.filterTheme),
		filterScene: normalizeTapNowText(raw.filterScene),
		sourceImageUrls: {
			fullBody: normalizeTapNowText(sourceImageUrlsRaw.fullBody),
			threeView: normalizeTapNowText(sourceImageUrlsRaw.threeView),
			expression: normalizeTapNowText(sourceImageUrlsRaw.expression),
			closeup: normalizeTapNowText(sourceImageUrlsRaw.closeup),
		},
		importedImageUrls: {
			fullBody: normalizeTapNowText(importedImageUrlsRaw.fullBody),
			threeView: normalizeTapNowText(importedImageUrlsRaw.threeView),
			expression: normalizeTapNowText(importedImageUrlsRaw.expression),
			closeup: normalizeTapNowText(importedImageUrlsRaw.closeup),
		},
		importedAt: normalizeTapNowText(raw.importedAt),
		updatedAt: normalizeTapNowText(raw.updatedAt),
	};
}

function parseImportedCharacterSyncState(
	data: unknown,
): ImportedCharacterLibrarySyncState | null {
	if (!data || typeof data !== "object") return null;
	const raw = data as Record<string, unknown>;
	if (normalizeTapNowText(raw.kind) !== "aiCharacterLibraryImportState") return null;
	const totalCharacters = Number(raw.totalCharacters);
	const importedCharacters = Number(raw.importedCharacters);
	const lastSyncedAt = normalizeTapNowText(raw.lastSyncedAt);
	if (!Number.isFinite(totalCharacters) || !Number.isFinite(importedCharacters)) {
		return null;
	}
	return {
		kind: "aiCharacterLibraryImportState",
		source: normalizeTapNowText(raw.source) === "local" ? "local" : "tapnow",
		totalCharacters: Math.max(0, Math.trunc(totalCharacters)),
		importedCharacters: Math.max(0, Math.trunc(importedCharacters)),
		lastSyncedAt,
	};
}

function toImportedCharacterResponse(
	record: ImportedCharacterLibraryRecord,
): Omit<AiCharacterLibraryCharacterDto, "id" | "name" | "projectId"> {
	return {
		character_id: record.sourceCharacterId,
		group_number: record.sourceGroupNumber,
		era: record.era,
		cultural_region: record.culturalRegion,
		genre: record.genre,
		time_period: record.timePeriod,
		appearance_background: record.appearanceBackground,
		scene: record.scene,
		gender: record.gender,
		age_group: record.ageGroup,
		species: record.species,
		physique: record.physique,
		height_level: record.heightLevel,
		skin_color: record.skinColor,
		hair_length: record.hairLength,
		hair_color: record.hairColor,
		temperament: record.temperament,
		outfit: record.outfit,
		distinctive_features: record.distinctiveFeatures,
		identity_hint: record.identityHint,
		full_body_image_url: record.importedImageUrls.fullBody,
		three_view_image_url: record.importedImageUrls.threeView,
		expression_image_url: record.importedImageUrls.expression,
		closeup_image_url: record.importedImageUrls.closeup,
		filter_worldview: record.filterWorldview,
		filter_theme: record.filterTheme,
		filter_scene: record.filterScene,
		imported_at: record.importedAt,
		updated_at: record.updatedAt,
	};
}

function buildImportedCharacterResponse(input: {
	id: string;
	name: string;
	projectId: string | null;
	record: ImportedCharacterLibraryRecord;
}): ImportedCharacterLibraryListItem {
	return {
		id: input.id,
		name: input.name,
		projectId: input.projectId,
		...toImportedCharacterResponse(input.record),
	};
}

function toImportedCharacterSyncStateDto(
	state: ImportedCharacterLibrarySyncState | null,
): AiCharacterLibrarySyncStateDto | null {
	if (!state) return null;
	return {
		totalCharacters: state.totalCharacters,
		importedCharacters: state.importedCharacters,
		lastSyncedAt: state.lastSyncedAt,
	};
}

function buildImportedCharacterUidFromInput(input: {
	sourceCharacterUid?: string;
	groupNumber?: string;
	characterId?: string;
	identityHint?: string;
	name?: string;
}): string {
	const explicitUid = normalizeTapNowText(input.sourceCharacterUid);
	if (explicitUid) return explicitUid;
	const composite = [
		normalizeTapNowText(input.groupNumber),
		normalizeTapNowText(input.characterId),
		normalizeTapNowText(input.identityHint),
		normalizeTapNowText(input.name),
	]
		.filter(Boolean)
		.join(":")
		.toLowerCase();
	if (!composite) {
		throw new Error("角色库记录缺少可用于生成唯一标识的字段");
	}
	return `json:${composite}`;
}

function normalizeImportedCharacterPayload(input: {
	raw: unknown;
	nowIso: string;
	existing?: ImportedCharacterLibraryRecord | null;
}): { name: string; record: ImportedCharacterLibraryRecord } {
	if (!input.raw || typeof input.raw !== "object") {
		throw new Error("角色库记录必须是对象");
	}
	const raw = input.raw as ImportedCharacterLibraryUpsertInput;
	const existing = input.existing || null;
	const sourceCharacterId = normalizeTapNowText(raw.character_id) || existing?.sourceCharacterId || "";
	const identityHint = normalizeTapNowText(raw.identity_hint) || existing?.identityHint || "";
	const name =
		normalizeTapNowText(raw.name) ||
		identityHint ||
		sourceCharacterId ||
		existing?.identityHint ||
		existing?.sourceCharacterId ||
		"AI角色";
	if (!name.trim()) {
		throw new Error("角色库记录缺少 name / identity_hint / character_id");
	}
	const sourceGroupNumber = normalizeTapNowText(raw.group_number) || existing?.sourceGroupNumber || "";
	const sourceCharacterUid = buildImportedCharacterUidFromInput({
		sourceCharacterUid: normalizeTapNowText(raw.sourceCharacterUid) || existing?.sourceCharacterUid || "",
		groupNumber: sourceGroupNumber,
		characterId: sourceCharacterId,
		identityHint,
		name,
	});
	const importedImageUrls = {
		fullBody:
			normalizeTapNowText(raw.full_body_image_url) ||
			existing?.importedImageUrls.fullBody ||
			"",
		threeView:
			normalizeTapNowText(raw.three_view_image_url) ||
			existing?.importedImageUrls.threeView ||
			"",
		expression:
			normalizeTapNowText(raw.expression_image_url) ||
			existing?.importedImageUrls.expression ||
			"",
		closeup:
			normalizeTapNowText(raw.closeup_image_url) ||
			existing?.importedImageUrls.closeup ||
			"",
	};
	const sourceImageUrls = {
		fullBody:
			normalizeTapNowText(raw.source_full_body_image_url) ||
			existing?.sourceImageUrls.fullBody ||
			importedImageUrls.fullBody,
		threeView:
			normalizeTapNowText(raw.source_three_view_image_url) ||
			existing?.sourceImageUrls.threeView ||
			importedImageUrls.threeView,
		expression:
			normalizeTapNowText(raw.source_expression_image_url) ||
			existing?.sourceImageUrls.expression ||
			importedImageUrls.expression,
		closeup:
			normalizeTapNowText(raw.source_closeup_image_url) ||
			existing?.sourceImageUrls.closeup ||
			importedImageUrls.closeup,
	};
	return {
		name,
		record: {
			kind: "aiCharacterLibraryCharacter",
			source: existing?.source === "tapnow" ? "tapnow" : "json",
			sourceCharacterUid,
			sourceCharacterId,
			sourceGroupNumber,
			era: normalizeTapNowText(raw.era) || existing?.era || "",
			culturalRegion:
				normalizeTapNowText(raw.cultural_region) || existing?.culturalRegion || "",
			genre: normalizeTapNowText(raw.genre) || existing?.genre || "",
			timePeriod:
				normalizeTapNowText(raw.time_period) || existing?.timePeriod || "",
			appearanceBackground:
				normalizeTapNowText(raw.appearance_background) ||
				existing?.appearanceBackground ||
				"",
			scene: normalizeTapNowText(raw.scene) || existing?.scene || "",
			gender: normalizeTapNowText(raw.gender) || existing?.gender || "",
			ageGroup: normalizeTapNowText(raw.age_group) || existing?.ageGroup || "",
			species: normalizeTapNowText(raw.species) || existing?.species || "",
			physique: normalizeTapNowText(raw.physique) || existing?.physique || "",
			heightLevel:
				normalizeTapNowText(raw.height_level) || existing?.heightLevel || "",
			skinColor:
				normalizeTapNowText(raw.skin_color) || existing?.skinColor || "",
			hairLength:
				normalizeTapNowText(raw.hair_length) || existing?.hairLength || "",
			hairColor:
				normalizeTapNowText(raw.hair_color) || existing?.hairColor || "",
			temperament:
				normalizeTapNowText(raw.temperament) || existing?.temperament || "",
			outfit: normalizeTapNowText(raw.outfit) || existing?.outfit || "",
			distinctiveFeatures:
				normalizeTapNowText(raw.distinctive_features) ||
				existing?.distinctiveFeatures ||
				"",
			identityHint,
			filterWorldview:
				normalizeTapNowText(raw.filter_worldview) || existing?.filterWorldview || "",
			filterTheme:
				normalizeTapNowText(raw.filter_theme) || existing?.filterTheme || "",
			filterScene:
				normalizeTapNowText(raw.filter_scene) || existing?.filterScene || "",
			sourceImageUrls,
			importedImageUrls,
			importedAt:
				normalizeTapNowText(raw.imported_at) ||
				existing?.importedAt ||
				input.nowIso,
			updatedAt: input.nowIso,
		},
	};
}

function matchesImportedCharacterQuery(
	item: ImportedCharacterLibraryListItem,
	query: string,
): boolean {
	const normalizedQuery = normalizeTapNowText(query).toLowerCase();
	if (!normalizedQuery) return true;
	const haystack = [
		item.name,
		item.character_id,
		item.group_number,
		item.identity_hint,
		item.era,
		item.cultural_region,
		item.genre,
		item.time_period,
		item.scene,
		item.gender,
		item.age_group,
		item.species,
		item.physique,
		item.height_level,
		item.skin_color,
		item.hair_length,
		item.hair_color,
		item.temperament,
		item.outfit,
		item.distinctive_features,
		item.filter_worldview,
		item.filter_theme,
		item.filter_scene,
	]
		.map((value) => normalizeTapNowText(value).toLowerCase())
		.filter(Boolean);
	return haystack.some((value) => value.includes(normalizedQuery));
}

async function refreshImportedCharacterLibrarySyncState(input: {
	c: AppContext;
	userId: string;
	projectId: string | null;
	nowIso: string;
	lastSyncedAt?: string;
}): Promise<number> {
	const rows = await listAssetsForUserByKind(input.c.env.DB, input.userId, {
		kind: "aiCharacterLibraryCharacter",
		projectId: input.projectId,
		limit: 5000,
	});
	const storedCount = rows.length;
	const syncPayload: ImportedCharacterLibrarySyncState = {
		kind: "aiCharacterLibraryImportState",
		source: "local",
		totalCharacters: storedCount,
		importedCharacters: storedCount,
		lastSyncedAt: input.lastSyncedAt || input.nowIso,
	};
	const syncStateRows = await listAssetsForUserByKind(input.c.env.DB, input.userId, {
		kind: "aiCharacterLibraryImportState",
		projectId: input.projectId,
		limit: 10,
	});
	const syncStateRow = syncStateRows[0] || null;
	if (syncStateRow?.id) {
		await updateAssetDataRow(
			input.c.env.DB,
			input.userId,
			syncStateRow.id,
			syncPayload,
			input.nowIso,
		);
	} else {
		await createAssetRow(
			input.c.env.DB,
			input.userId,
			{ name: "AI角色库导入状态", data: syncPayload, projectId: input.projectId },
			input.nowIso,
		);
	}
	return storedCount;
}

async function uploadImportedCharacterImage(input: {
	c: AppContext;
	userId: string;
	sourceUrl: string;
	sourceAuthorization: string;
	sourceDeviceId: string;
	sourceTimezone: string;
	sourceLanguage: string;
	sourceBrowserLocale: string;
}): Promise<string> {
	const targetUrl = normalizeTapNowText(input.sourceUrl);
	if (!targetUrl) return "";
	const storageConfig = resolveObjectStorageConfig(input.c.env);
	if (!storageConfig) {
		throw new Error("Object storage is not configured");
	}
	const response = await fetchWithHttpDebugLog(
		input.c,
		targetUrl,
		{
			headers: {
				Authorization: input.sourceAuthorization,
				"X-Device-ID": input.sourceDeviceId,
				"X-Timezone": input.sourceTimezone,
				"X-Device-Type": "web",
				"User-Lang": input.sourceLanguage,
				"X-Browser-Locale": input.sourceBrowserLocale,
			},
		},
		{ tag: "asset:import-character-image-source" },
	);
	if (!response.ok) {
		throw new Error(`character image upstream failed: ${response.status}`);
	}
	const contentType = normalizeContentType(response.headers.get("content-type") || "");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (!bytes.byteLength) {
		throw new Error("character image upstream returned empty body");
	}
	const ext = detectUploadExtensionFromMeta({
		contentType,
		fileName: targetUrl.split("/").pop() || undefined,
	});
	const key = buildUserUploadKey(input.userId, ext);
	const client = createObjectStorageClient(input.c.env);
	await client.send(
		new PutObjectCommand({
			Bucket: storageConfig.bucket,
			Key: key,
			Body: bytes,
			ContentType: contentType || "image/jpeg",
			CacheControl: "public, max-age=31536000, immutable",
			ContentLength: bytes.byteLength,
		}),
	);
	const publicBase = getPublicBase(input.c);
	return publicBase ? `${publicBase}/${key}` : `/${key}`;
}

async function fetchTapNowCharacterPage(input: {
	c: AppContext;
	offset: number;
	limit: number;
	sourceAuthorization: string;
	sourceDeviceId: string;
	sourceTimezone: string;
	sourceLanguage: string;
	sourceBrowserLocale: string;
	filters?: TapNowCharacterFilterInput;
}): Promise<{ characters: TapNowCharacterRecord[]; total: number }> {
	const qs = new URLSearchParams();
	qs.set("offset", String(input.offset));
	qs.set("limit", String(input.limit));
	qs.set("with_total", "true");
	appendTapNowFilterQuery(qs, "filter_worldview", input.filters?.filterWorldview);
	appendTapNowFilterQuery(qs, "filter_theme", input.filters?.filterTheme);
	appendTapNowFilterQuery(qs, "gender", input.filters?.gender);
	appendTapNowFilterQuery(qs, "age_group", input.filters?.ageGroup);
	appendTapNowFilterQuery(qs, "species", input.filters?.species);
	appendTapNowFilterQuery(qs, "physique", input.filters?.physique);
	appendTapNowFilterQuery(qs, "height_level", input.filters?.heightLevel);
	appendTapNowFilterQuery(qs, "skin_color", input.filters?.skinColor);
	appendTapNowFilterQuery(qs, "hair_length", input.filters?.hairLength);
	appendTapNowFilterQuery(qs, "hair_color", input.filters?.hairColor);
	appendTapNowFilterQuery(qs, "temperament", input.filters?.temperament);
	const url = `https://app.tapnow.ai/api/canvas/v1/character-library/characters?${qs.toString()}`;
	const response = await fetchWithHttpDebugLog(
		input.c,
		url,
		{
			headers: {
				Authorization: input.sourceAuthorization,
				"X-Device-ID": input.sourceDeviceId,
				"X-Timezone": input.sourceTimezone,
				"X-Device-Type": "web",
				"User-Lang": input.sourceLanguage,
				"X-Browser-Locale": input.sourceBrowserLocale,
				Accept: "application/json",
			},
		},
		{ tag: "asset:import-character-library-page" },
	);
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`character library upstream failed: ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
	}
	const payload = (await response.json()) as {
		code?: number;
		data?: {
			characters?: TapNowCharacterRecord[];
			total?: number;
		};
	};
	if (payload?.code !== 0) {
		throw new Error(`character library upstream code=${String(payload?.code ?? "unknown")}`);
	}
	return {
		characters: Array.isArray(payload?.data?.characters) ? payload.data.characters : [],
		total:
			typeof payload?.data?.total === "number" && Number.isFinite(payload.data.total)
				? payload.data.total
				: 0,
	};
}

assetRouter.get("/external/character-library/characters", authMiddleware, async (c) => {
	const authorization = c.req.header("authorization") || c.req.header("Authorization") || "";
	if (!authorization.trim()) {
		return c.json({ message: "authorization header is required" }, 401);
	}

	const requestUrl = new URL(c.req.url);
	const qs = new URLSearchParams();
	for (const key of [
		"offset",
		"limit",
		"with_total",
		"filter_worldview",
		"filter_theme",
		"gender",
		"age_group",
		"species",
		"physique",
		"height_level",
		"skin_color",
		"hair_length",
		"hair_color",
		"temperament",
	] as const) {
		for (const value of requestUrl.searchParams.getAll(key)) {
			const normalized = String(value || "").trim();
			if (normalized) qs.append(key, normalized);
		}
	}

	const targetUrl = `https://app.tapnow.ai/api/canvas/v1/character-library/characters${qs.toString() ? `?${qs.toString()}` : ""}`;
	try {
		const response = await fetchWithHttpDebugLog(
			c,
			targetUrl,
			{
				headers: {
					Authorization: authorization,
					"X-Device-ID": String(c.req.header("x-device-id") || c.req.header("X-Device-ID") || "").trim(),
					"X-Timezone": String(c.req.header("x-timezone") || c.req.header("X-Timezone") || "Asia/Shanghai").trim(),
					"X-Device-Type": String(c.req.header("x-device-type") || c.req.header("X-Device-Type") || "web").trim(),
					"User-Lang": String(c.req.header("user-lang") || c.req.header("User-Lang") || "zh-CN").trim(),
					"X-Browser-Locale": String(c.req.header("x-browser-locale") || c.req.header("X-Browser-Locale") || "zh-CN").trim(),
					Accept: "application/json",
				},
			},
			{ tag: "asset:external-character-library" },
		);
		const text = await response.text();
		if (!response.ok) {
			return c.json(
				{ message: `character library upstream failed: ${response.status}`, details: text.slice(0, 2000) },
				502,
			);
		}
		return new Response(text, {
			status: 200,
			headers: {
				"Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
				"Cache-Control": "private, max-age=30",
			},
		});
	} catch (err: unknown) {
		return c.json(
			{ message: err instanceof Error ? err.message : "character library proxy failed" },
			500,
		);
	}
});

assetRouter.get("/external/character-library/image", authMiddleware, async (c) => {
	const authorization = c.req.header("authorization") || c.req.header("Authorization") || "";
	if (!authorization.trim()) {
		return c.json({ message: "authorization header is required" }, 401);
	}

	const raw = String(c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}

	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		target = raw;
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return c.json({ message: "invalid url" }, 400);
	}

	const host = parsed.hostname.toLowerCase();
	const pathname = parsed.pathname;
	if (host !== "app.tapnow.ai" || !pathname.startsWith("/api/conversation/storage/uploads/")) {
		return c.json({ message: "upstream host is not allowed" }, 400);
	}

	try {
		const response = await fetchWithHttpDebugLog(
			c,
			target,
			{
				headers: {
					Authorization: authorization,
					"X-Device-ID": String(c.req.header("x-device-id") || c.req.header("X-Device-ID") || "").trim(),
					"X-Timezone": String(c.req.header("x-timezone") || c.req.header("X-Timezone") || "Asia/Shanghai").trim(),
					"X-Device-Type": String(c.req.header("x-device-type") || c.req.header("X-Device-Type") || "web").trim(),
					"User-Lang": String(c.req.header("user-lang") || c.req.header("User-Lang") || "zh-CN").trim(),
					"X-Browser-Locale": String(c.req.header("x-browser-locale") || c.req.header("X-Browser-Locale") || "zh-CN").trim(),
				},
			},
			{ tag: "asset:external-character-library-image" },
		);
		if (!response.ok) {
			return c.json({ message: `image upstream failed: ${response.status}` }, 502);
		}
		const headers = new Headers();
		headers.set("Content-Type", response.headers.get("content-type") || "image/jpeg");
		const contentLength = response.headers.get("content-length");
		if (contentLength) headers.set("Content-Length", contentLength);
		headers.set("Cache-Control", "private, max-age=300");
		return new Response(response.body, {
			status: 200,
			headers,
		});
	} catch (err: unknown) {
		return c.json(
			{ message: err instanceof Error ? err.message : "character library image proxy failed" },
			500,
		);
	}
});

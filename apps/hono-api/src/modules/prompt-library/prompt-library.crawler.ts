import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { WorkerEnv } from "../../types";
import {
	parseOpenNanaPromptPage,
	parsePromptLinksFromHtml,
	parsePromptSitemap,
	parseYouMindPromptPage,
} from "./prompt-library.parser";
import { archiveParsedPromptMediaToR2 } from "./prompt-library.media-hosting";
import {
	assertPromptSyncRobots,
	discoverPromptUrlsFromDocuments,
	parsePersistedPromptSyncProtocol,
	parsePromptDetailByProtocol,
	serializePromptSyncProtocol,
	type PromptSyncProtocol,
	type PromptSyncSource,
} from "./prompt-library.protocol";
import { getCrawlRun, importPromptSource } from "./prompt-library.repo";
import type { PromptLibraryCrawlRun } from "./prompt-library.types";

const PROMPT_SITEMAPS = [0, 1, 2, 3].map((index) => `https://youmind.com/sitemaps/prompts/sitemap/${index}.xml`);
const PROMPT_LANDING_PAGES = [
	"gpt-image-2-prompts",
	"nano-banana-pro-prompts",
	"seedream-4-dot-5-prompts",
	"gpt-image-1-5-prompts",
	"seedance-2-5-prompts",
	"seedance-2-0-prompts",
	"grok-imagine-prompts",
	"gemini-3-prompts",
].map((slug) => `https://youmind.com/zh-CN/${slug}`);
const activeRuns = new Map<string, Promise<void>>();
const scheduledRuns = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 6;
const FETCH_TIMEOUT_MS = 20_000;

export type PromptLibraryIncrementalCrawlReceipt = Readonly<{
	run: PromptLibraryCrawlRun;
	selectedCount: number;
	sourceCounts: Record<string, number>;
	alreadyAccepted: boolean;
}>;

class PublicPageResponseError extends Error {
	constructor(readonly status: number, readonly url: string) {
		super(`公开页面请求失败：HTTP ${status} ${url}`);
	}
}

class PublicPromptNotFoundError extends Error {}

class PublicRateLimitError extends Error {
	constructor(readonly retryAfterMs: number, url: string) {
		super(`公开站点触发限流，需等待 ${Math.ceil(retryAfterMs / 1_000)} 秒后恢复：${url}`);
	}
}

export function readRetryAfterMs(response: Response): number {
	const value = response.headers.get("retry-after")?.trim();
	if (!value) return 60_000;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, Math.ceil(seconds * 1_000) + 1_000);
	const resumeAt = Date.parse(value);
	return Number.isFinite(resumeAt) ? Math.max(1_000, resumeAt - Date.now() + 1_000) : 60_000;
}

async function fetchPublicText(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			Accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
			"User-Agent": "TapCanvasPromptCollector/1.0 (+public prompt library; respects robots.txt)",
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (response.status === 429) throw new PublicRateLimitError(readRetryAfterMs(response), url);
	if (!response.ok) throw new PublicPageResponseError(response.status, url);
	return response.text();
}

export function toLocaleNeutralPromptUrl(value: string): string {
	const url = new URL(value);
	url.pathname = url.pathname.replace(/^\/zh-CN(?=\/)/, "");
	url.search = "";
	url.hash = "";
	return url.toString();
}

async function fetchPreferredPromptPage(preferredUrl: string): Promise<{ html: string; sourceUrl: string }> {
	try {
		return { html: await fetchPublicText(preferredUrl), sourceUrl: preferredUrl };
	} catch (error) {
		const isMissingChinesePage = error instanceof PublicPageResponseError && error.status === 404 && new URL(preferredUrl).pathname.startsWith("/zh-CN/");
		if (!isMissingChinesePage) throw error;
		const sourceUrl = toLocaleNeutralPromptUrl(preferredUrl);
		try {
			return { html: await fetchPublicText(sourceUrl), sourceUrl };
		} catch (fallbackError) {
			if (fallbackError instanceof PublicPageResponseError && fallbackError.status === 404) {
				throw new PublicPromptNotFoundError(`站点地图目标在中文页与无语言公开页均已不存在：${preferredUrl}`);
			}
			throw fallbackError;
		}
	}
}

export function toChinesePromptUrl(value: string): string {
	const url = new URL(value);
	const parts = url.pathname.split("/").filter(Boolean);
	const first = parts[0] ?? "";
	const hasLocale = /^[a-z]{2}(?:-(?:[a-z]{2}|\d{3}))?$/i.test(first);
	if (!hasLocale) parts.unshift("zh-CN");
	else parts[0] = "zh-CN";
	url.pathname = `/${parts.join("/")}`;
	url.search = "";
	url.hash = "";
	return url.toString();
}

async function assertPublicCrawlPermission(): Promise<void> {
	const robots = await fetchPublicText("https://youmind.com/robots.txt");
	const sitemapAllowed = PROMPT_SITEMAPS.every((url) => robots.includes(url));
	const publicPagesAllowed = robots.split(/\r?\n/).some((line) => line.trim().toLocaleLowerCase("en-US") === "allow: /");
	if (!sitemapAllowed || !publicPagesAllowed) {
		throw new Error("YouMind robots.txt 已不再明确允许当前公开提示词采集路径，任务已停止");
	}
}

function stableSourcePromptId(sourceUrl: string): string {
	return sourceUrl.match(/-(\d+)(?:\/)?$/u)?.[1]
		?? new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1)
		?? sourceUrl;
}

async function discoverIncrementalSourceUrls(source: PromptSyncSource): Promise<string[]> {
	const [robots, documents] = await Promise.all([
		fetchPublicText(source.robotsUrl),
		Promise.all(source.discoveryUrls.map(async (url) => ({ url, body: await fetchPublicText(url) }))),
	]);
	assertPromptSyncRobots(source, robots);
	return discoverPromptUrlsFromDocuments(source, documents);
}

function roundRobinBoundedSources(
	values: Readonly<Record<string, readonly string[]>>,
	sources: readonly PromptSyncSource[],
	limit: number,
): Array<{ source: PromptSyncSource; sourceUrl: string }> {
	const offsets = new Map<string, number>();
	const selected: Array<{ source: PromptSyncSource; sourceUrl: string }> = [];
	while (selected.length < limit) {
		let advanced = false;
		for (const source of sources) {
			if (selected.length >= limit) break;
			const offset = offsets.get(source.id) ?? 0;
			const sourceUrl = values[source.id]?.[offset];
			if (!sourceUrl) continue;
			offsets.set(source.id, offset + 1);
			selected.push({ source, sourceUrl });
			advanced = true;
		}
		if (!advanced) break;
	}
	return selected;
}

function deterministicIncrementalRunId(input: Readonly<{
	actorUserId: string;
	projectId: string;
	flowId: string;
	executionId: string;
	idempotencyKey: string;
}>): string {
	const digest = createHash("sha256")
		.update([input.actorUserId, input.projectId, input.flowId, input.executionId, input.idempotencyKey].join("\u0000"), "utf8")
		.digest("hex")
		.slice(0, 32);
	return `prompt-sync-${digest}`;
}

export async function createPromptLibraryIncrementalCrawl(
	db: PrismaClient,
	input: Readonly<{
		actorUserId: string;
		projectId: string;
		flowId: string;
		executionId: string;
		idempotencyKey: string;
		protocol: PromptSyncProtocol;
	}>,
): Promise<PromptLibraryIncrementalCrawlReceipt> {
	const runId = deterministicIncrementalRunId(input);
	const existing = await getCrawlRun(db, runId);
	if (existing) {
		const sourceCounts = Object.fromEntries(input.protocol.sources.map((source) => [source.id, 0]));
		return { run: existing, selectedCount: existing.discoveredCount, sourceCounts, alreadyAccepted: true };
	}

	const discoveredEntries = await Promise.all(input.protocol.sources.map(async (source) => [
		source.id,
		await discoverIncrementalSourceUrls(source),
	] as const));
	const discovered = Object.fromEntries(discoveredEntries) as Record<string, string[]>;
	const allUrls = [...new Set(input.protocol.sources.flatMap((source) => discovered[source.id] ?? []))];
	const existingSources = allUrls.length > 0
		? await db.prompt_library_sources.findMany({
			where: { source_url: { in: allUrls } },
			select: { source_url: true },
		})
		: [];
	const importedUrls = new Set(existingSources.map((source) => source.source_url));
	const missing = Object.fromEntries(input.protocol.sources.map((source) => [
		source.id,
		(discovered[source.id] ?? []).filter((url) => !importedUrls.has(url)),
	]));
	const selected = roundRobinBoundedSources(missing, input.protocol.sources, input.protocol.batch.maxItems);
	const sourceCounts = Object.fromEntries(input.protocol.sources.map((source) => [
		source.id,
		selected.filter((item) => item.source.id === source.id).length,
	]));
	const now = new Date().toISOString();
	await db.$transaction(async (tx) => {
		await tx.prompt_library_crawl_runs.create({
			data: {
				id: runId,
				target_site: serializePromptSyncProtocol(input.protocol),
				status: selected.length > 0 ? "queued" : "succeeded",
				actor_user_id: input.actorUserId,
				discovered_count: selected.length,
				processed_count: 0,
				imported_count: 0,
				deduplicated_count: 0,
				skipped_count: 0,
				failed_count: 0,
				finished_at: selected.length > 0 ? null : now,
				created_at: now,
				updated_at: now,
			},
		});
		if (selected.length > 0) {
			await tx.prompt_library_crawl_targets.createMany({
				data: selected.map((item) => ({
					id: randomUUID(),
					run_id: runId,
					source_url: item.sourceUrl,
					source_prompt_id: stableSourcePromptId(item.sourceUrl),
					status: "pending",
					attempts: 0,
					created_at: now,
					updated_at: now,
				})),
			});
		}
	});
	const run = await getCrawlRun(db, runId);
	if (!run) throw new Error(`增量同步任务创建后无法回读：${runId}`);
	return { run, selectedCount: selected.length, sourceCounts, alreadyAccepted: false };
}

async function discoverTargets(db: PrismaClient, runId: string): Promise<number> {
	await assertPublicCrawlPermission();
	const [sitemapBodies, landingBodies] = await Promise.all([
		Promise.all(PROMPT_SITEMAPS.map(fetchPublicText)),
		Promise.all(PROMPT_LANDING_PAGES.map(fetchPublicText)),
	]);
	const sitemapUrls = sitemapBodies.flatMap(parsePromptSitemap);
	const landingUrls = landingBodies.flatMap((html, index) => parsePromptLinksFromHtml(html, PROMPT_LANDING_PAGES[index]));
	const urls = [...new Set([...sitemapUrls, ...landingUrls].map(toChinesePromptUrl))];
	const now = new Date().toISOString();
	await db.prompt_library_crawl_targets.createMany({
		data: urls.map((sourceUrl) => ({
			id: randomUUID(),
			run_id: runId,
			source_url: sourceUrl,
			source_prompt_id: sourceUrl.match(/-(\d+)(?:\/)?$/)?.[1] ?? sourceUrl,
			status: "pending",
			attempts: 0,
			created_at: now,
			updated_at: now,
		})),
		skipDuplicates: true,
	});
	const count = await db.prompt_library_crawl_targets.count({ where: { run_id: runId } });
	await db.prompt_library_crawl_runs.update({
		where: { id: runId },
		data: { discovered_count: count, updated_at: now },
	});
	return count;
}

function protocolSourceForUrl(protocol: PromptSyncProtocol, sourceUrl: string): PromptSyncSource {
	const url = new URL(sourceUrl);
	const source = protocol.sources.find((candidate) => {
		const origin = new URL(candidate.origin);
		return url.origin === origin.origin && url.pathname.startsWith(candidate.detailPathPrefix);
	});
	if (!source) throw new Error(`提示词目标不属于持久协议的任一来源：${sourceUrl}`);
	return source;
}

async function processTarget(
	env: WorkerEnv,
	runId: string,
	target: { id: string; source_url: string; attempts: number },
	protocol: PromptSyncProtocol | null,
): Promise<void> {
	const db = env.DB;
	const now = new Date().toISOString();
	await Promise.all([
		db.prompt_library_crawl_targets.update({
			where: { id: target.id },
			data: { status: "running", attempts: { increment: 1 }, error_message: null, updated_at: now },
		}),
		db.prompt_library_crawl_runs.update({ where: { id: runId }, data: { current_url: target.source_url, updated_at: now } }),
	]);
	try {
		const hostname = new URL(target.source_url).hostname;
		const page = protocol
			? { html: await fetchPublicText(target.source_url), sourceUrl: target.source_url }
			: hostname === "opennana.com"
				? { html: await fetchPublicText(target.source_url), sourceUrl: target.source_url }
				: await fetchPreferredPromptPage(target.source_url);
		const parsed = protocol
			? await parsePromptDetailByProtocol(env, protocolSourceForUrl(protocol, page.sourceUrl), page)
			: hostname === "opennana.com"
				? parseOpenNanaPromptPage(page.html, page.sourceUrl)
				: parseYouMindPromptPage(page.html, page.sourceUrl);
		if (!parsed) {
			await db.$transaction([
				db.prompt_library_crawl_targets.update({ where: { id: target.id }, data: { status: "skipped", updated_at: new Date().toISOString() } }),
				db.prompt_library_crawl_runs.update({ where: { id: runId }, data: { processed_count: { increment: 1 }, skipped_count: { increment: 1 }, updated_at: new Date().toISOString() } }),
			]);
			return;
		}
		const archivedMedia = await archiveParsedPromptMediaToR2(env, parsed.media);
		const imported = await importPromptSource(db, { ...parsed, media: archivedMedia });
		await db.$transaction([
			db.prompt_library_crawl_targets.update({
				where: { id: target.id },
				data: { status: "succeeded", entry_id: imported.entryId, error_message: null, updated_at: new Date().toISOString() },
			}),
			db.prompt_library_crawl_runs.update({
				where: { id: runId },
				data: {
					processed_count: { increment: 1 },
					...(imported.deduplicated ? { deduplicated_count: { increment: 1 } } : { imported_count: { increment: 1 } }),
					updated_at: new Date().toISOString(),
				},
			}),
		]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (error instanceof PublicRateLimitError) {
			await db.prompt_library_crawl_targets.update({
				where: { id: target.id },
				data: { status: "pending", attempts: { decrement: 1 }, error_message: message.slice(0, 2_000), updated_at: new Date().toISOString() },
			});
			throw error;
		}
		if (error instanceof PublicPromptNotFoundError) {
			await db.$transaction([
				db.prompt_library_crawl_targets.update({ where: { id: target.id }, data: { status: "skipped", error_message: message.slice(0, 2_000), updated_at: new Date().toISOString() } }),
				db.prompt_library_crawl_runs.update({ where: { id: runId }, data: { processed_count: { increment: 1 }, skipped_count: { increment: 1 }, updated_at: new Date().toISOString() } }),
			]);
			return;
		}
		const attemptsAfterThisRun = target.attempts + 1;
		await db.prompt_library_crawl_targets.update({
			where: { id: target.id },
			data: { status: "failed", error_message: message.slice(0, 2_000), updated_at: new Date().toISOString() },
		});
		if (attemptsAfterThisRun >= MAX_ATTEMPTS) {
			await db.prompt_library_crawl_runs.update({
				where: { id: runId },
				data: { processed_count: { increment: 1 }, failed_count: { increment: 1 }, error_message: message.slice(0, 2_000), updated_at: new Date().toISOString() },
			});
		}
	}
}

function agentsBridgeBaseUrl(env: WorkerEnv): string {
	const value = String(env.AGENTS_BRIDGE_BASE_URL ?? "").trim().replace(/\/+$/u, "");
	if (!value) throw new Error("提示词入库完成，但向量同步缺少 AGENTS_BRIDGE_BASE_URL");
	return value;
}

async function syncPromptExampleKnowledge(env: WorkerEnv): Promise<void> {
	const response = await fetch(`${agentsBridgeBaseUrl(env)}/admin/knowledge/prompt-examples/sync`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(String(env.AGENTS_BRIDGE_TOKEN ?? "").trim()
				? { Authorization: `Bearer ${String(env.AGENTS_BRIDGE_TOKEN).trim()}` }
				: {}),
		},
		body: "{}",
		signal: AbortSignal.timeout(120_000),
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(`提示词入库完成，但向量同步失败：HTTP ${response.status}${body.trim() ? ` ${body.slice(0, 500)}` : ""}`);
	}
}

async function executeRun(env: WorkerEnv, runId: string): Promise<number | null> {
	const db = env.DB;
	const persistedRun = await db.prompt_library_crawl_runs.findUnique({ where: { id: runId }, select: { target_site: true } });
	if (!persistedRun) throw new Error(`提示词采集任务不存在：${runId}`);
	const protocol = parsePersistedPromptSyncProtocol(persistedRun.target_site);
	const startedAt = new Date().toISOString();
	await db.prompt_library_crawl_runs.update({
		where: { id: runId },
		data: { status: "running", started_at: startedAt, finished_at: null, error_message: null, updated_at: startedAt },
	});
	await db.prompt_library_crawl_targets.updateMany({ where: { run_id: runId, status: "running" }, data: { status: "pending", updated_at: startedAt } });
	try {
		const discovered = await db.prompt_library_crawl_targets.count({ where: { run_id: runId } });
		if (discovered === 0 && !protocol) await discoverTargets(db, runId);
		while (true) {
			const targets = await db.prompt_library_crawl_targets.findMany({
				where: { run_id: runId, status: { in: ["pending", "failed"] }, attempts: { lt: MAX_ATTEMPTS } },
				orderBy: { created_at: "asc" },
				take: BATCH_SIZE,
				select: { id: true, source_url: true, attempts: true },
			});
			if (targets.length === 0) break;
			const results = await Promise.allSettled(targets.map((target) => processTarget(env, runId, target, protocol)));
			const rateLimit = results.find((result): result is PromiseRejectedResult => result.status === "rejected" && result.reason instanceof PublicRateLimitError);
			if (rateLimit) throw rateLimit.reason;
			const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
			if (rejection) throw rejection.reason;
		}
		const failedCount = await db.prompt_library_crawl_targets.count({ where: { run_id: runId, status: "failed" } });
		const finishedAt = new Date().toISOString();
		const completedRun = await db.prompt_library_crawl_runs.update({
			where: { id: runId },
			data: {
				status: failedCount > 0 ? "partial" : "succeeded",
				failed_count: failedCount,
				current_url: null,
				finished_at: finishedAt,
				updated_at: finishedAt,
			},
		});
		if (completedRun.imported_count > 0) {
			try {
				await syncPromptExampleKnowledge(env);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				await db.prompt_library_crawl_runs.update({
					where: { id: runId },
					data: { status: "partial", error_message: message.slice(0, 2_000), updated_at: new Date().toISOString() },
				});
			}
		}
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (error instanceof PublicRateLimitError) {
			const now = new Date().toISOString();
			await db.prompt_library_crawl_runs.update({
				where: { id: runId },
				data: { status: "queued", error_message: message.slice(0, 2_000), current_url: null, finished_at: null, updated_at: now },
			});
			return error.retryAfterMs;
		}
		const finishedAt = new Date().toISOString();
		await db.prompt_library_crawl_runs.update({
			where: { id: runId },
			data: { status: "failed", error_message: message.slice(0, 2_000), current_url: null, finished_at: finishedAt, updated_at: finishedAt },
		});
		throw error;
	}
}

export function kickPromptLibraryCrawl(env: WorkerEnv, runId: string): Promise<void> {
	const active = activeRuns.get(runId);
	if (active) return active;
	const scheduled = scheduledRuns.get(runId);
	if (scheduled) {
		clearTimeout(scheduled);
		scheduledRuns.delete(runId);
	}
	const work = executeRun(env, runId)
		.then((retryAfterMs) => {
			if (retryAfterMs === null) return;
			const timer = setTimeout(() => {
				scheduledRuns.delete(runId);
				void kickPromptLibraryCrawl(env, runId).catch((error: unknown) => {
					console.error(`[prompt-library] scheduled crawl resume failed: ${runId}`, error);
				});
			}, retryAfterMs);
			scheduledRuns.set(runId, timer);
		})
		.finally(() => activeRuns.delete(runId));
	activeRuns.set(runId, work);
	return work;
}

export async function createPromptLibraryCrawl(db: PrismaClient, actorUserId: string | null): Promise<PromptLibraryCrawlRun> {
	const active = await db.prompt_library_crawl_runs.findFirst({ where: { status: { in: ["queued", "running"] } }, orderBy: { created_at: "desc" } });
	if (active) return (await getCrawlRun(db, active.id)) as PromptLibraryCrawlRun;
	const now = new Date().toISOString();
	const row = await db.prompt_library_crawl_runs.create({
		data: {
			id: randomUUID(), target_site: "youmind.com", status: "queued", actor_user_id: actorUserId,
			created_at: now, updated_at: now,
		},
	});
	return (await getCrawlRun(db, row.id)) as PromptLibraryCrawlRun;
}

export async function resumePromptLibraryCrawl(db: PrismaClient, runId: string): Promise<PromptLibraryCrawlRun | null> {
	const run = await db.prompt_library_crawl_runs.findUnique({ where: { id: runId } });
	if (!run) return null;
	const now = new Date().toISOString();
	await db.prompt_library_crawl_targets.updateMany({
		where: { run_id: runId, status: "failed" },
		data: { status: "pending", attempts: 0, error_message: null, updated_at: now },
	});
	const [succeededCount, skippedCount] = await Promise.all([
		db.prompt_library_crawl_targets.count({ where: { run_id: runId, status: "succeeded" } }),
		db.prompt_library_crawl_targets.count({ where: { run_id: runId, status: "skipped" } }),
	]);
	await db.prompt_library_crawl_runs.update({
		where: { id: runId },
		data: {
			status: "queued",
			processed_count: succeededCount + skippedCount,
			skipped_count: skippedCount,
			failed_count: 0,
			error_message: null,
			finished_at: null,
			updated_at: now,
		},
	});
	return getCrawlRun(db, runId);
}

export async function resumePersistedPromptLibraryCrawls(env: WorkerEnv): Promise<number> {
	const runs = await env.DB.prompt_library_crawl_runs.findMany({
		where: { status: { in: ["queued", "running"] } },
		orderBy: { created_at: "asc" },
		select: { id: true },
	});
	await Promise.all(runs.map((run) => kickPromptLibraryCrawl(env, run.id)));
	return runs.length;
}

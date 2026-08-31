import { z } from "zod";
import type { WorkerEnv } from "../../types";
import { runLocalWorkflowJavascript } from "../execution/execution.javascript-runner";
import {
	parseOpenNanaPromptPage,
	parseYouMindPromptPage,
} from "./prompt-library.parser";
import type { ParsedPromptSource } from "./prompt-library.types";

const HttpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", "URL must use HTTPS");

const PromptSyncSourceSchema = z.object({
	id: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/u),
	displayName: z.string().trim().min(1).max(120),
	origin: HttpsUrlSchema,
	robotsUrl: HttpsUrlSchema,
	discoveryUrls: z.array(HttpsUrlSchema).min(1).max(4),
	detailPathPrefix: z.string().trim().min(1).max(240).refine((value) => value.startsWith("/"), "detailPathPrefix must start with /") ,
	detailParser: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("builtin"), adapter: z.enum(["youmind-next-flight-v1", "opennana-jsonld-flight-v1"]) }).strict(),
		z.object({ kind: z.literal("javascript"), code: z.string().min(1).max(50_000) }).strict(),
	]),
}).strict();

export const PromptSyncProtocolSchema = z.object({
	protocolVersion: z.literal("tapcanvas.prompt-sync/v1"),
	batch: z.object({
		maxItems: z.number().int().min(1).max(50),
		strategy: z.literal("round_robin"),
	}).strict(),
	sources: z.array(PromptSyncSourceSchema).min(1).max(10),
}).strict().superRefine((protocol, context) => {
	const sourceIds = protocol.sources.map((source) => source.id);
	if (new Set(sourceIds).size !== sourceIds.length) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources"], message: "source ids must be unique" });
	}
	for (const [index, source] of protocol.sources.entries()) {
		const origin = new URL(source.origin);
		for (const [field, value] of [
			["robotsUrl", source.robotsUrl],
			...source.discoveryUrls.map((url, discoveryIndex) => [`discoveryUrls.${discoveryIndex}`, url] as const),
		] as const) {
			if (new URL(value).origin !== origin.origin) {
				context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, field], message: "source URLs must share the declared origin" });
			}
		}
		if (new URL(source.robotsUrl).pathname !== "/robots.txt") {
			context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, "robotsUrl"], message: "robotsUrl must point to /robots.txt" });
		}
	}
});

export type PromptSyncProtocol = z.infer<typeof PromptSyncProtocolSchema>;
export type PromptSyncSource = PromptSyncProtocol["sources"][number];

export function serializePromptSyncProtocol(protocol: PromptSyncProtocol): string {
	return `prompt-sync-protocol:${JSON.stringify(protocol)}`;
}

export function parsePersistedPromptSyncProtocol(value: string): PromptSyncProtocol | null {
	const prefix = "prompt-sync-protocol:";
	if (!value.startsWith(prefix)) return null;
	return PromptSyncProtocolSchema.parse(JSON.parse(value.slice(prefix.length)) as unknown);
}

function robotsRules(value: string): { allowsRoot: boolean; disallowed: string[] } {
	const lines = value.split(/\r?\n/u).map((line) => line.split("#", 1)[0]?.trim() ?? "");
	return {
		allowsRoot: lines.some((line) => line.toLocaleLowerCase("en-US") === "allow: /"),
		disallowed: lines.flatMap((line) => {
			const match = /^disallow:\s*(\S+)/iu.exec(line);
			return match?.[1] ? [match[1]] : [];
		}),
	};
}

export function assertPromptSyncRobots(source: PromptSyncSource, robots: string): void {
	const rules = robotsRules(robots);
	if (!rules.allowsRoot) throw new Error(`${source.displayName} robots.txt 未明确允许公开页面采集`);
	const paths = [source.detailPathPrefix, ...source.discoveryUrls.map((value) => new URL(value).pathname)];
	const forbidden = paths.find((path) => rules.disallowed.some((prefix) => prefix !== "/" && path.startsWith(prefix)));
	if (forbidden) throw new Error(`${source.displayName} robots.txt 禁止协议路径：${forbidden}`);
}

export function discoverPromptUrlsFromDocuments(
	source: PromptSyncSource,
	documents: readonly Readonly<{ url: string; body: string }>[],
): string[] {
	const urls: string[] = [];
	for (const document of documents) {
		const candidates = [
			...document.body.matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/giu),
			...document.body.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/giu),
		];
		for (const candidate of candidates) {
			const href = candidate[1]?.trim();
			if (!href) continue;
			try {
				const url = new URL(href, document.url);
				url.search = "";
				url.hash = "";
				if (url.origin !== new URL(source.origin).origin || !url.pathname.startsWith(source.detailPathPrefix)) continue;
				if (url.pathname === source.detailPathPrefix || url.pathname === `${source.detailPathPrefix}/`) continue;
				urls.push(url.toString());
			} catch {
				// Invalid public links are ignored; protocol scope remains exact.
			}
		}
	}
	return [...new Set(urls)];
}

function ParsedPromptSourceSchema(source: PromptSyncSource) {
	return z.object({
		sourcePromptId: z.union([z.string(), z.number()]).transform(String),
		sourceUrl: HttpsUrlSchema,
		title: z.string().trim().min(1).max(500),
		description: z.string().nullable(),
		promptText: z.string().trim().min(1),
		promptTextOriginal: z.string().trim().min(1),
		mediaType: z.enum(["image", "video"]),
		media: z.array(z.object({
			kind: z.enum(["image", "video"]),
			url: HttpsUrlSchema,
			thumbnailUrl: HttpsUrlSchema.nullable(),
			width: z.number().int().positive().nullable(),
			height: z.number().int().positive().nullable(),
		}).strict()).min(1).max(20),
		sourceAuthor: z.string().nullable(),
		sourceAuthorUrl: HttpsUrlSchema.nullable(),
		originalLanguage: z.string().nullable(),
		modelSlug: z.string().trim().min(1).max(120),
		modelName: z.string().trim().min(1).max(160),
		originalSourceUrl: HttpsUrlSchema.nullable(),
		categories: z.array(z.string().trim().min(1).max(120)).max(30),
		publishedAt: z.string().nullable(),
		metrics: z.object({
			likes: z.number().int().nonnegative(), views: z.number().int().nonnegative(),
			shares: z.number().int().nonnegative(), comments: z.number().int().nonnegative(),
			bookmarks: z.number().int().nonnegative(), quotes: z.number().int().nonnegative(),
		}).strict(),
	}).strict().superRefine((value, context) => {
		const url = new URL(value.sourceUrl);
		if (url.origin !== new URL(source.origin).origin || !url.pathname.startsWith(source.detailPathPrefix)) {
			context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceUrl"], message: "parsed source URL escaped protocol scope" });
		}
		if (value.mediaType === "video" && !value.media.some((item) => item.kind === "video")) {
			context.addIssue({ code: z.ZodIssueCode.custom, path: ["media"], message: "video entry requires a video output" });
		}
	});
}

export async function parsePromptDetailByProtocol(
	env: WorkerEnv,
	source: PromptSyncSource,
	input: Readonly<{ html: string; sourceUrl: string }>,
): Promise<ParsedPromptSource | null> {
	const raw = source.detailParser.kind === "builtin"
		? source.detailParser.adapter === "youmind-next-flight-v1"
			? parseYouMindPromptPage(input.html, input.sourceUrl)
			: parseOpenNanaPromptPage(input.html, input.sourceUrl)
		: (await runLocalWorkflowJavascript(env, { code: source.detailParser.code, input })).output;
	if (raw === null) return null;
	return ParsedPromptSourceSchema(source).parse(raw) as ParsedPromptSource;
}

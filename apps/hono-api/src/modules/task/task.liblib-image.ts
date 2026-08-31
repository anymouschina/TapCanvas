import { randomUUID } from "crypto";
import { pollUntilSettled } from "./task.polling-core";
import type { TaskResultSchema } from "./task.schemas";
import type { z } from "zod";

type TaskResult = z.infer<typeof TaskResultSchema>;

// Liblib image generation status codes
// 1 = queued/wait, 2 = processing, 3 = succeeded, 5 = failed
const LIBLIB_STATUS_DONE = 3;
const LIBLIB_STATUS_FAILED = 5;
const LIBLIB_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const LIBLIB_POLL_INTERVAL_MS = 4_000;

export type LiblibScene =
	| "normal"
	| "720_panoramic"
	| "3d_scene"
	| "game_background";

export type LiblibModeType = "text2image" | "image2image";

export type LiblibImageInput = {
	prompt: string;
	model?: string;
	count?: number;
	scene?: LiblibScene;
	modeType?: LiblibModeType;
	quality?: "fast" | "medium" | "high";
	ratio?: string;
	imageList?: string[];
	nodeId?: string;
	projectId?: string;
};

type LiblibApiContext = {
	baseUrl: string;
	token: string;
};

function buildLiblibHeaders(token: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Accept: "application/json",
		token,
	};
}

function buildLiblibCreateBody(input: LiblibImageInput): object {
	const model = (input.model || "lib-image-2").trim();
	const generateUuid = randomUUID();
	return {
		params: {
			prompt: input.prompt || "",
			model,
			count: input.count ?? 1,
			scene: input.scene ?? "normal",
			modeType: input.modeType ?? "text2image",
			quality: input.quality ?? "medium",
			ratio: input.ratio ?? "1:1",
			sequential: 1,
			textList: [],
			imageList: Array.isArray(input.imageList) ? input.imageList : [],
			videoList: [],
			audioList: [],
			infiniteSwitch: 0,
		},
		metadata: {
			node_id: input.nodeId ?? "",
			project_id: input.projectId ?? "",
		},
		provider: "lib-image",
		model,
		taskType: "image",
		requestId: generateUuid,
	};
}

async function callLiblibApi(
	ctx: LiblibApiContext,
	path: string,
	body: object,
): Promise<unknown> {
	const url = `${ctx.baseUrl.replace(/\/+$/, "")}${path}`;
	const res = await fetch(url, {
		method: "POST",
		headers: buildLiblibHeaders(ctx.token),
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		let msg = `liblib API error: ${res.status}`;
		try {
			const errData: any = await res.json();
			msg = errData?.msg || errData?.message || msg;
		} catch {
			// ignore
		}
		throw new Error(msg);
	}
	return res.json();
}

function extractLiblibGenerateUuid(data: unknown): string {
	if (
		data &&
		typeof data === "object" &&
		"data" in data &&
		typeof (data as any).data === "object" &&
		(data as any).data !== null
	) {
		const inner = (data as any).data;
		const uuid =
			typeof inner.generateUuid === "string"
				? inner.generateUuid.trim()
				: typeof inner.requestId === "string"
					? inner.requestId.trim()
					: "";
		if (uuid) return uuid;
	}
	throw new Error("liblib 任务创建成功但未返回 generateUuid");
}

function extractLiblibStatus(pollData: unknown): {
	status: number;
	images: Array<{ imageUrl: string; width?: number; height?: number }>;
} {
	const d: any = pollData;
	const inner = d?.data ?? d;
	const status = Number(inner?.status ?? 0);
	const rawImages: any[] =
		Array.isArray(inner?.images)
			? inner.images
			: Array.isArray(inner?.result?.images)
				? inner.result.images
				: [];
	const images = rawImages
		.map((img: any) => ({
			imageUrl: typeof img?.imageUrl === "string" ? img.imageUrl.trim() : "",
			width: typeof img?.width === "number" ? img.width : undefined,
			height: typeof img?.height === "number" ? img.height : undefined,
		}))
		.filter((img) => img.imageUrl);
	return { status, images };
}

export async function createLiblibImageTask(
	ctx: LiblibApiContext,
	input: LiblibImageInput,
): Promise<{ generateUuid: string }> {
	const body = buildLiblibCreateBody(input);
	const resp = await callLiblibApi(
		ctx,
		"/api/task/generation/create",
		body,
	);
	const generateUuid = extractLiblibGenerateUuid(resp);
	return { generateUuid };
}

export async function pollLiblibImageTask(
	ctx: LiblibApiContext,
	generateUuid: string,
): Promise<TaskResult> {
	const poll = await pollUntilSettled({
		timeoutMs: LIBLIB_POLL_TIMEOUT_MS,
		intervalMs: LIBLIB_POLL_INTERVAL_MS,
		pollOnce: async () => {
			return callLiblibApi(ctx, "/api/task/generation/detail", {
				generateUuid,
			});
		},
		evaluate: (data) => {
			const { status } = extractLiblibStatus(data);
			if (status === LIBLIB_STATUS_DONE) return "success";
			if (status === LIBLIB_STATUS_FAILED) return "failure";
			return "continue";
		},
	});

	if (poll.state === "timeout") {
		return buildLiblibFailureResult(generateUuid, "liblib 任务轮询超时");
	}

	const { status, images } = extractLiblibStatus(poll.value);
	if (status === LIBLIB_STATUS_FAILED || poll.state === "failure") {
		const errMsg =
			(poll.value as any)?.data?.failMsg ||
			(poll.value as any)?.msg ||
			"liblib 任务失败";
		return buildLiblibFailureResult(generateUuid, errMsg);
	}

	if (!images.length) {
		return buildLiblibFailureResult(generateUuid, "liblib 未返回图片");
	}

	return {
		id: generateUuid,
		kind: "text_to_image",
		status: "succeeded",
		assets: images.map((img) => ({
			type: "image" as const,
			url: img.imageUrl,
			thumbnailUrl: null,
			assetId: null,
			assetRefId: null,
			assetName: null,
		})),
		raw: { generateUuid, images, liblibStatus: status },
	};
}

function buildLiblibFailureResult(
	generateUuid: string,
	message: string,
): TaskResult {
	return {
		id: generateUuid,
		kind: "text_to_image",
		status: "failed",
		assets: [],
		raw: { generateUuid, error: message },
	};
}

export function resolveLiblibApiContext(
	token: string,
	baseUrlHint?: string | null,
): LiblibApiContext {
	const baseUrl = (baseUrlHint || "https://api.liblib.tv").replace(/\/+$/, "");
	return { baseUrl, token };
}

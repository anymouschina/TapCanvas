import { randomUUID } from "node:crypto";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { resolveTeamCreditsCostForTask } from "../billing/billing.service";
import {
	requireSufficientTeamCredits,
	settleTeamCreditsOnSuccess,
	releaseTeamCreditsOnFailure,
} from "../team/team.service";

function readNewApiRelay(
	c: AppContext,
): { baseUrl: string; token: string } | null {
	const readEnv = (
		key: "NEW_API_INTERNAL_BASE_URL" | "NEW_API_INTERNAL_TOKEN",
	): string => {
		const fromEnv =
			typeof c.env[key] === "string" ? (c.env[key] as string) : "";
		if (fromEnv.trim()) return fromEnv.trim();
		const fromProcess =
			typeof (globalThis as any)?.process?.env?.[key] === "string"
				? String((globalThis as any).process.env[key])
				: "";
		return fromProcess.trim();
	};
	const baseUrl = readEnv("NEW_API_INTERNAL_BASE_URL").replace(/\/+$/, "");
	const token = readEnv("NEW_API_INTERNAL_TOKEN");
	if (!baseUrl || !token) return null;
	return { baseUrl, token };
}

type Reservation = Awaited<ReturnType<typeof requireSufficientTeamCredits>>;

async function settleReservation(
	c: AppContext,
	userId: string,
	reservation: Reservation,
	success: boolean,
): Promise<void> {
	if (!reservation) return;
	try {
		if (success) {
			await settleTeamCreditsOnSuccess(c, userId, {
				taskId: reservation.reservationTaskId,
				taskKind: reservation.taskKind,
				amount: reservation.amount,
				vendor: reservation.vendor,
				modelKey: reservation.modelKey ?? null,
				specKey: reservation.specKey ?? null,
			});
		} else {
			await releaseTeamCreditsOnFailure(c, userId, {
				taskId: reservation.reservationTaskId,
				taskKind: reservation.taskKind,
				vendor: reservation.vendor,
				modelKey: reservation.modelKey ?? null,
				specKey: reservation.specKey ?? null,
			});
		}
	} catch {
		// non-blocking; don't let billing errors break the response
	}
}

export async function handleAgentsLlmVideoUnderstand(
	c: AppContext,
): Promise<Response> {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const relay = readNewApiRelay(c);
	if (!relay) {
		throw new AppError(
			"NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置",
			{ status: 500, code: "new_api_not_configured" },
		);
	}

	let body: { model?: unknown; videoUrl?: unknown; userPrompt?: unknown; fps?: unknown };
	try {
		body = (await c.req.json()) as typeof body;
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const model = typeof body.model === "string" ? body.model.trim() : "";
	const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
	const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt.trim() : "";
	const fps = typeof body.fps === "number" && body.fps > 0 ? body.fps : 1;

	if (!model) return c.json({ error: "model is required" }, 400);
	if (!videoUrl) return c.json({ error: "videoUrl is required" }, 400);

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: "chat",
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: "chat",
		vendor: "new_api",
		modelKey: model,
	});
	const proxyTaskId = randomUUID();
	if (reservation) reservation.reservationTaskId = proxyTaskId;

	const targetUrl = `${relay.baseUrl}/v1/responses`;
	const hardTimeout = AbortSignal.timeout(90_000);
	const clientSignal = (c.req.raw.signal as AbortSignal | undefined) ?? null;
	const fetchSignal = clientSignal ? AbortSignal.any([clientSignal, hardTimeout]) : hardTimeout;

	const requestBody = {
		model,
		input: [
			{
				type: "message",
				role: "user",
				content: [
					{ type: "input_video", video_url: videoUrl, fps },
					...(userPrompt ? [{ type: "input_text", text: userPrompt }] : []),
				],
			},
		],
	};

	let upstreamRes: Response;
	try {
		upstreamRes = await fetchWithHttpDebugLog(
			c,
			targetUrl,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${relay.token}`,
				},
				body: JSON.stringify(requestBody),
				signal: fetchSignal,
			},
			{ tag: "agents-video-understand" },
		);
	} catch (err) {
		await settleReservation(c, userId, reservation, false);
		throw err;
	}

	if (!upstreamRes.ok) {
		await settleReservation(c, userId, reservation, false);
		const errorText = await upstreamRes.text().catch(() => "upstream error");
		return new Response(errorText, {
			status: upstreamRes.status,
			headers: { "Content-Type": upstreamRes.headers.get("Content-Type") ?? "application/json" },
		});
	}

	const responseText = await upstreamRes.text();
	await settleReservation(c, userId, reservation, true);

	// Extract text from Responses API output array
	let text = "";
	try {
		const data: any = JSON.parse(responseText);
		const output: any[] = Array.isArray(data?.output) ? data.output : [];
		for (const item of output) {
			if (item?.type === "message") {
				const content: any[] = Array.isArray(item?.content) ? item.content : [];
				for (const block of content) {
					if (block?.type === "output_text" && typeof block?.text === "string") {
						text += block.text;
					}
				}
			}
		}
	} catch {
		text = responseText;
	}

	return c.json({ text });
}

export async function handleAgentsLlmChatCompletions(
	c: AppContext,
): Promise<Response> {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const relay = readNewApiRelay(c);
	if (!relay) {
		throw new AppError(
			"NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置",
			{ status: 500, code: "new_api_not_configured" },
		);
	}

	let body: Record<string, unknown>;
	try {
		body = (await c.req.json()) as Record<string, unknown>;
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const model = typeof body.model === "string" ? body.model.trim() : "";
	const isStream = body.stream === true;

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: "chat",
		modelKey: model || null,
	});

	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: "chat",
		vendor: "new_api",
		modelKey: model || null,
	});

	// Bind reservation to a stable task ID so settlement can find it later.
	const proxyTaskId = randomUUID();
	if (reservation) {
		reservation.reservationTaskId = proxyTaskId;
	}

	const targetUrl = `${relay.baseUrl}/v1/chat/completions`;

	// Propagate client disconnect signal + hard fallback timeout so hono-api
	// never hangs indefinitely when new-api stalls or doesn't respond.
	const clientSignal = (c.req.raw.signal as AbortSignal | undefined) ?? null;
	// Non-stream: 90 s. Stream: 15 min (LLM can legitimately take long, but not forever).
	const hardTimeout = AbortSignal.timeout(isStream ? 15 * 60_000 : 90_000);
	const fetchSignal = clientSignal
		? AbortSignal.any([clientSignal, hardTimeout])
		: hardTimeout;

	let upstreamRes: Response;
	try {
		upstreamRes = await fetchWithHttpDebugLog(
			c,
			targetUrl,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${relay.token}`,
					Accept: isStream ? "text/event-stream" : "application/json",
				},
				body: JSON.stringify(body),
				signal: fetchSignal,
			},
			{ tag: "agents-llm-proxy" },
		);
	} catch (err) {
		await settleReservation(c, userId, reservation, false);
		throw err;
	}

	if (!upstreamRes.ok) {
		await settleReservation(c, userId, reservation, false);
		const errorText = await upstreamRes.text().catch(() => "upstream error");
		return new Response(errorText, {
			status: upstreamRes.status,
			headers: {
				"Content-Type":
					upstreamRes.headers.get("Content-Type") ?? "application/json",
			},
		});
	}

	if (!isStream || !upstreamRes.body) {
		const responseText = await upstreamRes.text();
		await settleReservation(c, userId, reservation, true);
		return new Response(responseText, {
			status: upstreamRes.status,
			headers: {
				"Content-Type":
					upstreamRes.headers.get("Content-Type") ?? "application/json",
			},
		});
	}

	// Streaming: pipe through; settle credits when stream ends.
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	const reader = upstreamRes.body.getReader();

	(async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				await writer.write(value);
			}
			await writer.close();
			await settleReservation(c, userId, reservation, true);
		} catch {
			try {
				await writer.abort();
			} catch {
				// ignore
			}
			await settleReservation(c, userId, reservation, false);
		}
	})();

	return new Response(readable, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

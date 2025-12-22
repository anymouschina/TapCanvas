import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { getFlowForOwner } from "../flow/flow.repo";
import { createFlowVersion } from "../flow/flow.repo";
import {
	createExecution,
	getExecutionForOwner,
	listExecutionEvents,
	listExecutionsForOwnerFlow,
	listNodeRunsForExecutionOwner,
	mapExecutionEventRow,
	mapExecutionRow,
	mapNodeRunRow,
} from "./execution.repo";
import { RunFlowExecutionRequestSchema } from "./execution.schemas";

export const executionRouter = new Hono<AppEnv>();

executionRouter.use("*", authMiddleware);

executionRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const flowId = (c.req.query("flowId") || "").trim();
	if (!flowId) return c.json({ error: "flowId is required" }, 400);
	const limit = Number(c.req.query("limit") || 30) || 30;
	const rows = await listExecutionsForOwnerFlow(c.env.DB, {
		ownerId: userId,
		flowId,
		limit,
	});
	return c.json(rows.map(mapExecutionRow));
});

executionRouter.post("/run", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RunFlowExecutionRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const flowId = parsed.data.flowId;
	const flow = await getFlowForOwner(c.env.DB, flowId, userId);
	if (!flow) return c.json({ error: "Flow not found" }, 404);

	const nowIso = new Date().toISOString();
	const flowVersionId = crypto.randomUUID();
	await createFlowVersion(c.env.DB, {
		id: flowVersionId,
		flowId: flow.id,
		name: flow.name,
		data: flow.data,
		userId,
		nowIso,
	});

	const executionId = crypto.randomUUID();
	const concurrency = Math.max(
		1,
		Math.min(8, Math.floor(parsed.data.concurrency ?? 1)),
	);
	await createExecution(c.env.DB, {
		id: executionId,
		flowId: flow.id,
		flowVersionId,
		ownerId: userId,
		concurrency,
		trigger: parsed.data.trigger ?? "manual",
		nowIso,
	});

	// Start execution via Durable Object scheduler (fail-fast, join-barrier).
	try {
		const ns = (c.env as any).EXECUTION_DO as DurableObjectNamespace;
		if (!ns) {
			return c.json(
				{ error: "EXECUTION_DO binding missing in Worker env" },
				500,
			);
		}
		const id = ns.idFromName(executionId);
		const stub = ns.get(id);
		await stub.fetch("https://do/start", { method: "POST" });
	} catch (err: any) {
		return c.json(
			{ error: err?.message || "Failed to start execution" },
			500,
		);
	}

	const created = await getExecutionForOwner(c.env.DB, executionId, userId);
	if (!created) return c.json({ error: "Failed to load execution" }, 500);
	return c.json(mapExecutionRow(created));
});

executionRouter.get("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const row = await getExecutionForOwner(c.env.DB, id, userId);
	if (!row) return c.json({ error: "Execution not found" }, 404);
	return c.json(mapExecutionRow(row));
});

executionRouter.get("/:id/node-runs", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const rows = await listNodeRunsForExecutionOwner(c.env.DB, {
		ownerId: userId,
		executionId: id,
	});
	return c.json(rows.map(mapNodeRunRow));
});

// SSE stream for execution logs (D1-backed; resumable via `?after=<seq>`)
executionRouter.get("/:id/events", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const executionId = c.req.param("id");
	const row = await getExecutionForOwner(c.env.DB, executionId, userId);
	if (!row) return c.json({ error: "Execution not found" }, 404);

	const after = Number(c.req.query("after") || 0) || 0;
	let cursor = Math.max(0, Math.floor(after));

	return streamSSE(c, async (stream) => {
		const HEARTBEAT_MS = 15_000;
		let closed = false;
		const abortSignal = c.req.raw.signal as AbortSignal;
		abortSignal.addEventListener("abort", () => {
			closed = true;
		});

		const sleep = (ms: number) =>
			new Promise<void>((resolve) => setTimeout(resolve, ms));

		try {
			await stream.writeSSE({
				event: "init",
				data: JSON.stringify({
					executionId,
					after: cursor,
					status: row.status,
				}),
			});

			let lastPingAt = Date.now();
			while (!closed) {
				const rows = await listExecutionEvents(c.env.DB, {
					executionId,
					afterSeq: cursor,
					limit: 50,
				});
				if (rows.length) {
					for (const r of rows) {
						const dto = mapExecutionEventRow(r);
						cursor = Math.max(cursor, dto.seq);
						await stream.writeSSE({
							event: dto.eventType,
							data: JSON.stringify(dto),
						});
					}
					lastPingAt = Date.now();
					continue;
				}
				if (Date.now() - lastPingAt > HEARTBEAT_MS) {
					await stream.writeSSE({
						event: "ping",
						data: JSON.stringify({ type: "ping", t: Date.now() }),
					});
					lastPingAt = Date.now();
				}
				await sleep(800);
			}
		} finally {
			closed = true;
		}
	});
});

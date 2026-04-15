import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, WorkerEnv } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { runCreditTaskFinalizer } from "../task/task.credit-finalizer";

export const internalRouter = new Hono<AppEnv>();

function readBearerToken(authorization: string | null): string | null {
	const raw = (authorization || "").trim();
	if (!raw) return null;
	const m = raw.match(/^bearer\s+(.+)$/i);
	const token = m && m[1] ? m[1].trim() : "";
	return token ? token : null;
}

internalRouter.use("*", async (c, next) => {
	const expected = String(c.env.INTERNAL_WORKER_TOKEN ?? "").trim();
	if (!expected) {
		return c.json({ error: "Not found" }, 404);
	}

		const authHeader = c.req.header("Authorization") ?? null;
		const provided =
			(c.req.header("X-Internal-Token") || "").trim() ||
			readBearerToken(authHeader) ||
			"";

	if (!provided || provided !== expected) {
		return c.json({ error: "Forbidden" }, 403);
	}

	await next();
});

const CreditFinalizerRunRequestSchema = z
	.object({
		limit: z.number().int().min(1).max(100).optional(),
		orphanReleaseMs: z.number().int().min(60_000).optional(),
	})
	.strict();

const PromptEvolutionRunRequestSchema = z
	.object({
		sinceHours: z.number().int().min(1).max(24 * 30).optional(),
		minSamples: z.number().int().min(1).max(10_000).optional(),
		dryRun: z.boolean().optional(),
	})
	.strict();

async function ensurePromptEvolutionSchema(): Promise<void> {}

internalRouter.post("/credit-finalizer/run", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreditFinalizerRunRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{
				error: "Invalid request body",
				issues: parsed.error.issues,
			},
			400,
		);
	}

	const result = await runCreditTaskFinalizer(c.env as WorkerEnv, parsed.data);
	return c.json({ ok: true, ...result });
});

internalRouter.post("/prompt-evolution/run", async (c) => {
	await ensurePromptEvolutionSchema();
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PromptEvolutionRunRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{
				error: "Invalid request body",
				issues: parsed.error.issues,
			},
			400,
		);
	}

	const sinceHours =
		typeof parsed.data.sinceHours === "number" ? parsed.data.sinceHours : 24;
	const minSamples =
		typeof parsed.data.minSamples === "number" ? parsed.data.minSamples : 30;
	const dryRun = parsed.data.dryRun !== false;
	const sinceIso = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

	const logs = await getPrismaClient().vendor_api_call_logs.findMany({
		where: {
			task_kind: { in: ["chat", "prompt_refine"] },
			created_at: { gte: sinceIso },
		},
		select: {
			status: true,
			duration_ms: true,
		},
	});

	const total = logs.length;
	const succeeded = logs.filter((l) => l.status === "succeeded").length;
	const failed = logs.filter((l) => l.status === "failed").length;
	const durationValues = logs
		.map((l) => l.duration_ms)
		.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
	const avgDurationMs =
		durationValues.length > 0
			? durationValues.reduce((sum, current) => sum + current, 0) /
				durationValues.length
			: 0;
	const successRate = total > 0 ? succeeded / total : 0;
	const hasEnoughSamples = total >= minSamples;
	const action = hasEnoughSamples && !dryRun ? "ready_for_optimizer" : "skip";
	const runId = crypto.randomUUID();
	const nowIso = new Date().toISOString();

	await getPrismaClient().prompt_evolution_runs.create({
		data: {
			id: runId,
			actor_user_id: "internal-worker",
			since_hours: sinceHours,
			min_samples: minSamples,
			dry_run: dryRun ? 1 : 0,
			action,
			metrics_json: JSON.stringify({
				total,
				succeeded,
				failed,
				successRate,
				avgDurationMs: Math.max(0, Math.round(avgDurationMs)),
			}),
			created_at: nowIso,
		},
	});

	return c.json({
		ok: true,
		runId,
		job: "prompt-evolution",
		sinceHours,
		sinceIso,
		dryRun,
		guardrail: {
			minSamples,
			hasEnoughSamples,
		},
		metrics: {
			total,
			succeeded,
			failed,
			successRate,
			avgDurationMs: Math.max(0, Math.round(avgDurationMs)),
		},
		action,
	});
});

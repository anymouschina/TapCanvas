import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { AppContext } from "../../types";
import {
	claimContinuationSettlementReconciliation,
	executeContinuationSettlementRecoveryCapsule,
} from "./agents-continuation-settlement";
import { recoverAsyncAgentContinuationRegistration } from "./async-agent-continuation-registration-recovery";
import { enqueueAsyncAgentContinuations } from "./async-agent-continuation.queue";

type ChaosMode = "fail_after_registration" | "recover";

const databaseUrl = String(process.env.CONTINUATION_CHAOS_DATABASE_URL ?? "").trim();
const redisUrl = String(process.env.CONTINUATION_CHAOS_REDIS_URL ?? "").trim();
const effectId = String(process.env.CONTINUATION_CHAOS_EFFECT_ID ?? "").trim();
const mode = String(process.env.CONTINUATION_CHAOS_MODE ?? "").trim() as ChaosMode;
const enabled = Boolean(databaseUrl && redisUrl && effectId && mode);

function assertIsolatedDatabase(url: string): void {
	const name = new URL(url).pathname.replace(/^\/+/, "");
	if (!/(?:chaos|test)/i.test(name)) {
		throw new Error("chaos worker requires an isolated database whose name contains 'chaos' or 'test'");
	}
}

function assertIsolatedRedis(url: string): void {
	const parsed = new URL(url);
	const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
	if (!local || parsed.port === "6379") {
		throw new Error("chaos worker requires an isolated loopback Redis on a non-default port");
	}
}

describe.skipIf(!enabled)("continuation settlement chaos worker fixture", () => {
	it("executes exactly one durable recovery pass", async () => {
		assertIsolatedDatabase(databaseUrl);
		assertIsolatedRedis(redisUrl);
		expect(["fail_after_registration", "recover"]).toContain(mode);
		process.env.DATABASE_URL = databaseUrl;
		process.env.REDIS_URL = redisUrl;
		const db = new PrismaClient({ datasourceUrl: databaseUrl });
		const c = { env: { DB: db } } as unknown as AppContext;
		try {
			const records = await claimContinuationSettlementReconciliation(c, 20);
			const record = records.find((candidate) => candidate.effectId === effectId);
			if (!record) {
				process.stdout.write(`CONTINUATION_CHAOS_RESULT ${JSON.stringify({ effectId, mode, outcome: "not_claimed" })}\n`);
				return;
			}
			let publicationAttempts = 0;
			const outcome = await executeContinuationSettlementRecoveryCapsule({
				c,
				record,
				execute: async (capsule) => {
					await recoverAsyncAgentContinuationRegistration({
						c,
						continuation: capsule.continuation,
						enqueue: async (continuations) => {
							publicationAttempts += 1;
							if (mode === "fail_after_registration") return 0;
							return enqueueAsyncAgentContinuations(continuations);
						},
					});
				},
			});
			process.stdout.write(`CONTINUATION_CHAOS_RESULT ${JSON.stringify({ effectId, mode, outcome, publicationAttempts })}\n`);
		} finally {
			await db.$disconnect();
		}
	});
});

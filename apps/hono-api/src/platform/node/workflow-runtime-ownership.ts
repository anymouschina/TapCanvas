import { createHash, randomUUID } from "node:crypto";

import { getSharedRedis } from "../redis-shared";

type WorkflowRuntimeOwnershipRedis = Readonly<{
	set: (
		key: string,
		value: string,
		expiryMode: "PX",
		expiryMs: number,
		condition: "NX",
	) => Promise<unknown>;
	eval: (script: string, keyCount: number, ...args: Array<string | number>) => Promise<unknown>;
}>;

export type WorkflowRuntimeOwnershipLoss = Readonly<{
	code: "workflow_runtime_ownership_replaced" | "workflow_runtime_ownership_renewal_failed";
	message: string;
}>;

export type WorkflowRuntimeOwnership = Readonly<{
	key: string;
	token: string;
	lost: Promise<WorkflowRuntimeOwnershipLoss>;
	assertOwned: () => void;
	release: () => Promise<void>;
}>;

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RENEW_INTERVAL_MS = 10_000;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function readDatabaseNamespace(databaseUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(databaseUrl);
	} catch {
		throw new Error("Workflow runtime ownership requires a valid DATABASE_URL");
	}
	const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/gu, ""));
	if (!databaseName) {
		throw new Error("Workflow runtime ownership requires DATABASE_URL to name a database");
	}
	const schema = parsed.searchParams.get("schema")?.trim() || "public";
	return `${databaseName}:${schema}`;
}

export function buildWorkflowRuntimeOwnershipKey(databaseUrl: string): string {
	const namespace = readDatabaseNamespace(databaseUrl);
	const digest = createHash("sha256").update(namespace).digest("hex").slice(0, 24);
	return `tapcanvas:workflow-runtime-owner:${digest}`;
}

export async function acquireWorkflowRuntimeOwnership(input: Readonly<{
	redis?: WorkflowRuntimeOwnershipRedis | null;
	databaseUrl?: string;
	leaseMs?: number;
	renewIntervalMs?: number;
	token?: string;
}> = {}): Promise<WorkflowRuntimeOwnership> {
	const redis = input.redis === undefined ? getSharedRedis() : input.redis;
	if (!redis) {
		throw new Error("Workflow runtime ownership requires REDIS_URL and a reachable shared Redis");
	}
	const databaseUrl = input.databaseUrl ?? String(process.env.DATABASE_URL || "").trim();
	if (!databaseUrl) {
		throw new Error("Workflow runtime ownership requires DATABASE_URL");
	}
	const leaseMs = Math.max(3_000, Math.floor(input.leaseMs ?? DEFAULT_LEASE_MS));
	const renewIntervalMs = Math.max(
		250,
		Math.min(Math.floor(input.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS), leaseMs - 1),
	);
	const key = buildWorkflowRuntimeOwnershipKey(databaseUrl);
	const token = input.token?.trim() || randomUUID();
	let acquired: unknown;
	try {
		acquired = await redis.set(key, token, "PX", leaseMs, "NX");
	} catch (error) {
		throw new Error(
			`Workflow runtime ownership acquisition failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (acquired !== "OK") {
		throw new Error("workflow_runtime_owner_already_active");
	}

	let released = false;
	let ownershipLoss: WorkflowRuntimeOwnershipLoss | null = null;
	let resolveLost: (loss: WorkflowRuntimeOwnershipLoss) => void = () => undefined;
	const lost = new Promise<WorkflowRuntimeOwnershipLoss>((resolve) => {
		resolveLost = resolve;
	});
	const markLost = (loss: WorkflowRuntimeOwnershipLoss): void => {
		if (released || ownershipLoss) return;
		ownershipLoss = loss;
		resolveLost(loss);
	};
	let renewalInFlight = false;
	const renewalTimer = setInterval(() => {
		if (released || ownershipLoss || renewalInFlight) return;
		renewalInFlight = true;
		void redis.eval(RENEW_SCRIPT, 1, key, token, leaseMs)
			.then((renewed) => {
				if (Number(renewed) !== 1) {
					markLost({
						code: "workflow_runtime_ownership_replaced",
						message: "Workflow runtime ownership generation no longer matches the active lease",
					});
				}
			})
			.catch((error: unknown) => {
				markLost({
					code: "workflow_runtime_ownership_renewal_failed",
					message: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				renewalInFlight = false;
			});
	}, renewIntervalMs);
	renewalTimer.unref?.();

	return {
		key,
		token,
		lost,
		assertOwned: () => {
			if (released) throw new Error("workflow_runtime_ownership_released");
			if (ownershipLoss) throw new Error(ownershipLoss.code);
		},
		release: async () => {
			if (released) return;
			released = true;
			clearInterval(renewalTimer);
			await redis.eval(RELEASE_SCRIPT, 1, key, token);
		},
	};
}

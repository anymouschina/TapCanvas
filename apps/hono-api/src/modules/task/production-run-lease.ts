import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { getPrismaClient } from "../../platform/node/prisma";

// Longest authoring/media calls can legitimately exceed five minutes. A
// 30-minute lease is renewed every minute; if a process dies, stale recovery
// waits for this deterministic expiry instead of risking an overlapping charge.
export const PRODUCTION_RUN_LEASE_TTL_MS = 1_800_000;
export const PRODUCTION_RUN_LEASE_RENEW_INTERVAL_MS = 60_000;

type LeaseTokenRow = Readonly<{ token: string }>;

function requireLeaseKey(value: unknown): string {
	const leaseKey = typeof value === "string" ? value.trim() : "";
	if (!leaseKey) throw new Error("production run lease requires leaseKey");
	return leaseKey;
}

function requireToken(value: unknown): string {
	const token = typeof value === "string" ? value.trim() : "";
	if (!token) throw new Error("production run lease requires token");
	return token;
}

function requireTtlMs(value: number): number {
	if (!Number.isInteger(value) || value < 1_000) {
		throw new Error("production run lease ttlMs must be an integer >= 1000");
	}
	return value;
}

/**
 * Atomically acquires an expired/missing lease using PostgreSQL server time.
 * `null` means another live holder owns the key; database errors are propagated.
 */
export async function acquireProductionRunLease(
	leaseKeyValue: string,
	ttlMsValue: number = PRODUCTION_RUN_LEASE_TTL_MS,
): Promise<string | null> {
	const leaseKey = requireLeaseKey(leaseKeyValue);
	const ttlMs = requireTtlMs(ttlMsValue);
	const token = randomUUID();
	const rows = await getPrismaClient().$queryRaw<LeaseTokenRow[]>(Prisma.sql`
		INSERT INTO "production_run_leases" (
			"lease_key", "token", "acquired_at", "expires_at", "updated_at"
		)
		VALUES (
			${leaseKey}, ${token}, clock_timestamp(),
			clock_timestamp() + (${ttlMs} * INTERVAL '1 millisecond'),
			clock_timestamp()
		)
		ON CONFLICT ("lease_key") DO UPDATE
		SET
			"token" = EXCLUDED."token",
			"acquired_at" = EXCLUDED."acquired_at",
			"expires_at" = EXCLUDED."expires_at",
			"updated_at" = EXCLUDED."updated_at"
		WHERE "production_run_leases"."expires_at" <= clock_timestamp()
		RETURNING "token"
	`);
	return rows[0]?.token === token ? token : null;
}

/** Renews only a still-live lease owned by the exact token. */
export async function renewProductionRunLease(
	leaseKeyValue: string,
	tokenValue: string,
	ttlMsValue: number = PRODUCTION_RUN_LEASE_TTL_MS,
): Promise<boolean> {
	const leaseKey = requireLeaseKey(leaseKeyValue);
	const token = requireToken(tokenValue);
	const ttlMs = requireTtlMs(ttlMsValue);
	const rows = await getPrismaClient().$queryRaw<LeaseTokenRow[]>(Prisma.sql`
		UPDATE "production_run_leases"
		SET
			"expires_at" = clock_timestamp() + (${ttlMs} * INTERVAL '1 millisecond'),
			"updated_at" = clock_timestamp()
		WHERE "lease_key" = ${leaseKey}
			AND "token" = ${token}
			AND "expires_at" > clock_timestamp()
		RETURNING "token"
	`);
	return rows[0]?.token === token;
}

/** Releases only the current holder. A mismatched token leaves the lease intact. */
export async function releaseProductionRunLease(
	leaseKeyValue: string,
	tokenValue: string,
): Promise<boolean> {
	const leaseKey = requireLeaseKey(leaseKeyValue);
	const token = requireToken(tokenValue);
	const rows = await getPrismaClient().$queryRaw<LeaseTokenRow[]>(Prisma.sql`
		DELETE FROM "production_run_leases"
		WHERE "lease_key" = ${leaseKey} AND "token" = ${token}
		RETURNING "token"
	`);
	return rows[0]?.token === token;
}

import { describe, expect, it } from "vitest";

import {
	InternalRequestAuthFailure,
	signInternalSpecialistRequest,
	verifyInternalSpecialistRequest,
	type InternalNonceStore,
} from "./internal-request-auth";

class MemoryNonceStore implements InternalNonceStore {
	private readonly claimed = new Set<string>();

	async claim(key: string): Promise<boolean> {
		if (this.claimed.has(key)) return false;
		this.claimed.add(key);
		return true;
	}
}

const body = JSON.stringify({ schemaVersion: "image-prompt-request/v1", requestId: "request-1" });
const base = {
	serviceId: "hmaigc-commercial-api",
	secret: "a-commercially-long-hmac-secret-32-bytes-minimum",
	method: "POST",
	path: "/internal/v1/specialists/image-prompt",
	body,
	idempotencyKey: "image-prompt:task-1",
	timestampSeconds: 1_789_000_000,
	nonce: "nonce-1",
} as const;

describe("internal specialist request authentication", () => {
	it("verifies the canonical body digest, signature and service identity once", async () => {
		const headers = await signInternalSpecialistRequest(base);
		const nonceStore = new MemoryNonceStore();
		const verified = await verifyInternalSpecialistRequest({
			...base,
			headers,
			nonceStore,
			nowMs: base.timestampSeconds * 1_000,
		});

		expect(verified.serviceId).toBe(base.serviceId);
		expect(verified.idempotencyKey).toBe(base.idempotencyKey);
		expect(verified.bodyDigest).toBe(headers["x-tapcanvas-body-sha256"]);

		await expect(
			verifyInternalSpecialistRequest({
				...base,
				headers,
				nonceStore,
				nowMs: base.timestampSeconds * 1_000,
			}),
		).rejects.toMatchObject({ code: "specialist_replay_rejected" });
	});

	it.each([
		["signature", { "x-tapcanvas-signature": `v1=${"0".repeat(64)}` }],
		["service", { "x-tapcanvas-service-id": "another-service" }],
		["idempotency", { "x-tapcanvas-idempotency-key": "image-prompt:task-2" }],
	])("rejects a tampered %s header", async (_label, override) => {
		const headers = { ...(await signInternalSpecialistRequest(base)), ...override };
		await expect(
			verifyInternalSpecialistRequest({
				...base,
				headers,
				nonceStore: new MemoryNonceStore(),
				nowMs: base.timestampSeconds * 1_000,
			}),
		).rejects.toBeInstanceOf(InternalRequestAuthFailure);
	});

	it("rejects stale timestamps and body tampering before claiming a nonce", async () => {
		const headers = await signInternalSpecialistRequest(base);
		const nonceStore = new MemoryNonceStore();

		await expect(
			verifyInternalSpecialistRequest({
				...base,
				headers,
				nonceStore,
				nowMs: (base.timestampSeconds + 61) * 1_000,
			}),
		).rejects.toMatchObject({ code: "specialist_auth_invalid" });

		await expect(
			verifyInternalSpecialistRequest({
				...base,
				body: `${base.body} `,
				headers,
				nonceStore,
				nowMs: base.timestampSeconds * 1_000,
			}),
		).rejects.toMatchObject({ code: "specialist_auth_invalid" });
	});

	it("rejects an HMAC secret shorter than 32 UTF-8 bytes", async () => {
		await expect(
			signInternalSpecialistRequest({ ...base, secret: "short-secret" }),
		).rejects.toMatchObject({ code: "specialist_auth_invalid" });
	});
});

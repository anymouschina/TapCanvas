import { describe, expect, it } from "vitest";
import {
	resolveDevPublicBypassFromContext,
} from "./devPublicBypass";

type FakeContext = {
	env: Record<string, unknown>;
	req: { header: (name: string) => string | undefined };
};

function makeCtx(input: {
	env?: Record<string, unknown>;
	headers?: Record<string, string>;
}): FakeContext {
	const headers = new Map<string, string>();
	Object.entries(input.headers || {}).forEach(([k, v]) => headers.set(k.toLowerCase(), v));
	return {
		env: input.env || {},
		req: {
			header: (name: string) => headers.get(name.toLowerCase()),
		},
	};
}

describe("resolveDevPublicBypassFromContext", () => {
	it("returns null when disabled", () => {
		const ctx = makeCtx({
			env: { TAPCANVAS_DEV_PUBLIC_BYPASS: "0", TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET: "s" },
			headers: { host: "localhost:8788", "x-tap-dev-bypass": "s" },
		});
		expect(resolveDevPublicBypassFromContext(ctx as any)).toBeNull();
	});

	it("requires secret + header match + localhost", () => {
		const ctxBadHost = makeCtx({
			env: { TAPCANVAS_DEV_PUBLIC_BYPASS: "1", TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET: "s" },
			headers: { host: "example.com", "x-tap-dev-bypass": "s" },
		});
		expect(resolveDevPublicBypassFromContext(ctxBadHost as any)).toBeNull();

		const ctxBadSecret = makeCtx({
			env: { TAPCANVAS_DEV_PUBLIC_BYPASS: "1", TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET: "s" },
			headers: { host: "localhost:8788", "x-tap-dev-bypass": "x" },
		});
		expect(resolveDevPublicBypassFromContext(ctxBadSecret as any)).toBeNull();

		const ctxOk = makeCtx({
			env: {
				TAPCANVAS_DEV_PUBLIC_BYPASS: "1",
				TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET: "s",
				TAPCANVAS_DEV_PUBLIC_BYPASS_USER_ID: "u",
				TAPCANVAS_DEV_PUBLIC_BYPASS_ROLE: "admin",
			},
			headers: { host: "localhost:8788", "x-tap-dev-bypass": "s" },
		});
		expect(resolveDevPublicBypassFromContext(ctxOk as any)).toEqual({
			enabled: true,
			userId: "u",
			role: "admin",
		});
	});
});

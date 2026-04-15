import { describe, expect, it } from "vitest";
import { signJwtHS256, verifyJwtHS256 } from "./jwt";

type DemoPayload = {
	sub: string;
	role: string;
	iat: number;
	exp: number;
};

describe("jwt hs256", () => {
	it("signs and verifies a token", async () => {
		const secret = "tapcanvas-secret";
		const token = await signJwtHS256({ sub: "u_1", role: "admin" }, secret, 60);
		const payload = await verifyJwtHS256<DemoPayload>(token, secret);

		expect(payload).not.toBeNull();
		expect(payload?.sub).toBe("u_1");
		expect(payload?.role).toBe("admin");
		expect(typeof payload?.iat).toBe("number");
		expect(typeof payload?.exp).toBe("number");
	});

	it("returns null when signature is tampered", async () => {
		const secret = "tapcanvas-secret";
		const token = await signJwtHS256({ sub: "u_2" }, secret, 60);
		const tampered = `${token.slice(0, -1)}x`;
		const payload = await verifyJwtHS256(tampered, secret);

		expect(payload).toBeNull();
	});

	it("returns null when token is expired", async () => {
		const secret = "tapcanvas-secret";
		const token = await signJwtHS256({ sub: "u_3" }, secret, -1);
		const payload = await verifyJwtHS256(token, secret);

		expect(payload).toBeNull();
	});
});

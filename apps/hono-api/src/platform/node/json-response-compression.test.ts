import { gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { compressJsonResponse } from "./json-response-compression";

describe("large JSON response compression", () => {
	const value = { text: "保留全部结果与证据".repeat(10_000) };
	const app = new Hono().get("/results", compressJsonResponse, (c) => {
		c.header("Vary", "Origin");
		return c.json(value);
	});
	it("reduces transfer size and preserves the JSON response", async () => {
		const res = await app.request("/results", { headers: { "Accept-Encoding": "br, gzip, deflate" } });
		expect(res.headers.get("Content-Encoding")).toBe("gzip");
		expect(res.headers.get("Vary")).toBe("Origin, Accept-Encoding");
		const buffer = Buffer.from(await res.arrayBuffer());
		expect(buffer.length).toBeLessThan(Buffer.byteLength(JSON.stringify(value)) / 10);
		expect(JSON.parse(gunzipSync(buffer).toString())).toEqual(value);
	});
	it.each([undefined, "identity", "gzip;q=0, *;q=1", "gzip;q=bad", "br"])("respects rejected or absent gzip negotiation: %s", async (encoding) => {
		const res = await app.request("/results", { headers: encoding ? { "Accept-Encoding": encoding } : {} });
		expect(res.headers.has("Content-Encoding")).toBe(false);
		expect(res.headers.get("Vary")).toContain("Accept-Encoding");
		expect(await res.json()).toEqual(value);
	});
});

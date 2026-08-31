import { describe, expect, it } from "vitest";

import { parseSafePublicHttpUrl } from "./public-http-url";

describe("public HTTP URL structural boundary", () => {
	it("accepts public HTTPS media sources", () => {
		expect(parseSafePublicHttpUrl("https://cdn.example.com/input/video.mp4")?.hostname).toBe(
			"cdn.example.com",
		);
	});

	it.each([
		"http://localhost/input.png",
		"http://127.0.0.1/input.png",
		"http://10.0.0.8/input.png",
		"http://169.254.169.254/latest/meta-data",
		"http://192.168.1.20/input.mp4",
		"file:///tmp/input.mp4",
	])("rejects a non-public server-side fetch target: %s", (value) => {
		expect(parseSafePublicHttpUrl(value)).toBeNull();
	});
});

import { describe, expect, it } from "vitest";

import type { AppContext } from "./types";
import { readBodySnippetForLog, safeHeadersForLog } from "./httpDebugLog";

describe("HTTP debug log media URL redaction", () => {
	it("never records a signed video_url from an upstream JSON request", async () => {
		const request = new Request("https://relay.example.com/v1/responses", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				input: [{
					content: [{
						type: "input_video",
						video_url: "https://bucket.example.com/proxy.mp4?X-Amz-Credential=secret&X-Amz-Signature=signed",
					}],
				}],
			}),
		});
		const result = await readBodySnippetForLog({ env: {} } as AppContext, request, 16_384);
		expect(result?.body).toEqual({
			input: [{ content: [{ type: "input_video", video_url: "***" }] }],
		});
	});
});

describe("HTTP debug log credential header redaction", () => {
	it("redacts public and service-to-service credentials through one header policy", () => {
		const headers = new Headers({
			Authorization: "Bearer public-secret",
			Cookie: "session=private",
			"X-API-Key": "api-secret",
			"X-Internal-Token": "worker-secret",
			"X-Agent-Token": "agent-secret",
			"Content-Type": "application/json",
		});

		expect(safeHeadersForLog({ env: {} } as AppContext, headers)).toEqual({
			authorization: "Bearer ***",
			"content-type": "application/json",
			cookie: "***",
			"x-agent-token": "***",
			"x-api-key": "***",
			"x-internal-token": "***",
		});
	});
});

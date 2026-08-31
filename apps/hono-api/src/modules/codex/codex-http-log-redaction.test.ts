import { describe, expect, it } from "vitest";
import { readBodySnippetForLog } from "../../httpDebugLog";
import type { AppContext } from "../../types";

describe("Codex HTTP debug-log redaction", () => {
	it("never records pairing codes or remote build environment values", async () => {
		const context = {
			env: {
				DEBUG_HTTP_LOG_UNSAFE: "0",
			},
		} as unknown as AppContext;
		const body = {
			pairingCode: "one-time-pairing-secret",
			spec: {
				environment: {
					DATABASE_URL: "postgres://private",
					PUBLIC_MODE: "production",
				},
			},
		};
		const result = await readBodySnippetForLog(
			context,
			new Request("https://canvas.example.com/public/codex/task", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
			16_384,
		);

		expect(result?.body).toEqual({
			pairingCode: "***",
			spec: {
				environment: "***",
			},
		});
	});
});

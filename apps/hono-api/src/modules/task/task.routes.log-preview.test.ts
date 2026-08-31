import { describe, expect, it } from "vitest";

import { buildLogPayloadPreview } from "./task.routes";

describe("buildLogPayloadPreview", () => {
	it("keeps executable model fields readable in nested new-api failures", () => {
		const preview = buildLogPayloadPreview(JSON.stringify({
			status: 400,
			error: {
				code: "new_api_model_disabled",
				details: {
					executableModels: [
						{
							modelKey: "doubao-seed-2-0-lite-260428",
							label: "Doubao Seed 2.0 Lite",
							kind: "text",
						},
					],
				},
			},
		}));

		expect(preview).not.toBeNull();
		expect(JSON.parse(preview ?? "null")).toMatchObject({
			error: {
				details: {
					executableModels: [
						{
							modelKey: "doubao-seed-2-0-lite-260428",
							label: "Doubao Seed 2.0 Lite",
							kind: "text",
						},
					],
				},
			},
		});
	});
});

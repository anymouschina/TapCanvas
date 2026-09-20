import { describe, expect, it } from "vitest";
import { evaluateWorkflowMediaProbe } from "./execution.media-probe";

describe("evaluateWorkflowMediaProbe", () => {
	it("records real pixel and aspect-ratio drift without blocking delivery", () => {
		const result = evaluateWorkflowMediaProbe(
			{ width: 832, height: 480, durationSeconds: 15.083333, videoCodec: "h264" },
			{ size: "1280x720", aspectRatio: "16:9", durationSeconds: 15 },
		);
		expect(result.probe?.width).toBe(832);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]?.code).toBe("media_spec_mismatch");
		expect(result.diagnostics[0]?.blocking).toBe(false);
		expect(result.diagnostics[0]?.fields).toEqual(["size", "aspectRatio"]);
	});

	it("accepts matching media and normal frame-tail duration drift", () => {
		const result = evaluateWorkflowMediaProbe(
			{ width: 1280, height: 720, durationSeconds: 15.08 },
			{ size: "1280x720", aspectRatio: "16:9", durationSeconds: 15 },
		);
		expect(result.diagnostics).toEqual([]);
	});

	it("keeps delivery non-blocking when probing is unavailable", () => {
		const result = evaluateWorkflowMediaProbe(null, { size: "1280x720", durationSeconds: 15 });
		expect(result.diagnostics[0]?.code).toBe("media_probe_unavailable");
		expect(result.diagnostics[0]?.blocking).toBe(false);
	});
});

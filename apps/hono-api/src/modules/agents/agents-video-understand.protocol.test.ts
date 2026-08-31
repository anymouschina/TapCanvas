import { describe, expect, it } from "vitest";

import { buildVideoUnderstandResponsesRequest } from "./agents-video-understand.protocol";
import { VIDEO_ANALYSIS_EXECUTION_LIMITS } from "../billing/video-analysis-upfront-pricing";

describe("video understand Responses protocol", () => {
	it("uses the prepared proxy URL and strict JSON Schema for shot-table-v1", () => {
		const request = buildVideoUnderstandResponsesRequest({
			model: "doubao-seed-2-0-lite-260428",
			videoUrl: "https://file.example.com/proxy.mp4",
			fps: 1,
			userPrompt: "重点识别动作节奏",
			outputMode: "shot-table-v1",
			verifiedDurationSeconds: 12.345,
		});

		expect(request).toMatchObject({
			model: "doubao-seed-2-0-lite-260428",
			store: true,
			max_output_tokens: 16_384,
			text: {
				format: {
					type: "json_schema",
					name: "tapcanvas_shot_table_analysis_v1",
					strict: true,
					schema: {
						type: "object",
						additionalProperties: false,
					},
				},
			},
		});
		const input = request.input as Array<Record<string, unknown>>;
		expect(input[0]).toMatchObject({ type: "message", role: "user" });
		const content = input[0]?.content as Array<Record<string, unknown>>;
		expect(content[0]).toEqual({
			type: "input_video",
			video_url: "https://file.example.com/proxy.mp4",
			fps: 1,
		});
		expect(content[1]?.text).toContain("用户补充的分析重点：\n重点识别动作节奏");
		expect(content[1]?.text).toContain("已验证素材总时长为 12.345s");
		expect(content[1]?.text).not.toContain("=========单镜头开始=========");
		const schema = ((request.text as Record<string, unknown>).format as Record<string, unknown>).schema as Record<string, unknown>;
		const properties = schema.properties as Record<string, Record<string, unknown>>;
		const shots = properties.shots;
		const item = shots.items as Record<string, unknown>;
		const itemProperties = item.properties as Record<string, Record<string, unknown>>;
		const shotProperties = itemProperties.shot.properties as Record<string, unknown>;
		expect(shotProperties).not.toHaveProperty("节拍单元");
		expect(shotProperties).not.toHaveProperty("剧本特征");
	});

	it("does not attach a structured-output contract to free-text mode", () => {
		const request = buildVideoUnderstandResponsesRequest({
			model: "video-model",
			videoUrl: "https://file.example.com/proxy.mp4",
			fps: 0.5,
			userPrompt: "只描述画面",
			outputMode: "free-text",
		});
		expect(request).not.toHaveProperty("text");
		expect(request).toHaveProperty("max_output_tokens", 16_384);
	});

	it("keeps the largest advertised prompt and a long signed URL inside the fixed request-body envelope", () => {
		const request = buildVideoUnderstandResponsesRequest({
			model: "doubao-seed-2-0-lite-260428",
			videoUrl: `https://signed.example.com/${"v".repeat(2_048)}.mp4`,
			fps: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps,
			userPrompt: "x".repeat(VIDEO_ANALYSIS_EXECUTION_LIMITS.maxPromptBytes),
			outputMode: "shot-table-v1",
			verifiedDurationSeconds: 60,
		});
		const requestBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;

		expect(requestBytes).toBeLessThanOrEqual(
			VIDEO_ANALYSIS_EXECUTION_LIMITS.maxRequestBodyBytes,
		);
	});

	it("fails before model dispatch when shot-table duration evidence is missing", () => {
		expect(() => buildVideoUnderstandResponsesRequest({
			model: "video-model",
			videoUrl: "https://file.example.com/proxy.mp4",
			fps: 1,
			userPrompt: "",
			outputMode: "shot-table-v1",
		})).toThrow("verified positive media duration");
	});
});

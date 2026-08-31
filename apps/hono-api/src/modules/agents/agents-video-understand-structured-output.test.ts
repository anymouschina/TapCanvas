import {
	SHOT_TABLE_OVERVIEW_ORDER,
	VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS,
} from "@tapcanvas/shot-table-protocol";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../middleware/error";
import type { ResponsesOutputEnvelope } from "./agents-llm-protocol";
import { recoverShotTableAnalysisOutput } from "./agents-video-understand-structured-output";

const MODEL = "doubao-seed-2-0-lite-260428";

const createValidDocument = (shotCount = 1): Record<string, unknown> => {
	const totalDuration = shotCount;
	const overview = Object.fromEntries(
		SHOT_TABLE_OVERVIEW_ORDER.map((key) => [key, ({
			"总镜数": String(shotCount),
			"素材总时长": `${totalDuration.toFixed(3)}s`,
			"节拍数": "",
		} as Record<string, string>)[key] ?? `${key}内容`]),
	);
	return {
		version: 1,
		overview,
		shots: Array.from({ length: shotCount }, (_, index) => ({
			shot: Object.fromEntries(
				VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS
					.filter((column) => column.scope === "shot")
					.map((column) => [column.key, ({
						"镜号": String(index + 1),
						"时间区间（镜头完整区间）": `${index.toFixed(3)}s-${(index + 1).toFixed(3)}s`,
						"时长": "1.000s",
					} as Record<string, string>)[column.key] ?? `${column.key}内容`]),
			),
			timeline: [Object.fromEntries(
				VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS
					.filter((column) => column.scope === "timeline")
					.map((column) => [column.key, column.key === "时间段"
						? `${index.toFixed(3)}s-${(index + 1).toFixed(3)}s`
						: `${column.key}内容`]),
			)],
		})),
	};
};

const createEnvelope = (input: {
	id: string;
	text: string;
	previousResponseId?: string | null;
	model?: string;
}): ResponsesOutputEnvelope => ({
	id: input.id,
	model: input.model ?? MODEL,
	status: "completed",
	previousResponseId: input.previousResponseId ?? null,
	store: true,
	text: input.text,
});

describe("video shot-table structured-output recovery", () => {
	it("repairs only an exact missing string field through the same stored response context", async () => {
		const document = createValidDocument();
		const shots = document.shots as Array<Record<string, unknown>>;
		const firstShot = shots[0]?.shot as Record<string, unknown>;
		delete firstShot["构图"];
		const sendRepair = vi.fn(async (request: { kind: string; body: Record<string, unknown> }) => {
			expect(request.kind).toBe("targeted_fields");
			expect(request.body).toMatchObject({
				model: MODEL,
				previous_response_id: "resp_primary",
				store: true,
			});
			return createEnvelope({
				id: "resp_repair",
				previousResponseId: "resp_primary",
				text: JSON.stringify({ repairs: { R001: "主体依托门框形成纵深构图" } }),
			});
		});

		const result = await recoverShotTableAnalysisOutput({
			proxyTaskId: "task_targeted",
			model: MODEL,
			primary: createEnvelope({ id: "resp_primary", text: JSON.stringify(document) }),
			expectedDurationSeconds: 1,
			sendRepair,
		});

		expect(sendRepair).toHaveBeenCalledTimes(1);
		expect(result.execution).toMatchObject({
			proxyTaskId: "task_targeted",
			requestedModel: MODEL,
			repaired: true,
			repairKind: "targeted_fields",
		});
		expect(result.execution.attempts).toHaveLength(2);
		expect(result.execution.attempts[0]?.issues).toEqual([
			expect.objectContaining({
				code: "missing_field",
				path: ["shots", 0, "shot", "构图"],
			}),
		]);
		expect(result.table.rows[0]?.values["构图"]).toBe("主体依托门框形成纵深构图");
		expect(result.table.rows[0]?.values["景别"]).toBe("景别内容");
	});

	it("repairs the exact nine-shot 字数与语速 omission without duplicate violations", async () => {
		const document = createValidDocument(9);
		const shots = document.shots as Array<Record<string, unknown>>;
		for (const entry of shots) {
			const shot = entry.shot as Record<string, unknown>;
			delete shot["字数与语速"];
		}
		const repairs = Object.fromEntries(
			Array.from({ length: 9 }, (_, index) => [`R${String(index + 1).padStart(3, "0")}`, ""]),
		);
		const sendRepair = vi.fn(async (request: { kind: string; body: Record<string, unknown> }) => {
			expect(request.kind).toBe("targeted_fields");
			expect(request.body).toMatchObject({
				model: MODEL,
				previous_response_id: "resp_nine_shots",
				store: true,
			});
			return createEnvelope({
				id: "resp_nine_shots_repaired",
				previousResponseId: "resp_nine_shots",
				text: JSON.stringify({ repairs }),
			});
		});

		const result = await recoverShotTableAnalysisOutput({
			proxyTaskId: "task_nine_shots",
			model: MODEL,
			primary: createEnvelope({ id: "resp_nine_shots", text: JSON.stringify(document) }),
			expectedDurationSeconds: 9,
			sendRepair,
		});

		expect(sendRepair).toHaveBeenCalledTimes(1);
		expect(result.execution.repairKind).toBe("targeted_fields");
		expect(result.execution.attempts[0]?.issues).toHaveLength(9);
		expect(result.execution.attempts[0]?.issues.every((issue) => issue.code === "missing_field")).toBe(true);
		expect(result.execution.attempts[0]?.issues.map((issue) => issue.path)).toEqual(
			Array.from({ length: 9 }, (_, index) => ["shots", index, "shot", "字数与语速"]),
		);
		expect(result.table.rows).toHaveLength(9);
		expect(result.table.rows.every((row) => row.values["字数与语速"] === "")).toBe(true);
	});

	it("uses one full regeneration for malformed JSON without resending the video", async () => {
		const sendRepair = vi.fn(async (request: { kind: string; body: Record<string, unknown> }) => {
			expect(request.kind).toBe("full_regeneration");
			expect(request.body).toMatchObject({
				model: MODEL,
				previous_response_id: "resp_truncated",
				store: true,
			});
			expect(JSON.stringify(request.body)).not.toContain("input_video");
			return createEnvelope({
				id: "resp_regenerated",
				previousResponseId: "resp_truncated",
				text: JSON.stringify(createValidDocument()),
			});
		});

		const result = await recoverShotTableAnalysisOutput({
			proxyTaskId: "task_regeneration",
			model: MODEL,
			primary: createEnvelope({ id: "resp_truncated", text: '{"version":1' }),
			expectedDurationSeconds: 1,
			sendRepair,
		});

		expect(sendRepair).toHaveBeenCalledTimes(1);
		expect(result.execution.repairKind).toBe("full_regeneration");
		expect(result.execution.attempts[0]?.issues[0]?.code).toBe("json_invalid");
		expect(result.execution.attempts[1]?.validation).toBe("accepted");
		expect(result.table.rows).toHaveLength(1);
	});

	it("fails explicitly after the single repair attempt remains invalid", async () => {
		const sendRepair = vi.fn(async () => createEnvelope({
			id: "resp_still_invalid",
			previousResponseId: "resp_truncated",
			text: '{"version":1',
		}));

		let caught: unknown;
		try {
			await recoverShotTableAnalysisOutput({
				proxyTaskId: "task_failure",
				model: MODEL,
				primary: createEnvelope({ id: "resp_truncated", text: '{"version":1' }),
				expectedDurationSeconds: 1,
				sendRepair,
			});
		} catch (error: unknown) {
			caught = error;
		}

		expect(sendRepair).toHaveBeenCalledTimes(1);
		expect(caught).toBeInstanceOf(AppError);
		expect(caught).toMatchObject({
			code: "video_analysis_structured_repair_invalid",
			details: {
				execution: {
					proxyTaskId: "task_failure",
					repairKind: "full_regeneration",
					attempts: [
						expect.objectContaining({ responseId: "resp_truncated", validation: "rejected" }),
						expect.objectContaining({ responseId: "resp_still_invalid", validation: "rejected" }),
					],
				},
			},
		});
	});

	it("rejects a response that silently changes the requested model", async () => {
		await expect(recoverShotTableAnalysisOutput({
			proxyTaskId: "task_model_mismatch",
			model: MODEL,
			primary: createEnvelope({
				id: "resp_wrong_model",
				model: "another-model",
				text: JSON.stringify(createValidDocument()),
			}),
			expectedDurationSeconds: 1,
			sendRepair: async () => {
				throw new Error("must not run");
			},
		})).rejects.toMatchObject({
			code: "video_analysis_response_provenance_invalid",
		});
	});
});

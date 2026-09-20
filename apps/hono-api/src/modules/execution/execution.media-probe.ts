import type { ProbeMediaResult } from "../../platform/media-worker/client";

export type WorkflowMediaSpecExpectation = Readonly<{
	size?: string | null;
	aspectRatio?: string | null;
	durationSeconds?: number | null;
}>;

export type WorkflowMediaSpecDiagnostic = Readonly<{
	code: "media_probe_unavailable" | "media_probe_incomplete" | "media_spec_mismatch";
	blocking: false;
	expected: WorkflowMediaSpecExpectation;
	actual: ProbeMediaResult | null;
	fields: readonly ("size" | "aspectRatio" | "durationSeconds")[];
	message: string;
}>;

export type WorkflowMediaProbeEvidence = Readonly<{
	probe: ProbeMediaResult | null;
	diagnostics: readonly WorkflowMediaSpecDiagnostic[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readProbe(value: unknown): ProbeMediaResult | null {
	if (!isRecord(value)) return null;
	const result: ProbeMediaResult = {};
	if (typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds)) result.durationSeconds = value.durationSeconds;
	if (typeof value.width === "number" && Number.isInteger(value.width) && value.width > 0) result.width = value.width;
	if (typeof value.height === "number" && Number.isInteger(value.height) && value.height > 0) result.height = value.height;
	if (typeof value.videoCodec === "string" && value.videoCodec.trim()) result.videoCodec = value.videoCodec.trim();
	if (typeof value.audioCodec === "string" && value.audioCodec.trim()) result.audioCodec = value.audioCodec.trim();
	if (typeof value.fps === "number" && Number.isFinite(value.fps)) result.fps = value.fps;
	if (typeof value.sizeBytes === "number" || typeof value.sizeBytes === "string") result.sizeBytes = value.sizeBytes;
	return Object.keys(result).length > 0 ? result : null;
}

const DIAGNOSTIC_FIELDS = new Set(["size", "aspectRatio", "durationSeconds"]);

export function parseWorkflowMediaProbeEvidence(value: unknown): WorkflowMediaProbeEvidence | null {
	if (!isRecord(value)) return null;
	const probe = readProbe(value.probe);
	if (!Array.isArray(value.diagnostics)) return null;
	const diagnostics: WorkflowMediaSpecDiagnostic[] = [];
	for (const entry of value.diagnostics) {
		if (!isRecord(entry) || entry.blocking !== false || typeof entry.message !== "string" || !isRecord(entry.expected)) return null;
		const code = entry.code;
		if (code !== "media_probe_unavailable" && code !== "media_probe_incomplete" && code !== "media_spec_mismatch") return null;
		if (!Array.isArray(entry.fields)) return null;
		const fields = entry.fields.filter((field): field is "size" | "aspectRatio" | "durationSeconds" => typeof field === "string" && DIAGNOSTIC_FIELDS.has(field));
		if (fields.length !== entry.fields.length) return null;
		diagnostics.push({
			code,
			blocking: false,
			expected: {
				size: typeof entry.expected.size === "string" ? entry.expected.size : null,
				aspectRatio: typeof entry.expected.aspectRatio === "string" ? entry.expected.aspectRatio : null,
				durationSeconds: typeof entry.expected.durationSeconds === "number" ? entry.expected.durationSeconds : null,
			},
			actual: readProbe(entry.actual),
			fields,
			message: entry.message,
		});
	}
	return { probe, diagnostics };
}

type PositivePair = Readonly<{ first: number; second: number }>;

function parsePositivePair(value: string | null | undefined): PositivePair | null {
	if (!value) return null;
	const normalized = value.toLowerCase();
	const separator = normalized.includes("x") ? "x" : normalized.includes(":") ? ":" : null;
	if (!separator) return null;
	const parts = normalized.split(separator).map((part) => part.trim());
	if (parts.length !== 2 || parts.some((part) => part.length === 0)) return null;
	const first = Number(parts[0]);
	const second = Number(parts[1]);
	if (!Number.isInteger(first) || !Number.isInteger(second) || first <= 0 || second <= 0) return null;
	return { first, second };
}

function sameRatio(actualWidth: number, actualHeight: number, expected: string | null | undefined): boolean | null {
	const pair = parsePositivePair(expected);
	if (!pair) return null;
	return actualWidth * pair.second === actualHeight * pair.first;
}

export function evaluateWorkflowMediaProbe(
	probe: ProbeMediaResult | null,
	expected: WorkflowMediaSpecExpectation,
): WorkflowMediaProbeEvidence {
	if (!probe) {
		return {
			probe: null,
			diagnostics: [{
				code: "media_probe_unavailable",
				blocking: false,
				expected,
				actual: null,
				fields: ["size", "aspectRatio", "durationSeconds"],
				message: "生成资产已保留，但当前没有可用的媒体探测结果；规格事实待补探测。",
			}],
		};
	}

	const fields: Array<"size" | "aspectRatio" | "durationSeconds"> = [];
	const expectedSize = parsePositivePair(expected.size);
	if (expected.size && !expectedSize) fields.push("size");
	if (expectedSize && (probe.width !== expectedSize.first || probe.height !== expectedSize.second)) fields.push("size");
	const expectedAspect = expected.aspectRatio?.trim();
	if (expectedAspect) {
		if (typeof probe.width !== "number" || typeof probe.height !== "number" || probe.width <= 0 || probe.height <= 0) {
			fields.push("aspectRatio");
		} else if (sameRatio(probe.width, probe.height, expectedAspect) !== true) {
			fields.push("aspectRatio");
		}
	}
	if (expected.durationSeconds !== null && expected.durationSeconds !== undefined) {
		if (typeof probe.durationSeconds !== "number" || !Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) {
			fields.push("durationSeconds");
		} else {
			const tolerance = Math.max(0.25, expected.durationSeconds * 0.02);
			if (Math.abs(probe.durationSeconds - expected.durationSeconds) > tolerance) fields.push("durationSeconds");
		}
	}
	if (fields.length === 0) return { probe, diagnostics: [] };
	const incomplete = (expectedSize !== null && (probe.width === undefined || probe.height === undefined))
		|| (!!expectedAspect && (probe.width === undefined || probe.height === undefined))
		|| (expected.durationSeconds !== null && expected.durationSeconds !== undefined && probe.durationSeconds === undefined);
	return {
		probe,
		diagnostics: [{
			code: incomplete ? "media_probe_incomplete" : "media_spec_mismatch",
			blocking: false,
			expected,
			actual: probe,
			fields,
			message: incomplete
				? "生成资产已保留，但媒体探测缺少请求规格所需的事实字段。"
				: `生成资产已保留；实际媒体与请求规格存在差异：${fields.join(", ")}`,
		}],
	};
}

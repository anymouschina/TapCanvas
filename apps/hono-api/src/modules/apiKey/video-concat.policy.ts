export type VideoConcatJoinMode = "hard_cut" | "xfade";

export type VideoConcatPolicy = {
	joinMode: VideoConcatJoinMode;
	xfadeSeconds: number;
	colorMatch: boolean;
};

type ConcatTransitionSpec = {
	transition?: string;
};

const TRUE_VALUES = new Set(["1", "true", "on"]);
const FALSE_VALUES = new Set(["0", "false", "off"]);

function parseEnvironmentXfadeSeconds(value: unknown): number {
	if (value === undefined || value === null || String(value).trim() === "") return 0;
	const normalized = String(value).trim().toLowerCase();
	if (FALSE_VALUES.has(normalized)) return 0;
	const seconds = Number(normalized);
	if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1.2) {
		throw new Error(`video_concat_xfade_config_invalid:${String(value)}`);
	}
	return seconds;
}

function parseRequestedXfadeSeconds(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1.2) {
		throw new Error(`video_concat_xfade_request_invalid:${String(value)}`);
	}
	return value;
}

function parseEnvironmentColorMatch(value: unknown): boolean {
	if (value === undefined || value === null || String(value).trim() === "") return false;
	const normalized = String(value).trim().toLowerCase();
	if (TRUE_VALUES.has(normalized)) return true;
	if (FALSE_VALUES.has(normalized)) return false;
	throw new Error(`video_concat_color_match_config_invalid:${String(value)}`);
}

function parseRequestedColorMatch(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") {
		throw new Error(`video_concat_color_match_request_invalid:${String(value)}`);
	}
	return value;
}

export function resolveVideoConcatPolicy(input: {
	environmentXfadeSeconds?: unknown;
	environmentColorMatch?: unknown;
	requestedXfadeSeconds?: unknown;
	requestedColorMatch?: unknown;
}): VideoConcatPolicy {
	const requestedXfadeSeconds = parseRequestedXfadeSeconds(input.requestedXfadeSeconds);
	const requestedColorMatch = parseRequestedColorMatch(input.requestedColorMatch);
	const xfadeSeconds =
		requestedXfadeSeconds ?? parseEnvironmentXfadeSeconds(input.environmentXfadeSeconds);
	const colorMatch =
		requestedColorMatch ?? parseEnvironmentColorMatch(input.environmentColorMatch);
	return {
		joinMode: xfadeSeconds > 0 ? "xfade" : "hard_cut",
		xfadeSeconds,
		colorMatch,
	};
}

export function validateVideoConcatTransitions(input: {
	clips: ConcatTransitionSpec[];
	policy: VideoConcatPolicy;
	isSupportedTransition: (transition: string) => boolean;
}): void {
	const firstTransition = input.clips[0]?.transition?.trim() ?? "";
	if (firstTransition) {
		throw new Error("clips[0]: transition is invalid because the first clip has no incoming seam");
	}
	for (let index = 1; index < input.clips.length; index += 1) {
		const transition = input.clips[index]?.transition?.trim() ?? "";
		if (input.policy.joinMode === "hard_cut") {
			if (transition) {
				throw new Error(
					`clips[${index}]: transition requires an explicit positive xfadeSeconds`,
				);
			}
			continue;
		}
		if (!transition) {
			throw new Error(
				`clips[${index}]: transition is required when xfadeSeconds is positive`,
			);
		}
		if (!input.isSupportedTransition(transition)) {
			throw new Error(`clips[${index}]: unsupported transition ${JSON.stringify(transition)}`);
		}
	}
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function beatSheetText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (!isRecord(value)) return "";
	return typeof value.text === "string" ? value.text.trim() : "";
}

/**
 * Validates the immutable fast-launch prefix without rewriting model output.
 * Equality is intentionally structural and exact: once the first supplier
 * submission can consume a Beat, the slower chapter planner may only append.
 */
export function validateAcceptedLaunchBeatPrefix(input: Readonly<{
	launchBeat: unknown;
	fullBeatSheetText: string;
}>): string | null {
	const launchText = beatSheetText(input.launchBeat);
	if (!launchText) return "launch-beat[0].text is required";
	let launchParsed: unknown;
	let fullParsed: unknown;
	try {
		launchParsed = JSON.parse(launchText);
		fullParsed = JSON.parse(input.fullBeatSheetText);
	} catch (error: unknown) {
		return `launch BeatSheet prefix is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (
		!isRecord(launchParsed) ||
		!Array.isArray(launchParsed.beats) ||
		launchParsed.beats.length !== 1 ||
		!isRecord(fullParsed) ||
		!Array.isArray(fullParsed.beats) ||
		fullParsed.beats.length === 0
	) return "launch BeatSheet must contain exactly one beat and full BeatSheet must contain at least one beat";
	if (JSON.stringify(fullParsed.beats[0]) !== JSON.stringify(launchParsed.beats[0])) {
		return "full BeatSheet beats[0] must exactly preserve the accepted launch Beat";
	}
	return null;
}

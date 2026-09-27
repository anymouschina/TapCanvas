export type VideoSizeShape = Readonly<{
	 aspectRatio: string | null;
	orientation: "portrait" | "landscape" | null;
}>;

function parsePositivePair(value: string, separator: string): readonly [number, number] | null {
	const parts = value.split(separator);
	if (parts.length !== 2) return null;
	const first = Number(parts[0]?.trim());
	const second = Number(parts[1]?.trim());
	if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) {
		return null;
	}
	return [first, second];
}

function greatestCommonDivisor(first: number, second: number): number {
	let a = Math.abs(Math.trunc(first));
	let b = Math.abs(Math.trunc(second));
	while (b !== 0) {
		const remainder = a % b;
		a = b;
		b = remainder;
	}
	return a || 1;
}

/**
 * Derive frame ratio and orientation from a structural dimension token.
 * This is shared by model-option projection and provider-boundary validation.
 */
export function deriveVideoSizeShape(value: string): VideoSizeShape {
	const trimmed = value.trim();
	const pair = parsePositivePair(trimmed, ":") ??
		parsePositivePair(trimmed, "x") ??
		parsePositivePair(trimmed, "*") ??
		parsePositivePair(trimmed, "×");
	if (!pair) return { aspectRatio: null, orientation: null };
	const [width, height] = pair;
	const integralPair = Number.isInteger(width) && Number.isInteger(height);
	const divisor = integralPair ? greatestCommonDivisor(width, height) : 1;
	const aspectRatio = integralPair
		? `${Math.trunc(width / divisor)}:${Math.trunc(height / divisor)}`
		: `${width}:${height}`;
	const orientation = width === height ? null : width > height ? "landscape" : "portrait";
	return { aspectRatio, orientation };
}

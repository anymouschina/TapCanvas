/**
 * Structural character identity contract shared by asset planning and image
 * execution.  This module deliberately does not inspect prompt prose: the
 * Agent/character-card skill owns the meaning of identity facts, while this
 * layer only preserves the declared identity fields and rejects malformed
 * identity-board structure.
 */

export type CharacterIdentityBoardSpec = Readonly<{
	layout: "identity_board_four_view";
	faceViews: readonly ["front", "profile"];
	fullBodyViews: readonly ["front", "back"];
	crossViewConsistency: true;
	referenceRoleIsolation: true;
	neutralReferenceBackground: true;
	readableTextVisible: true;
	brandingVisible: false;
	neutralBaseState: true;
	canonicalNameVisible: false;
	ipSafeOriginal: true;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function exactArray<T extends string>(value: unknown, expected: readonly T[]): value is readonly T[] {
	return Array.isArray(value)
		&& value.length === expected.length
		&& value.every((entry, index) => entry === expected[index]);
}

/**
 * Parse the identity-board/v3 shape without inventing missing values.  The
 * board is optional at legacy boundaries, but whenever supplied it must be the
 * complete executable four-view contract emitted by tapcanvas-character-card.
 */
export function parseCharacterIdentityBoardSpec(
	value: unknown,
	field: string,
): CharacterIdentityBoardSpec | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw new Error(`${field} must be an object`);
	if (value.layout !== "identity_board_four_view") throw new Error(`${field}.layout must equal identity_board_four_view`);
	if (!exactArray(value.faceViews, ["front", "profile"] as const)) {
		throw new Error(`${field}.faceViews must equal [front, profile]`);
	}
	if (!exactArray(value.fullBodyViews, ["front", "back"] as const)) {
		throw new Error(`${field}.fullBodyViews must equal [front, back]`);
	}
	const exactBooleans: Readonly<Record<string, boolean>> = {
		crossViewConsistency: true,
		referenceRoleIsolation: true,
		neutralReferenceBackground: true,
		readableTextVisible: true,
		brandingVisible: false,
		neutralBaseState: true,
		canonicalNameVisible: false,
		ipSafeOriginal: true,
	};
	for (const [key, expected] of Object.entries(exactBooleans)) {
		if (value[key] !== expected) throw new Error(`${field}.${key} must equal ${String(expected)}`);
	}
	const allowedFields = new Set([
		"layout",
		"faceViews",
		"fullBodyViews",
		...Object.keys(exactBooleans),
	]);
	const unexpectedField = Object.keys(value).find((key) => !allowedFields.has(key));
	if (unexpectedField) throw new Error(`${field}.${unexpectedField} is not allowed`);
	return {
		layout: "identity_board_four_view",
		faceViews: ["front", "profile"],
		fullBodyViews: ["front", "back"],
		crossViewConsistency: true,
		referenceRoleIsolation: true,
		neutralReferenceBackground: true,
		readableTextVisible: true,
		brandingVisible: false,
		neutralBaseState: true,
		canonicalNameVisible: false,
		ipSafeOriginal: true,
	};
}

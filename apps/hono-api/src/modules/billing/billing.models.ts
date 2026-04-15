export type BillingModelKind = "text" | "image" | "video";

function stripModelsPrefix(modelKey: string): string {
	const raw = (modelKey || "").trim();
	if (!raw) return "";
	return raw.startsWith("models/") ? raw.slice(7) : raw;
}

function stripOrientationSegments(modelKey: string): string {
	let key = (modelKey || "").trim();
	if (!key) return "";

	// Treat landscape/portrait as parameter variants (not different models).
	key = key.replace(/-landscape(?=-|$)/g, "");
	key = key.replace(/-portrait(?=-|$)/g, "");
	key = key.replace(/_landscape(?=_|$)/g, "");
	key = key.replace(/_portrait(?=_|$)/g, "");

	// Cleanup duplicated separators that may appear after stripping.
	key = key.replace(/--+/g, "-").replace(/__+/g, "_");
	key = key.replace(/^-+/, "").replace(/-+$/, "");
	key = key.replace(/^_+/, "").replace(/_+$/, "");

	return key;
}

function canonicalizeModelFamily(modelKey: string): string {
	return (modelKey || "").trim();
}

export function normalizeBillingModelKey(
	modelKey: string | null | undefined,
): string {
	const base = stripModelsPrefix(typeof modelKey === "string" ? modelKey : "");
	return canonicalizeModelFamily(stripOrientationSegments(base));
}

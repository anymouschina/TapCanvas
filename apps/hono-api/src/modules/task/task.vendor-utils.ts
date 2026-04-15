export function normalizeBaseUrl(raw: string | null | undefined): string {
	const val = (raw || "").trim();
	if (!val) return "";
	return val.replace(/\/+$/, "");
}

export function normalizeVendorKey(vendor: string): string {
	const v = (vendor || "").trim().toLowerCase();
	// Backward/alias compatibility: treat "google" as Gemini.
	if (v === "google") return "gemini";
	return v;
}

export function extractChannelVendor(
	vendorKey: string,
): "grsai" | "comfly" | "apimart" | "yunwu" | null {
	const v = normalizeVendorKey(vendorKey);
	if (!v) return null;
	if (v === "apimart" || v.startsWith("apimart-") || v.startsWith("apimart:")) {
		return "apimart";
	}
	if (v === "comfly" || v.startsWith("comfly-") || v.startsWith("comfly:")) {
		return "comfly";
	}
	if (v === "grsai" || v.startsWith("grsai-") || v.startsWith("grsai:")) {
		return "grsai";
	}
	if (v === "yunwu" || v.startsWith("yunwu-") || v.startsWith("yunwu:")) {
		return "yunwu";
	}
	return null;
}

export function isGrsaiBaseUrl(url: string): boolean {
	const val = url.toLowerCase();
	return val.includes("grsai");
}

export function isApimartBaseUrl(url: string): boolean {
	const val = (url || "").toLowerCase();
	return val.includes("apimart.ai");
}

export function isYunwuBaseUrl(url: string): boolean {
	const val = (url || "").toLowerCase();
	return val.includes("yunwu.ai");
}

export function normalizeYunwuBaseUrl(url: string): string {
	const normalized = normalizeBaseUrl(url);
	return normalized.replace(/\/v1$/i, "");
}

export function normalizeApimartBaseUrl(url: string): string {
	const normalized = normalizeBaseUrl(url);
	return normalized.replace(/\/v1$/i, "");
}

export function expandProxyVendorKeys(vendor: string): string[] {
	const v = normalizeVendorKey(vendor);
	const keys = [v];
	return Array.from(new Set(keys));
}

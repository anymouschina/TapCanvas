export function normalizeDispatchVendor(vendor: string): string {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return "";
	// allow composite vendors like "comfly:veo"
	const parts = raw.split(":").map((p) => p.trim()).filter(Boolean);
	const last = parts.length ? parts[parts.length - 1]! : raw;
	// Alias compatibility: google -> gemini
	if (last === "google") return "gemini";
	return last;
}

export function normalizeProxyVendorHint(vendor: string): string | null {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return null;
	const head = raw.split(":")[0]?.trim() || raw;
	if (head === "comfly" || raw.startsWith("comfly-")) return "comfly";
	if (head === "grsai" || raw.startsWith("grsai-")) return "grsai";
	if (head === "apimart" || raw.startsWith("apimart-")) return "apimart";
	if (head === "yunwu" || raw.startsWith("yunwu-")) return "yunwu";
	return null;
}

export function shouldUseGrsaiDrawPollingForImageTask(vendor: string): boolean {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return false;
	// Legacy compatibility: Gemini image tasks are polled via grsai draw result.
	if (raw === "gemini" || raw === "google") return true;
	// Banana/grsai draw vendor refs are stored like "grsai-nano-banana-*" / "comfly-*" / "apimart-*".
	if (raw === "grsai" || raw.startsWith("grsai-") || raw.startsWith("grsai:")) return true;
	if (raw === "comfly" || raw.startsWith("comfly-") || raw.startsWith("comfly:")) return true;
	if (raw.startsWith("apimart-") || raw.startsWith("apimart:")) return true;
	return false;
}


/**
 * Structural SSRF boundary for public API URLs.
 *
 * This intentionally does not inspect user meaning or media content. It only
 * limits server-side fetches to public HTTP(S) URL shapes and rejects literal
 * loopback/private/link-local targets.
 */
export function isSafePublicHttpUrl(url: URL): boolean {
	if (url.protocol !== "http:" && url.protocol !== "https:") return false;
	const host = url.hostname.toLowerCase();
	if (!host) return false;
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
		return false;
	}
	if (host.includes(":")) {
		if (host === "::1") return false;
		if (host.startsWith("fc") || host.startsWith("fd")) return false;
		if (host.startsWith("fe80")) return false;
		return true;
	}
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!ipv4) return true;
	const octets = ipv4.slice(1).map(Number);
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	const [first, second] = octets;
	if (first === 0 || first === 10 || first === 127) return false;
	if (first === 169 && second === 254) return false;
	if (first === 172 && second !== undefined && second >= 16 && second <= 31) return false;
	if (first === 192 && second === 168) return false;
	if (first === 100 && second !== undefined && second >= 64 && second <= 127) return false;
	return true;
}

export function parseSafePublicHttpUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		return isSafePublicHttpUrl(url) ? url : null;
	} catch {
		return null;
	}
}

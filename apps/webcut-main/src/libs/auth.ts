const TOKEN_COOKIE = "tap_token";

function readCookie(name: string): string | null {
	const match = document.cookie.match(
		new RegExp(`(?:^|; )${name.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&")}=([^;]*)`),
	);
	return match ? decodeURIComponent(match[1]) : null;
}

export function getAuthToken(): string | null {
	if (typeof localStorage !== "undefined") {
		const cached = localStorage.getItem(TOKEN_COOKIE);
		if (cached) return cached;
	}
	return readCookie(TOKEN_COOKIE);
}

export function persistAuthToken(token: string) {
	if (!token) return;
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(TOKEN_COOKIE, token);
		}
		document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
	} catch {
		// ignore storage errors
	}
}

export function bootstrapAuthFromUrl(paramKey = "tap_token"): void {
	if (typeof window === "undefined") return;
	let nextUrl: string | null = null;
	try {
		const url = new URL(window.location.href);
		const token = url.searchParams.get(paramKey);
		if (token) {
			persistAuthToken(token);
			url.searchParams.delete(paramKey);
			nextUrl = url.toString();
		}
	} catch {
		// ignore parse errors
	}
	if (nextUrl && nextUrl !== window.location.href) {
		try {
			window.history.replaceState({}, document.title, nextUrl);
		} catch {
			window.location.replace(nextUrl);
		}
	}
}

/**
 * fetch 带上 tap_token（Cookie / Authorization header），并默认允许跨域携带凭证。
 */
export function authFetch(
	input: RequestInfo | URL,
	init: RequestInit = {},
): Promise<Response> {
	const token = getAuthToken();
	const headers = new Headers(init.headers || {});
	if (token && !headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${token}`);
	}
	return fetch(input, {
		credentials: init.credentials ?? "include",
		...init,
		headers,
	});
}

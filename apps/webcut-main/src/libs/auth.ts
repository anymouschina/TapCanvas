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

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

/**
 * 智能选择是否携带鉴权信息：
 * - 同源 / API_BASE（需要鉴权） => authFetch
 * - 其他跨域公共资源（如 R2 公有桶） => fetch(credentials: omit)
 */
export function maybeAuthFetch(
	input: RequestInfo | URL,
	init: RequestInit = {},
): Promise<Response> {
	const urlStr =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.toString()
				: (input as Request).url;

	// 相对路径默认走鉴权 fetch
	if (!/^https?:\/\//i.test(urlStr)) {
		return authFetch(input, init);
	}

	try {
		const parsed = new URL(
			urlStr,
			typeof window !== "undefined" ? window.location.href : undefined,
		);
		const currentOrigin =
			typeof window !== "undefined" ? window.location.origin : parsed.origin;

		const apiBase = (() => {
			const configured = (import.meta.env.VITE_API_BASE as string | undefined) || "";
			if (configured.trim()) return configured.trim();
			// Local dev fallback: WebCut often runs on `localhost:5174` while API runs on `localhost:8788`.
			if (typeof window !== "undefined") {
				const host = window.location.hostname;
				if (host === "localhost" || host === "127.0.0.1") {
					return "http://localhost:8788";
				}
			}
			return "https://hono-api.beqlee.icu";
		})();
		let apiOrigin = "";
		try {
			apiOrigin = new URL(apiBase).origin;
		} catch {
			apiOrigin = "";
		}

		if (parsed.origin === currentOrigin || (apiOrigin && parsed.origin === apiOrigin)) {
			return authFetch(input, init);
		}
	} catch {
		// URL 解析失败时回退到鉴权 fetch
		return authFetch(input, init);
	}

	// 跨域公共资源默认不带凭证，避免 "*" + include 的 CORS 冲突
	return fetch(input, {
		...init,
		credentials: init.credentials ?? "omit",
	});
}

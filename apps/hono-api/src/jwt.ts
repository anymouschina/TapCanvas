const encoder = new TextEncoder();

function base64UrlEncode(input: string | ArrayBuffer): string {
	const toBase64 = (str: string) => btoa(str);

	if (typeof input === "string") {
		return toBase64(input)
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "");
	}

	const bytes = new Uint8Array(input);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i += 1) {
		binary += String.fromCharCode(bytes[i]);
	}

	return toBase64(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlDecodeToString(segment: string): string {
	let base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
	const pad = base64.length % 4;
	if (pad) {
		base64 += "=".repeat(4 - pad);
	}
	return atob(base64);
}

export async function signJwtHS256(
	payload: Record<string, unknown>,
	secret: string,
	expiresInSeconds: number,
): Promise<string> {
	const header = { alg: "HS256", typ: "JWT" };
	const now = Math.floor(Date.now() / 1000);
	const body = { ...payload, iat: now, exp: now + expiresInSeconds };

	const headerSegment = base64UrlEncode(JSON.stringify(header));
	const payloadSegment = base64UrlEncode(JSON.stringify(body));
	const unsignedToken = `${headerSegment}.${payloadSegment}`;

	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{
			name: "HMAC",
			hash: "SHA-256",
		},
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(unsignedToken),
	);

	const signatureSegment = base64UrlEncode(signature);

	return `${unsignedToken}.${signatureSegment}`;
}

export async function verifyJwtHS256<TPayload = any>(
	token: string,
	secret: string,
): Promise<TPayload | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	const [headerSegment, payloadSegment, signatureSegment] = parts;
	const unsignedToken = `${headerSegment}.${payloadSegment}`;

	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{
			name: "HMAC",
			hash: "SHA-256",
		},
		false,
		["sign"],
	);

	const expectedSignature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(unsignedToken),
	);
	const expectedSigSegment = base64UrlEncode(expectedSignature);

	if (expectedSigSegment !== signatureSegment) {
		return null;
	}

	let payloadJson: string;
	try {
		payloadJson = base64UrlDecodeToString(payloadSegment);
	} catch {
		return null;
	}

	let payload: any;
	try {
		payload = JSON.parse(payloadJson);
	} catch {
		return null;
	}

	if (payload && typeof payload.exp === "number") {
		const now = Math.floor(Date.now() / 1000);
		if (now >= payload.exp) {
			return null;
		}
	}

	return payload as TPayload;
}


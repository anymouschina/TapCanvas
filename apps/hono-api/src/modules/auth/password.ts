const PASSWORD_PBKDF2_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;

function hexFromArrayBuffer(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let output = "";
	for (const byte of bytes) {
		output += byte.toString(16).padStart(2, "0");
	}
	return output;
}

async function derivePasswordHash(password: string, salt: string): Promise<string> {
	const encoder = new TextEncoder();
	const importedKey = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: encoder.encode(salt),
			iterations: PASSWORD_PBKDF2_ITERATIONS,
		},
		importedKey,
		PASSWORD_KEY_LENGTH * 8,
	);
	return hexFromArrayBuffer(bits);
}

export async function createPasswordRecord(password: string): Promise<{
	hash: string;
	salt: string;
}> {
	const salt = crypto.randomUUID();
	const hash = await derivePasswordHash(password, salt);
	return { hash, salt };
}

export async function verifyPasswordRecord(options: {
	password: string;
	hash: string;
	salt: string;
}): Promise<boolean> {
	const derivedHash = await derivePasswordHash(options.password, options.salt);
	return derivedHash === options.hash;
}

export function hasPasswordConfigured(passwordHash: string | null | undefined): boolean {
	return typeof passwordHash === "string" && passwordHash.trim().length > 0;
}

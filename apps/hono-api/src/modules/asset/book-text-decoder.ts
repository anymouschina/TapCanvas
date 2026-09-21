export type BookTextEncoding = "utf-8" | "gb18030" | "utf-16le" | "utf-16be";

export function isBookTextEncoding(value: unknown): value is BookTextEncoding {
	return value === "utf-8" || value === "gb18030" || value === "utf-16le" || value === "utf-16be";
}

type DecodeAttempt = { encoding: BookTextEncoding; reason: string };
type DecodedBookText =
	| { ok: true; text: string; encoding: BookTextEncoding }
	| { ok: false; attempts: DecodeAttempt[] };

/** BOM is authoritative. Unmarked Chinese text uses strict UTF-8, then GB18030 (including GBK). */
export function decodeBookText(bytes: Uint8Array): DecodedBookText {
	let encodings: BookTextEncoding[];
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		encodings = ["utf-8"];
	} else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		encodings = ["utf-16le"];
	} else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		encodings = ["utf-16be"];
	} else {
		encodings = ["utf-8", "gb18030"];
	}
	const attempts: DecodeAttempt[] = [];
	for (const encoding of encodings) {
		// Construct outside the catch: an unsupported runtime codec is a configuration error.
		const decoder = new TextDecoder(encoding, { fatal: true });
		try {
			return { ok: true, text: decoder.decode(bytes), encoding };
		} catch (error) {
			if (!(error instanceof TypeError)) throw error;
			attempts.push({ encoding, reason: error.message });
		}
	}
	return { ok: false, attempts };
}

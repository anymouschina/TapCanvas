export async function installDomParserIfNeeded(): Promise<void> {
	if (typeof (globalThis as any).DOMParser !== "undefined") return;
	const isNode =
		typeof process !== "undefined" &&
		!!(process as any)?.versions?.node;
	if (!isNode) return;
	try {
		const mod = await import("@xmldom/xmldom");
		(globalThis as any).DOMParser = mod.DOMParser;
	} catch {
		// If the dependency is missing, keep running without the polyfill.
	}
}

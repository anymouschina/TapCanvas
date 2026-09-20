/** Optional background: omission and blank strings mean no supplied image. */
export function parseBlockingBackground(value) {
    if (value === undefined)
        return { ok: true };
    if (typeof value === "string") {
        const url = value.trim();
        if (!url)
            return { ok: true };
        try {
            const parsed = new URL(url);
            if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) {
                return { ok: true, url };
            }
        }
        catch {
            // A supplied image must have a structurally valid absolute HTTP(S) URL.
        }
    }
    return { ok: false, errorMessage: "backgroundImageUrl 必须是可下载的 http(s) URL" };
}

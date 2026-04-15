export function normalizeMimeType(input: string | null | undefined): string {
	return String(input || "")
		.split(";")[0]
		.trim()
		.toLowerCase();
}

export function isSupportedImageMimeType(input: string | null | undefined): boolean {
	const mimeType = normalizeMimeType(input);
	return (
		mimeType === "image/jpeg" ||
		mimeType === "image/png" ||
		mimeType === "image/webp"
	);
}

export function isSupportedMappedVideoReferenceMimeType(
	input: string | null | undefined,
): boolean {
	const mimeType = normalizeMimeType(input);
	return mimeType === "video/mp4" || isSupportedImageMimeType(mimeType);
}

export function canContainPadMimeType(input: string | null | undefined): boolean {
	return isSupportedImageMimeType(input);
}

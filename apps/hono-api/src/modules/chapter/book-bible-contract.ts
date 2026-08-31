export const BOOK_BIBLE_ARTIFACTS = [
	{ type: "world", name: "世界观圣经" },
	{ type: "roster", name: "角色总表" },
	{ type: "redlines", name: "红线对照清单" },
	{ type: "ip_safe", name: "IP-safe替换表" },
] as const;

export type BookBibleArtifactType = typeof BOOK_BIBLE_ARTIFACTS[number]["type"];

const BOOK_BIBLE_ARTIFACT_TYPES = new Set<string>(
	BOOK_BIBLE_ARTIFACTS.map((artifact) => artifact.type),
);

export function readBookBibleArtifactType(
	data: Record<string, unknown>,
): BookBibleArtifactType | null {
	if (data.kind !== "text") return null;
	const value = typeof data.bookBibleType === "string" ? data.bookBibleType.trim() : "";
	return BOOK_BIBLE_ARTIFACT_TYPES.has(value) ? value as BookBibleArtifactType : null;
}

export function hasBookBibleArtifactContent(data: Record<string, unknown>): boolean {
	return [data.prompt, data.text, data.content].some((value) =>
		typeof value === "string" && value.trim().length > 0,
	);
}

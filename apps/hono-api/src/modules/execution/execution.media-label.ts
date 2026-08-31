type MediaLabelData = Readonly<Record<string, unknown>>;

function readString(data: MediaLabelData | null | undefined, key: string): string {
	const value = data?.[key];
	return typeof value === "string" ? value.trim() : "";
}

const IMAGE_KIND_LABELS = Object.freeze({
	character: "角色卡",
	scene: "场景卡",
	prop: "道具卡",
	vfx: "特效参考",
	palette: "色彩参考",
	composition: "构图参考",
} satisfies Readonly<Record<string, string>>);

/**
 * Canvas labels are projections of persisted structured identity facts. They
 * never inspect prompt prose, image pixels, file names, or opaque asset ids.
 */
export function workflowImageSemanticLabel(input: Readonly<{
	assetMetadata: MediaLabelData | null | undefined;
	itemIndex: number;
}>): string {
	const metadata = input.assetMetadata;
	const displayName = readString(metadata, "displayName")
		|| readString(metadata, "canonicalName")
		|| readString(metadata, "roleName");
	const referenceType = readString(metadata, "referenceType");
	const kindLabel = IMAGE_KIND_LABELS[referenceType];
	if (displayName && kindLabel) return `${displayName}${kindLabel}`;
	return `图片生成结果 ${input.itemIndex + 1}`;
}

export function workflowVideoSemanticLabel(input: Readonly<{
	structuredClip: MediaLabelData | null | undefined;
	itemIndex: number;
}>): string {
	const logline = readString(input.structuredClip, "logline");
	return logline
		? `第 ${input.itemIndex + 1} 段｜${logline}`
		: `第 ${input.itemIndex + 1} 段视频`;
}

export type WorkflowSourceLineCoordinates = readonly [startOffset: number, endOffset: number];

export type WorkflowSourceCoordinates = Readonly<{
	coordinateSystem: "utf16";
	interval: "start_inclusive_end_exclusive";
	startOffset: 0;
	endOffset: number;
	utf16Length: number;
	forbiddenSurrogateOffsets: readonly number[];
	lineColumns: readonly ["startOffset", "endOffset"];
	lines: readonly WorkflowSourceLineCoordinates[];
}>;

/** Layout coordinates only: preserve every code unit, including whitespace and line endings. */
export function buildWorkflowSourceCoordinates(content: string): WorkflowSourceCoordinates {
	const lines: WorkflowSourceLineCoordinates[] = [];
	const forbiddenSurrogateOffsets: number[] = [];
	let lineStart = 0;
	for (let offset = 0; offset < content.length; offset += 1) {
		const code = content.charCodeAt(offset);
		const nextCode = content.charCodeAt(offset + 1);
		if (code >= 0xd800 && code <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
			forbiddenSurrogateOffsets.push(offset + 1);
		}
		if (code !== 10 && code !== 13) continue;
		if (code === 13 && nextCode === 10) offset += 1;
		const endOffset = offset + 1;
		lines.push([lineStart, endOffset]);
		lineStart = endOffset;
	}
	if (lineStart < content.length) {
		lines.push([lineStart, content.length]);
	}
	return {
		coordinateSystem: "utf16",
		interval: "start_inclusive_end_exclusive",
		startOffset: 0,
		endOffset: content.length,
		utf16Length: content.length,
		forbiddenSurrogateOffsets,
		lineColumns: ["startOffset", "endOffset"],
		lines,
	};
}

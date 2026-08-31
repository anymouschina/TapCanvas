export type StoryPreviewTimedSection = Readonly<{
	startSeconds: number;
	endSeconds: number;
	text: string;
}>;

const TIMED_HEADING_PATTERN = /^\s*(?:#{1,6}\s*)?(?:■\s*)?[【\[]\s*(\d+(?:\.\d+)?)\s*(?:-|—|~|～|至)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*[】\]]/i;

export function readStoryPreviewTimedSections(source: string): StoryPreviewTimedSection[] {
	const lines = source.split(/\r?\n/u);
	const headings = lines.flatMap((line, lineIndex) => {
		const match = line.match(TIMED_HEADING_PATTERN);
		if (!match) return [];
		return [{ lineIndex, startSeconds: Number(match[1]), endSeconds: Number(match[2]) }];
	});
	return headings.flatMap((heading, index) => {
		if (!Number.isFinite(heading.startSeconds)
			|| !Number.isFinite(heading.endSeconds)
			|| heading.endSeconds <= heading.startSeconds) return [];
		const endLineIndex = headings[index + 1]?.lineIndex ?? lines.length;
		return [{
			startSeconds: heading.startSeconds,
			endSeconds: heading.endSeconds,
			text: lines.slice(heading.lineIndex, endLineIndex).join("\n").trim(),
		}];
	});
}

export function readStoryPreviewSourceWindow(input: {
	sourceNarrative: string;
	boardStartSeconds: number;
	boardEndSeconds: number;
}): string {
	const sections = readStoryPreviewTimedSections(input.sourceNarrative);
	if (sections.length === 0) return input.sourceNarrative.trim();
	return sections
		.filter((section) =>
			section.startSeconds < input.boardEndSeconds
			&& section.endSeconds > input.boardStartSeconds,
		)
		.map((section) => section.text)
		.join("\n")
		.trim();
}

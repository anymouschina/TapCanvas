type ChapterDisplayOrder = Readonly<{
	sourceBookChapter?: number | null;
	sortOrder: number;
	index: number;
	createdAt: string;
}>;

function compareDateAsc(left: string, right: string): number {
	const leftTs = Date.parse(left);
	const rightTs = Date.parse(right);
	return (Number.isFinite(leftTs) ? leftTs : 0) - (Number.isFinite(rightTs) ? rightTs : 0);
}

/** Source-book order is shared by chapter lists and all chapter deliveries. */
export function sortChaptersForDisplay<T extends ChapterDisplayOrder>(chapters: readonly T[]): T[] {
	return [...chapters].sort((left, right) => {
		const leftSource =
			typeof left.sourceBookChapter === "number" && Number.isFinite(left.sourceBookChapter)
				? Math.trunc(left.sourceBookChapter)
				: null;
		const rightSource =
			typeof right.sourceBookChapter === "number" && Number.isFinite(right.sourceBookChapter)
				? Math.trunc(right.sourceBookChapter)
				: null;
		if (leftSource !== null && rightSource !== null && leftSource !== rightSource) {
			return leftSource - rightSource;
		}
		if (leftSource !== null && rightSource === null) return -1;
		if (leftSource === null && rightSource !== null) return 1;
		if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
		if (left.index !== right.index) return left.index - right.index;
		return compareDateAsc(left.createdAt, right.createdAt);
	});
}

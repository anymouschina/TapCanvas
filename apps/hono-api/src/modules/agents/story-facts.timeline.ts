import type {
	StoryFactDisclosure,
	StoryFactRecord,
	StoryPoint,
} from "./story-facts.schemas";

export function compareStoryPoints(left: StoryPoint, right: StoryPoint): number {
	if (left.chapter !== right.chapter) return left.chapter - right.chapter;
	return left.sequence - right.sequence;
}

export function isStoryFactActiveAt(fact: StoryFactRecord, point: StoryPoint): boolean {
	if (compareStoryPoints(fact.validFrom, point) > 0) return false;
	return fact.validUntil === null || compareStoryPoints(point, fact.validUntil) < 0;
}

export function isStoryFactDisclosedAt(
	disclosure: StoryFactDisclosure,
	point: StoryPoint,
): boolean {
	return disclosure.mode === "immediate" || compareStoryPoints(point, disclosure.revealAt) >= 0;
}

export function storyFactDisclosureEquals(
	left: StoryFactDisclosure,
	right: StoryFactDisclosure,
): boolean {
	if (left.mode !== right.mode) return false;
	if (left.mode === "immediate" && right.mode === "immediate") return true;
	if (left.mode !== "gated" || right.mode !== "gated") return false;
	return (
		left.revealAt.chapter === right.revealAt.chapter &&
		left.revealAt.sequence === right.revealAt.sequence &&
		(left.revealAt.label ?? null) === (right.revealAt.label ?? null)
	);
}

export function assertStoryFactDisclosureWindow(input: {
	factId: string;
	validFrom: StoryPoint;
	disclosure: StoryFactDisclosure;
}): void {
	if (input.disclosure.mode === "immediate") return;
	if (compareStoryPoints(input.disclosure.revealAt, input.validFrom) > 0) return;
	throw new Error(
		`Story fact ${input.factId} uses gated disclosure but revealAt is not later than validFrom`,
	);
}

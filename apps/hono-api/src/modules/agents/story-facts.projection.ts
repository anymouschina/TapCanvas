import type {
	StoryFactDisclosure,
	StoryFactRecord,
	StoryFactStatus,
	StoryPoint,
} from "./story-facts.schemas";
import { isStoryFactDisclosedAt } from "./story-facts.timeline";

export type AudienceVisibleStoryFact = StoryFactRecord & {
	audienceVisibility: "visible";
};

export type AudienceHiddenStoryFact = {
	audienceVisibility: "hidden";
	factId: string;
	category: string;
	status: StoryFactStatus;
	disclosure: Extract<StoryFactDisclosure, { mode: "gated" }>;
};

export type AudienceStoryFactProjection =
	| AudienceVisibleStoryFact
	| AudienceHiddenStoryFact;

export function projectStoryFactForAudience(input: {
	fact: StoryFactRecord;
	at: StoryPoint;
}): AudienceStoryFactProjection {
	if (isStoryFactDisclosedAt(input.fact.disclosure, input.at)) {
		return {
			...structuredClone(input.fact),
			audienceVisibility: "visible",
		};
	}
	if (input.fact.disclosure.mode !== "gated") {
		throw new Error("Immediate story fact unexpectedly evaluated as hidden");
	}
	return {
		audienceVisibility: "hidden",
		factId: input.fact.factId,
		category: input.fact.subject.kind,
		status: input.fact.status,
		disclosure: structuredClone(input.fact.disclosure),
	};
}

export function projectStoryFactsForAudience(input: {
	facts: readonly StoryFactRecord[];
	at: StoryPoint;
}): AudienceStoryFactProjection[] {
	return input.facts.map((fact) => projectStoryFactForAudience({ fact, at: input.at }));
}

import type { z } from "zod";
import type { CapabilityRouteDecisionSchema } from "./capability-bay.schemas";

type RouteDecision = z.infer<typeof CapabilityRouteDecisionSchema>;

/** New choices supersede old choices for the same capability; unchanged grants survive updates. */
export function mergeWorkflowRouteDecisions(input: Readonly<{
	previous: readonly RouteDecision[];
	current: readonly RouteDecision[];
	requiredSkills: readonly string[];
	nonReplaceableCapabilityIds: readonly string[];
}>): RouteDecision[] {
	const choices = input.current.filter((decision) => decision.action !== "acknowledge");
	const decidedTargets = new Set(choices.map((decision) => decision.withCapabilityId));
	const currentIds = new Set(choices.map((decision) => decision.conflictId));
	const protectedTargets = new Set([...input.requiredSkills, ...input.nonReplaceableCapabilityIds]);
	const preserved = input.previous.filter((decision) => (
		decision.action !== "acknowledge"
		&& decision.withCapabilityId !== null
		&& !decidedTargets.has(decision.withCapabilityId)
		&& !currentIds.has(decision.conflictId)
		&& (decision.action !== "replace_existing" || !protectedTargets.has(decision.withCapabilityId))
	));
	const preservedIds = new Set(preserved.map((decision) => decision.conflictId));
	return [...preserved, ...input.current.filter((decision) => !preservedIds.has(decision.conflictId))];
}

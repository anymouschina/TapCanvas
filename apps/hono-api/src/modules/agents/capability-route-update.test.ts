import { describe, expect, it } from "vitest";
import { mergeWorkflowRouteDecisions } from "./capability-route-update";

const replacement = { conflictId: "previous", withCapabilityId: "builtin:one_click_video", action: "replace_existing" as const };
const input = { previous: [replacement], current: [], requiredSkills: [], nonReplaceableCapabilityIds: [] };
describe("workflow replacement updates", () => {
	it("preserves the system-wide primary route when the new report omits an already replaced capability", () => {
		expect(mergeWorkflowRouteDecisions(input)).toEqual([replacement]);
	});
	it("does not let informational acknowledgements revoke confirmed routes", () => {
		const acknowledgement = { ...replacement, action: "acknowledge" as const };
		expect(mergeWorkflowRouteDecisions({ ...input, current: [acknowledgement] })).toEqual([replacement]);
		const coexist = { ...replacement, action: "coexist" as const };
		expect(mergeWorkflowRouteDecisions({ ...input, previous: [coexist], current: [acknowledgement] })).toEqual([coexist]);
	});
	it("lets the newest explicit decision override a previous replacement", () => {
		const current = [{ ...replacement, conflictId: "new", action: "coexist" as const }];
		expect(mergeWorkflowRouteDecisions({ ...input, current })).toEqual(current);
	});
	it("removes obsolete replacements of required skills and protected primitives", () => {
		expect(mergeWorkflowRouteDecisions({ ...input, requiredSkills: [replacement.withCapabilityId] })).toEqual([]);
		expect(mergeWorkflowRouteDecisions({ ...input, nonReplaceableCapabilityIds: [replacement.withCapabilityId] })).toEqual([]);
	});
});

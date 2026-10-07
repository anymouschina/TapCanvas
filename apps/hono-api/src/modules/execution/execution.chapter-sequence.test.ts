import { describe, expect, it } from "vitest";
import { globalSequenceFixture } from "./execution.chapter-sequence.fixture";
import { bindChapterScriptAuthoringContract, projectChapterSequence } from "./execution.chapter-sequence";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";

function projection(sequence?: unknown, contract?: unknown) {
	const fixture = globalSequenceFixture();
	return projectChapterSequence({ executionId: "e", nodeId: "n", sequence: sequence ?? fixture.sequence, deliveryContract: contract ?? fixture.deliveryContract });
}

describe("ordered chapter sequence projection", () => {
	it("preserves ordered events and shared edges without creating event clocks", () => {
		const fixture = globalSequenceFixture(); const result = projection();
		const [first, second] = result.clipCollection.items.map((item) => item.value);
		expect(result.chapterSequence.protocolVersion).toBe("tapcanvas.chapter-sequence-bound/v2");
		expect(result.chapterSequence.storyEvents).toEqual(fixture.sequence.storyEvents);
		expect(first).toMatchObject({ clipId: "clip-1", durationSeconds: 30, globalStartSeconds: 0, globalEndSeconds: 30 });
		expect(second).toMatchObject({ clipId: "clip-2", durationSeconds: 30, globalStartSeconds: 30, globalEndSeconds: 60 });
		expect(first!.storyEvents.map((event) => event.eventId)).toEqual(["setup", "engage", "continuous-strike"]);
		expect(second!.storyEvents.map((event) => event.eventId)).toEqual(["climax", "ending"]);
		expect(first!.endKeyframe).toEqual(second!.startKeyframe);
		for (const event of first!.storyEvents) { expect(event).not.toHaveProperty("startSeconds"); expect(event).not.toHaveProperty("globalEndSeconds"); }
	});
	it("provides neighboring content in order instead of clock-clipped fragments", () => {
		const [first, second] = projection().clipCollection.items.map((item) => item.value);
		expect(first!.previousBoundary).toBeNull(); expect(second!.nextBoundary).toBeNull();
		expect(first!.nextBoundary!.storyEvents.map((event) => [event.eventId, event.eventIndex])).toEqual([["climax", 3], ["ending", 4]]);
		expect(second!.previousBoundary!.storyEvents.map((event) => event.eventId)).toEqual(["setup", "engage", "continuous-strike"]);
	});
	it("keeps source ranges, slices and collection lineage", () => {
		const fixture = globalSequenceFixture(); const result = projection();
		const [first, second] = result.sourceSegmentsCollection.items.map((item) => item.value);
		expect(first!.sourceRanges).toEqual(fixture.sequence.storyEvents[0]!.sourceRanges);
		expect(second!.sourceSlices).toEqual(first!.sourceSlices);
		expect(first!.sourceSlices[0]!.text).toBe(fixture.deliveryContract.canvasFacts.authoritativeSources[0]!.content);
		expect(result.clipCollection.items[0]!.lineage.at(-1)?.portId).toBe("clip-sequences");
		expect(result.sourceReceipt).toMatchObject({ totalDurationSeconds: 60, clipIds: ["clip-1", "clip-2"] });
	});
	it("projects a complete speech instruction once by explicit ownership", () => {
		const fixture = globalSequenceFixture();
		const speech = { speechEventId: "voice", eventIndex: 1, clipId: "clip-1", sceneId: "fight", scope: "beat", storyEventId: "engage", speaker: "主角", delivery: "坚定", text: "来吧！", textOrigin: "authored", sourceRanges: [] };
		const sequence = { ...fixture.sequence, speechEvents: [speech], clips: fixture.sequence.clips.map((clip, index) => ({ ...clip, speechEventIds: index === 0 ? ["voice"] : [] })) };
		const result = projection(sequence);
		expect(result.clipCollection.items[0]!.value.speechEvents).toEqual([speech]);
		expect(result.clipCollection.items[1]!.value.speechEvents).toEqual([]);
	});
	it("keeps creative notes optional and verifies frozen source identities", () => {
		const fixture = globalSequenceFixture(); const bound = bindChapterScriptAuthoringContract({ allowedFields: [] }, fixture.deliveryContract);
		expect(bound.jsonSchema!.required).not.toContain("authoringRecord");
		const bad = { ...fixture.sequence, authoringRecord: { sourceAssessment: "读取", approach: "写作", actions: [], review: { findings: [], revisions: [] }, sourceIds: ["unknown"] } };
		expect(() => projection(bad)).toThrow(/outside the frozen delivery contract/);
		expect(projection().chapterSequence).not.toHaveProperty("authoringRecord");
	});
	it("checks real provider durations, user totals, counts and submission edges", () => {
		const fixture = globalSequenceFixture();
		expect(() => projection({ ...fixture.sequence, totalDurationSeconds: 59 })).toThrow(/clip windows total/);
		expect(() => projection({ ...fixture.sequence, clips: fixture.sequence.clips.map((clip) => ({ ...clip, durationSeconds: 15 })), totalDurationSeconds: 30 })).toThrow(/frozen target/);
		expect(() => projection({ ...fixture.sequence, boundaries: fixture.sequence.boundaries.slice(1) })).toThrow(/one shared boundary/);
	});
	it("checks identity, order and complete clip references without semantic scoring", () => {
		const fixture = globalSequenceFixture();
		expect(() => projection({ ...fixture.sequence, storyEvents: fixture.sequence.storyEvents.map((event, index) => index === 1 ? { ...event, eventIndex: 5 } : event) })).toThrow(/ordered event identity/);
		expect(() => projection({ ...fixture.sequence, clips: fixture.sequence.clips.map((clip, index) => index === 0 ? { ...clip, storyEventIds: ["setup"] } : clip) })).toThrow(/ordered events exactly once/);
		expect(() => projection({ ...fixture.sequence, storyEvents: fixture.sequence.storyEvents.map((event, index) => index === 4 ? { ...event, clipId: "clip-1" } : event) })).toThrow(/declared clip order/);
	});
	it("rejects source coordinates beyond the immutable source", () => {
		const fixture = globalSequenceFixture();
		const bad = { ...fixture.sequence, storyEvents: fixture.sequence.storyEvents.map((event, index) => index === 0 ? { ...event, sourceRanges: event.sourceRanges.map((range) => ({ ...range, endOffset: 999999 })) } : event) };
		expect(() => projection(bad)).toThrow(/frozen UTF-16 source coordinates/);
	});
	it("structurally rejects the prior event clock protocol", () => {
		const fixture = globalSequenceFixture();
		expect(() => projection({ ...fixture.sequence, protocolVersion: "tapcanvas.chapter-sequence/v3" })).toThrow(/must equal/);
		const bound = bindChapterScriptAuthoringContract({ allowedFields: [] }, fixture.deliveryContract);
		expect(validateWorkflowToolArguments(bound.jsonSchema!, { wholeFilmIntent: "test", scenes: [] })).not.toEqual([]);
	});
});

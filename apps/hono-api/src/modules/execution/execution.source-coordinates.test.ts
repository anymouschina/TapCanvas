import { describe, expect, it } from "vitest";
import { buildWorkflowSourceCoordinates } from "./execution.source-coordinates";

describe("frozen source coordinates", () => {
	it("preserves CRLF, bare CR, empty lines, leading spaces and the final newline in contiguous ranges", () => {
		const content = " 甲\r\n\r\n乙\r丙\n";
		const coordinates = buildWorkflowSourceCoordinates(content);
		expect(coordinates).toMatchObject({ coordinateSystem: "utf16", startOffset: 0, endOffset: 10, utf16Length: 10 });
		expect(coordinates.lines).toEqual([
			[0, 4], [4, 6], [6, 8], [8, 10],
		]);
		expect(coordinates.lineColumns).toEqual(["startOffset", "endOffset"]);
		expect(coordinates.lines.map(([start, end]) => content.slice(start, end)).join("")).toBe(content);
	});

	it("records UTF-16 bounds and forbidden surrogate cuts without counting emoji as one code unit", () => {
		const coordinates = buildWorkflowSourceCoordinates("甲👩‍🚀\n乙😀");
		expect(coordinates.utf16Length).toBe(10);
		expect(coordinates.forbiddenSurrogateOffsets).toEqual([2, 5, 9]);
		expect(coordinates.lines).toEqual([
			[0, 7], [7, 10],
		]);
	});

	it("reports an unbroken long source as one exact layout range without inventing semantic breaks", () => {
		const content = "甲".repeat(12_000);
		expect(buildWorkflowSourceCoordinates(content).lines).toEqual([[0, 12_000]]);
		expect(buildWorkflowSourceCoordinates("")).toMatchObject({ utf16Length: 0, endOffset: 0, lines: [] });
	});
});

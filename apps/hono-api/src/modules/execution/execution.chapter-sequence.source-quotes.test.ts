import { describe, expect, it } from "vitest";
import { bindChapterSequenceQuoteRanges, locateSourceQuote } from "./execution.chapter-sequence.source-quotes";

const source = (content: string) => ({ sourceId: "chapter", sourceFingerprint: "sha256:chapter", content });
const slice = (content: string, ranges: readonly { startOffset: number; endOffset: number }[]) =>
	ranges.map((range) => content.slice(range.startOffset, range.endOffset)).join("");

describe("host-bound speech source ranges", () => {
	it("locates verbatim quotes in dialogue order and leaves authored lines without ranges", () => {
		const content = "“好。”他说。门开了。“好。”她也说。“你为什么来？”";
		const bound = bindChapterSequenceQuoteRanges({ speechEvents: [
			{ text: "好。", textOrigin: "source_quote" },
			{ text: "我自己编的。", textOrigin: "authored", sourceRanges: [{ sourceIndex: 0 }] },
			{ text: "好。", textOrigin: "source_quote" },
			{ text: "你为什么来？", textOrigin: "source_quote" },
		] }, [source(content)]) as { speechEvents: Array<{ text: string; sourceRanges: Array<{ startOffset: number; endOffset: number; sourceId: string }> }> };
		const [first, authored, second, third] = bound.speechEvents;
		expect(first!.sourceRanges).toEqual([{ sourceIndex: 0, startOffset: 1, endOffset: 3, sourceId: "chapter", sourceFingerprint: "sha256:chapter" }]);
		expect(authored!.sourceRanges).toEqual([]);
		// The repeated line binds to its next occurrence after the previous quote, not the first one again.
		expect(second!.sourceRanges[0]!.startOffset).toBe(content.indexOf("好。", 3));
		expect(slice(content, third!.sourceRanges)).toBe("你为什么来？");
	});

	it("binds a quote that skips a short narration interjection with UTF-16 offsets", () => {
		const content = "“𠮷先生，”她顿了顿，“请坐。”";
		const located = locateSourceQuote("𠮷先生，请坐。", [source(content)]);
		expect(located?.ranges).toHaveLength(2);
		expect(slice(content, located!.ranges)).toBe("𠮷先生，请坐。");
	});

	it("never joins a quote across a paragraph break and binds each paragraph as its own speech event", () => {
		const content = "他看着我。“学费的事你不用担心。”\n“人家已经给我免了。”\n我愣住了。";
		expect(locateSourceQuote("学费的事你不用担心。人家已经给我免了。", [source(content)])).toBeNull();
		expect(() => bindChapterSequenceQuoteRanges({ speechEvents: [
			{ text: "学费的事你不用担心。人家已经给我免了。", textOrigin: "source_quote" },
		] }, [source(content)])).toThrow(/own speech event/);
		const bound = bindChapterSequenceQuoteRanges({ speechEvents: [
			{ text: "学费的事你不用担心。", textOrigin: "source_quote" },
			{ text: "人家已经给我免了。", textOrigin: "source_quote" },
		] }, [source(content)]) as { speechEvents: Array<{ sourceRanges: Array<{ startOffset: number; endOffset: number }> }> };
		expect(bound.speechEvents.map((event) => slice(content, event.sourceRanges))).toEqual(["学费的事你不用担心。", "人家已经给我免了。"]);
	});

	it("rejects a quote that is not a verbatim passage with the fix instead of guessing", () => {
		expect(() => bindChapterSequenceQuoteRanges({ speechEvents: [
			{ text: "这句话原文里没有。", textOrigin: "source_quote" },
		] }, [source("原文只有这一句。")])).toThrow(/not a verbatim passage.*textOrigin=authored/);
	});
});

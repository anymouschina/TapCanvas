import { describe, expect, it } from "vitest";

import type { PrismaClient } from "../../types";
import { collectBookBibleReadiness } from "./book-bible-readiness";

function fakeDb(rows: unknown[]): PrismaClient {
	return {
		$queryRawUnsafe: async () => rows,
	} as unknown as PrismaClient;
}

function flowWithArtifact(bookBibleType: string, content = "正文内容"): string {
	return JSON.stringify({
		nodes: [{
			id: `artifact-${bookBibleType}`,
			data: { kind: "text", bookBibleType, label: "自由显示名", prompt: content },
		}],
	});
}

describe("collectBookBibleReadiness", () => {
	it("reads explicit artifact types without interpreting labels", async () => {
		const db = fakeDb([{ id: "chapter-1", canvas_flow: flowWithArtifact("world") }]);
		const result = await collectBookBibleReadiness(db, "project-1");

		expect(result.present).toEqual(["世界观圣经"]);
		expect(result.missing).toEqual(["角色总表", "红线对照清单", "IP-safe替换表"]);
	});

	it("requires all four exact typed artifacts with non-empty content", async () => {
		const rows = ["world", "roster", "redlines", "ip_safe"].map((type, index) => ({
			id: `chapter-${index + 1}`,
			canvas_flow: flowWithArtifact(type),
		}));
		const result = await collectBookBibleReadiness(fakeDb(rows), "project-1");

		expect(result).toEqual({
			present: ["世界观圣经", "角色总表", "红线对照清单", "IP-safe替换表"],
			missing: [],
		});
	});

	it("does not accept a matching label without the structured type", async () => {
		const canvas_flow = JSON.stringify({
			nodes: [{ data: { kind: "text", label: "世界观圣经", prompt: "正文" } }],
		});
		const result = await collectBookBibleReadiness(
			fakeDb([{ id: "chapter-1", canvas_flow }]),
			"project-1",
		);

		expect(result.present).toEqual([]);
	});

	it("fails explicitly when a persisted chapter canvas is corrupt", async () => {
		await expect(collectBookBibleReadiness(
			fakeDb([{ id: "chapter-bad", canvas_flow: "{" }]),
			"project-1",
		)).rejects.toMatchObject({ code: "book_bible_canvas_invalid" });
	});

	it("propagates database failures instead of reporting a fabricated missing list", async () => {
		const db = {
			$queryRawUnsafe: async () => {
				throw new Error("database unavailable");
			},
		} as unknown as PrismaClient;

		await expect(collectBookBibleReadiness(db, "project-1"))
			.rejects.toThrow("database unavailable");
	});
});

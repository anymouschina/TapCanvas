import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	BookIndexStoreError,
	readBookIndex,
	replaceBookIndex,
	upsertBookIndex,
	updateBookIndex,
} from "./book-index-store";

const tempDirs: string[] = [];

async function createIndexPath(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-book-index-"));
	tempDirs.push(root);
	return path.join(root, "book", "index.json");
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("book-index-store", () => {
	it("serializes concurrent updates without dropping unrelated fields", async () => {
		const indexPath = await createIndexPath();
		await replaceBookIndex(indexPath, {
			bookId: "book-1",
			projectId: "project-1",
			chapters: [],
			assets: {},
		});

		await Promise.all(
			Array.from({ length: 40 }, (_, index) =>
				updateBookIndex(indexPath, (current) => {
					const assets =
						current.assets && typeof current.assets === "object" && !Array.isArray(current.assets)
							? (current.assets as Record<string, unknown>)
							: {};
					return {
						next: {
							...current,
							assets: { ...assets, [`field-${index}`]: index },
						},
						result: index,
					};
				}),
			),
		);

		const persisted = await readBookIndex(indexPath);
		const assets = persisted.assets as Record<string, unknown>;
		for (let index = 0; index < 40; index += 1) {
			expect(assets[`field-${index}`]).toBe(index);
		}
	});

	it("rejects invalid updates before replacing the valid file", async () => {
		const indexPath = await createIndexPath();
		await replaceBookIndex(indexPath, {
			bookId: "book-1",
			projectId: "project-1",
			chapters: [],
			assets: { retained: true },
		});

		await expect(
			updateBookIndex(indexPath, (current) => ({
				next: { ...current, chapters: "broken" },
				result: null,
			})),
			).rejects.toMatchObject({ code: "book_index_invalid" } satisfies Partial<BookIndexStoreError>);

		await expect(readBookIndex(indexPath)).resolves.toMatchObject({
			bookId: "book-1",
			chapters: [],
			assets: { retained: true },
		});
	});

	it("rejects identity changes", async () => {
		const indexPath = await createIndexPath();
		await replaceBookIndex(indexPath, {
			bookId: "book-1",
			projectId: "project-1",
			chapters: [],
		});

		await expect(
			updateBookIndex(indexPath, (current) => ({
				next: { ...current, bookId: "book-2" },
				result: null,
			})),
			).rejects.toMatchObject({
				code: "book_index_identity_changed",
			} satisfies Partial<BookIndexStoreError>);
	});

	it("reports malformed JSON explicitly", async () => {
		const indexPath = await createIndexPath();
		await fs.mkdir(path.dirname(indexPath), { recursive: true });
		await fs.writeFile(indexPath, '{"bookId":', "utf8");

		await expect(readBookIndex(indexPath)).rejects.toMatchObject({
			code: "book_index_parse_failed",
		} satisfies Partial<BookIndexStoreError>);
	});

	it("creates once and preserves unrelated fields on later upserts", async () => {
		const indexPath = await createIndexPath();
		const create = () => ({
			next: { bookId: "book-1", projectId: "project-1", chapters: [] },
			result: "created",
		});
		const first = await upsertBookIndex(indexPath, {
			create,
			update: (current) => ({ next: { ...current, title: "unexpected" }, result: "updated" }),
		});
		expect(first.created).toBe(true);

		await updateBookIndex(indexPath, (current) => ({
			next: { ...current, assets: { retained: true } },
			result: null,
		}));
		const second = await upsertBookIndex(indexPath, {
			create,
			update: (current) => ({ next: { ...current, title: "Canvas Book" }, result: "updated" }),
		});

		expect(second.created).toBe(false);
		expect(second.index).toMatchObject({
			title: "Canvas Book",
			assets: { retained: true },
		});
	});
});

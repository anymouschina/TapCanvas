import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeBookUploadMetadataAtomically } from "./book-upload-metadata-store";

describe("writeBookUploadMetadataAtomically", () => {
	let directory = "";

	beforeEach(async () => {
		directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "tapcanvas-book-upload-metadata-"),
		);
	});

	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("atomically replaces JSON metadata without leaving temporary files", async () => {
		const targetPath = path.join(directory, "session.json");
		await writeBookUploadMetadataAtomically({
			targetPath,
			value: { bytes: 1, status: "queued" },
		});
		await writeBookUploadMetadataAtomically({
			targetPath,
			value: { bytes: 2, status: "succeeded" },
		});

		expect(JSON.parse(await fs.readFile(targetPath, "utf8"))).toEqual({
			bytes: 2,
			status: "succeeded",
		});
		expect(await fs.readdir(directory)).toEqual(["session.json"]);
	});

	it("removes its temporary file when rename fails", async () => {
		const targetPath = path.join(directory, "occupied");
		await fs.mkdir(targetPath);

		await expect(
			writeBookUploadMetadataAtomically({
				targetPath,
				value: { status: "queued" },
			}),
		).rejects.toBeInstanceOf(Error);

		expect(await fs.readdir(directory)).toEqual(["occupied"]);
	});
});

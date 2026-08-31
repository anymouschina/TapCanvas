import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withBookUploadSessionLock } from "./book-upload-session-lock";

const temporaryDirectories: string[] = [];

async function createSessionMetaPath(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-book-upload-lock-"));
	temporaryDirectories.push(directory);
	return path.join(directory, "upload.json");
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await fs.rm(directory, { force: true, recursive: true });
	}
});

describe("withBookUploadSessionLock", () => {
	it("rejects a concurrent holder and permits the next operation after release", async () => {
		const sessionMetaPath = await createSessionMetaPath();
		let releaseFirstOperation: (() => void) | undefined;
		const firstOperationGate = new Promise<void>((resolve) => {
			releaseFirstOperation = resolve;
		});
		let signalFirstAcquired: (() => void) | undefined;
		const firstAcquired = new Promise<void>((resolve) => {
			signalFirstAcquired = resolve;
		});

		const first = withBookUploadSessionLock({
			sessionMetaPath,
			operation: async () => {
				signalFirstAcquired?.();
				await firstOperationGate;
				return "first";
			},
		});
		await firstAcquired;

		const concurrent = await withBookUploadSessionLock({
			sessionMetaPath,
			operation: async () => "concurrent",
		});
		expect(concurrent).toEqual({ status: "busy" });

		releaseFirstOperation?.();
		await expect(first).resolves.toEqual({ status: "acquired", value: "first" });

		await expect(
			withBookUploadSessionLock({
				sessionMetaPath,
				operation: async () => "next",
			}),
		).resolves.toEqual({ status: "acquired", value: "next" });
	});

	it("releases the lock when the protected operation fails", async () => {
		const sessionMetaPath = await createSessionMetaPath();
		await expect(
			withBookUploadSessionLock({
				sessionMetaPath,
				operation: async () => {
					throw new Error("operation failed");
				},
			}),
		).rejects.toThrow("operation failed");

		await expect(
			withBookUploadSessionLock({
				sessionMetaPath,
				operation: async () => "recovered",
			}),
		).resolves.toEqual({ status: "acquired", value: "recovered" });
	});
});

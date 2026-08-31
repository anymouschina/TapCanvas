import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	LocalAssetRangeError,
	readLocalAsset,
	resolveLocalAssetFilePath,
	resolveLocalAssetPublicBase,
	type LocalAssetStorageConfig,
	writeLocalAssetBytes,
	writeLocalAssetResponse,
} from "./local-asset-storage";

const temporaryDirectories: string[] = [];

async function createConfig(): Promise<LocalAssetStorageConfig> {
	const rootDirectory = await mkdtemp(path.join(tmpdir(), "tapcanvas-local-assets-"));
	temporaryDirectories.push(rootDirectory);
	return { kind: "local", rootDirectory };
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("local asset storage", () => {
	it("builds the public backend proxy base from the active API origin", () => {
		expect(resolveLocalAssetPublicBase("https://api.example.com/tasks/run?x=1")).toBe(
			"https://api.example.com/assets/local",
		);
	});

	it("writes immutable byte assets below the configured root", async () => {
		const config = await createConfig();
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const key = "gen/images/user/20260831/example.png";
		const filePath = await writeLocalAssetBytes({ config, key, bytes });

		expect(filePath).toBe(resolveLocalAssetFilePath(config, key));
		expect(new Uint8Array(await readFile(filePath))).toEqual(bytes);
		await expect(writeLocalAssetBytes({ config, key, bytes })).rejects.toMatchObject({
			code: "EEXIST",
		});
	});

	it("streams upstream responses to disk and serves byte ranges", async () => {
		const config = await createConfig();
		const key = "gen/videos/user/20260831/example.mp4";
		await writeLocalAssetResponse({
			config,
			key,
			response: new Response(new Uint8Array([10, 20, 30, 40, 50])),
		});

		const asset = await readLocalAsset({ config, key, rangeHeader: "bytes=1-3" });
		expect(asset.contentType).toBe("video/mp4");
		expect(asset.contentLength).toBe(3);
		expect(asset.range).toEqual({ start: 1, end: 3, length: 3 });
		expect(new Uint8Array(await new Response(asset.stream).arrayBuffer())).toEqual(
			new Uint8Array([20, 30, 40]),
		);
		await expect(
			readLocalAsset({ config, key, rangeHeader: "bytes=8-10" }),
		).rejects.toEqual(
			expect.objectContaining<Partial<LocalAssetRangeError>>({ totalSize: 5 }),
		);
	});

	it("rejects traversal keys before touching the filesystem", async () => {
		const config = await createConfig();
		expect(() => resolveLocalAssetFilePath(config, "../secret.txt")).toThrow(
			/invalid|escapes/,
		);
		expect(() => resolveLocalAssetFilePath(config, "gen/../../secret.txt")).toThrow(
			/invalid|escapes/,
		);
	});

	it("does not follow asset-directory symlinks outside the configured root", async () => {
		const config = await createConfig();
		const outsideDirectory = await mkdtemp(path.join(tmpdir(), "tapcanvas-outside-"));
		temporaryDirectories.push(outsideDirectory);
		await writeFile(path.join(outsideDirectory, "secret.png"), new Uint8Array([9]));
		await symlink(outsideDirectory, path.join(config.rootDirectory, "linked"));

		await expect(readLocalAsset({ config, key: "linked/secret.png" })).rejects.toThrow(
			/escapes the real asset root/,
		);
		await expect(
			writeLocalAssetBytes({
				config,
				key: "linked/new.png",
				bytes: new Uint8Array([1]),
			}),
		).rejects.toThrow(/escapes the real asset root/);
	});
});

import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import {
	readCanvasIndexCinematicCamera,
	writeCanvasIndexCinematicCamera,
	readCanvasIndexStyleImages,
	writeCanvasIndexStyleImages,
} from "./material.repo";

// canvas-index.json 路径由 repo 根推导，无 env 覆盖口 → 用一次性测试 owner 目录并在测后清理。
const OWNER = `_test-cam-owner-${process.pid}`;
const PROJECT = "_test-cam-project";

afterAll(async () => {
	const dir = path.join(resolveProjectDataRepoRoot(process.cwd()), "project-data", "users", OWNER);
	await fs.rm(dir, { recursive: true, force: true });
});

describe("canvas-index cinematicCamera 读写", () => {
	it("未写入时读出 null", async () => {
		expect(await readCanvasIndexCinematicCamera(PROJECT, OWNER)).toBeNull();
	});

	it("写入后读回同构值，且不干扰 styleImages 顶层字段", async () => {
		await writeCanvasIndexStyleImages(PROJECT, OWNER, ["https://example.com/style.png"]);
		const cam = {
			enabled: true,
			cameraKey: "arri_alexa35",
			lensKey: "zeiss_master_prime",
			focalKey: "35mm",
			apertureKey: "f/2",
		};
		const saved = await writeCanvasIndexCinematicCamera(PROJECT, OWNER, cam);
		expect(saved).toEqual(cam);
		expect(await readCanvasIndexCinematicCamera(PROJECT, OWNER)).toEqual(cam);
		expect(await readCanvasIndexStyleImages(PROJECT, OWNER)).toEqual([
			"https://example.com/style.png",
		]);
	});

	it("enabled=false 或全空字段归一化为 null", async () => {
		const disabled = await writeCanvasIndexCinematicCamera(PROJECT, OWNER, {
			enabled: false,
			cameraKey: "arri_alexa35",
			lensKey: "",
			focalKey: "",
			apertureKey: "",
		});
		expect(disabled).toBeNull();
		expect(await readCanvasIndexCinematicCamera(PROJECT, OWNER)).toBeNull();
	});

	it("传 null 显式清除", async () => {
		await writeCanvasIndexCinematicCamera(PROJECT, OWNER, {
			enabled: true,
			cameraKey: "red_komodo",
			lensKey: "",
			focalKey: "50mm",
			apertureKey: "",
		});
		expect(await readCanvasIndexCinematicCamera(PROJECT, OWNER)).not.toBeNull();
		await writeCanvasIndexCinematicCamera(PROJECT, OWNER, null);
		expect(await readCanvasIndexCinematicCamera(PROJECT, OWNER)).toBeNull();
	});
});

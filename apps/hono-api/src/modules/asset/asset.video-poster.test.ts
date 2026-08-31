import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { extractInlineVideoPoster } from "./asset.video-poster";

const execFileAsync = promisify(execFile);

// 集成风格（对齐本目录 faststart 测试惯例）：用 ffmpeg lavfi 现造一个 2 帧小视频，
// 验证 extractInlineVideoPoster 产出合法且不超预算的 data URI。无 ffmpeg 时跳过。
let ffmpegAvailable = true;
let tmp = "";
let videoFile = "";

beforeAll(async () => {
	try {
		await execFileAsync("ffmpeg", ["-version"]);
	} catch {
		ffmpegAvailable = false;
		return;
	}
	tmp = await mkdtemp(join(tmpdir(), "poster-inline-test-"));
	videoFile = join(tmp, "clip.mp4");
	await execFileAsync("ffmpeg", [
		"-y",
		"-f",
		"lavfi",
		"-i",
		"color=c=red:size=640x360:duration=0.2:rate=10",
		"-pix_fmt",
		"yuv420p",
		videoFile,
	]);
});

afterAll(async () => {
	if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("extractInlineVideoPoster", () => {
	it("从视频首帧产出 ≤12KB 的 jpeg data URI", async (ctx) => {
		if (!ffmpegAvailable) return ctx.skip();
		const inline = await extractInlineVideoPoster(videoFile);
		expect(inline).toMatch(/^data:image\/jpeg;base64,/);
		const bytes = Buffer.from(
			(inline as string).slice("data:image/jpeg;base64,".length),
			"base64",
		);
		expect(bytes.length).toBeGreaterThan(0);
		expect(bytes.length).toBeLessThanOrEqual(12 * 1024);
	});

	it("对不存在的文件返回 null（best-effort 不抛错）", async (ctx) => {
		if (!ffmpegAvailable) return ctx.skip();
		const inline = await extractInlineVideoPoster(
			join(tmp, "no-such-file.mp4"),
		);
		expect(inline).toBeNull();
	});
});

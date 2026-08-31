// MP4 faststart (moov-first) remux for hosted videos.
//
// WHY: seedance/上游生成的 mp4 一律是 moov 在文件尾（ftyp → uuid → mdat → moov）。浏览器
// 起播前必须先额外 range 到文件尾取 moov，再回头拉 mdat——叠加 CDN 回源，画布 hover 预览
// 的首帧延迟直接从几百 ms 恶化到数秒，看起来就是「hover 了不播放」。入库时做一次
// `-c copy -movflags +faststart` 纯拷贝重封装（无转码，7MB 片子毫秒级），moov 前置后拿到
// 文件头即可起播。
//
// Best-effort by design: 任何失败（非 mp4、ffmpeg 缺失、解析不了）都跳过，绝不影响上传本身。
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { FFMPEG_EXEC_OPTS } from "../task/subprocess-limits";

const execFileAsync = promisify(execFile);

// Top-level atoms are a handful of entries; cap the walk so a corrupt size field
// can't spin us through the whole file.
const MAX_TOP_LEVEL_ATOMS = 64;

/**
 * Walk the top-level MP4 atom sequence and report whether the file needs a
 * faststart remux — i.e. `mdat` appears before `moov`. Returns false for
 * anything unparseable (not an mp4, truncated, moov missing): in those cases a
 * remux either can't help or would rewrite garbage, so the caller should upload
 * the bytes as-is.
 */
export async function mp4NeedsFaststart(filePath: string): Promise<boolean> {
	const handle = await open(filePath, "r");
	try {
		const { size: fileSize } = await handle.stat();
		const head = Buffer.alloc(16);
		let offset = 0;
		let sawMdat = false;
		for (let i = 0; i < MAX_TOP_LEVEL_ATOMS && offset + 8 <= fileSize; i++) {
			const { bytesRead } = await handle.read(head, 0, 16, offset);
			if (bytesRead < 8) return false;
			let atomSize: number = head.readUInt32BE(0);
			const type = head.toString("latin1", 4, 8);
			if (!/^[\x20-\x7e]{4}$/.test(type)) return false;
			let headerSize = 8;
			if (atomSize === 1) {
				// 64-bit extended size (large mdat).
				if (bytesRead < 16) return false;
				atomSize = Number(head.readBigUInt64BE(8));
				headerSize = 16;
			} else if (atomSize === 0) {
				// "Extends to end of file" — only legal as the last atom.
				atomSize = fileSize - offset;
			}
			if (atomSize < headerSize) return false;
			if (type === "moov") return sawMdat;
			if (type === "mdat") sawMdat = true;
			offset += atomSize;
		}
		return false;
	} finally {
		await handle.close();
	}
}

/**
 * If the video at `filePath` is an mp4 with a tail moov, remux it in place
 * (stream copy + `-movflags +faststart`) so the browser can start playback from
 * the head of the file. Returns true when the file was rewritten. Never throws.
 */
export async function remuxFaststartInPlace(filePath: string): Promise<boolean> {
	try {
		if (!(await mp4NeedsFaststart(filePath))) return false;
		const outFile = join(dirname(filePath), `faststart-${randomUUID()}.mp4`);
		try {
			await execFileAsync(
				"ffmpeg",
				["-y", "-i", filePath, "-c", "copy", "-movflags", "+faststart", outFile],
				FFMPEG_EXEC_OPTS,
			);
			const { size } = await stat(outFile);
			if (!size) return false;
			await rename(outFile, filePath);
			return true;
		} finally {
			await rm(outFile, { force: true }).catch(() => {});
		}
	} catch (err) {
		console.warn(
			"[asset-hosting] faststart remux failed (non-fatal)",
			err instanceof Error ? err.message : String(err),
		);
		return false;
	}
}

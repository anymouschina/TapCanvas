#!/usr/bin/env node
// 旧资产视频 poster / posterInline 批量回填（2026-07-15 用户拍板"全部"，翻案旧"不回填"定调）。
//
// 扫描 chapters.canvas_flow 的视频节点 videoResults：
//   - 缺 thumbnailUrl：当前对象存储拉视频字节（走 GetObject）→ ffmpeg 抽首帧
//     ≤640 jpg → 上传 gen/thumbnails → 回写 thumbnailUrl
//   - 缺 posterInline：用 poster 文件（或刚抽的帧）转 ≤320 低质 jpeg base64（≤12KB）回写
//
// ⚠️ 并发安全：整块 canvas_flow 读改写会与前端自动保存竞态——仅处理 updated_at 距今 ≥10 分钟
//    的章节（--force 跳过该保护）；建议画布空闲时运行。
//
// 用法（在 api 容器内）：
//   docker exec hono-api-api-1 node scripts/backfill-video-posters.mjs [--project <id>] [--chapter <id>] [--dry-run] [--force]
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { resolveObjectStorageTarget } from "./object-storage-config.mjs";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const getArg = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : null;
};
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const ONLY_PROJECT = getArg("--project");
const ONLY_CHAPTER = getArg("--chapter");

const INLINE_EDGE = 320;
const INLINE_MAX = 12 * 1024;
const POSTER_EDGE = 640;

function requiredEnv(name) {
	const v = String(process.env[name] || "").trim();
	if (!v) throw new Error(`missing env ${name}`);
	return v;
}

const storage = resolveObjectStorageTarget();
const { bucket, publicBase } = storage;
const s3 = new S3Client(storage.s3ClientConfig);

function keyFromPublicUrl(u) {
	if (!u || typeof u !== "string") return null;
	if (!u.startsWith(publicBase + "/")) return null;
	return decodeURIComponent(u.slice(publicBase.length + 1).split("?")[0]);
}

async function s3Download(key, file) {
	const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	const bytes = Buffer.from(await res.Body.transformToByteArray());
	await writeFile(file, bytes);
}

async function ffmpegFrame(input, output, edge, quality) {
	await execFileAsync("ffmpeg", [
		"-y", "-i", input, "-frames:v", "1",
		"-vf", `scale='if(gt(iw,ih),min(${edge},iw),-2)':'if(gt(iw,ih),-2,min(${edge},ih))'`,
		"-q:v", String(quality), output,
	], { timeout: 60_000 });
}

async function main() {
	requiredEnv("DATABASE_URL");
	const prisma = new PrismaClient();
	const where = [];
	const params = [];
	if (ONLY_PROJECT) { params.push(ONLY_PROJECT); where.push(`project_id = $${params.length}`); }
	if (ONLY_CHAPTER) { params.push(ONLY_CHAPTER); where.push(`id = $${params.length}`); }
	if (!FORCE) where.push(`updated_at < (now() - interval '10 minutes')::text`);
	const rows = await prisma.$queryRawUnsafe(
		`select id, canvas_flow, updated_at from chapters where canvas_flow is not null ${where.length ? "and " + where.join(" and ") : ""}`,
		...params,
	);
	console.log(`chapters to scan: ${rows.length}${DRY ? " (dry-run)" : ""}`);

	let totalPatched = 0;
	for (const row of rows) {
		let flow;
		try { flow = JSON.parse(row.canvas_flow); } catch { continue; }
		const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
		let patched = 0;
		const tmp = await mkdtemp(join(tmpdir(), "poster-backfill-"));
		try {
			for (const node of nodes) {
				const results = Array.isArray(node?.data?.videoResults) ? node.data.videoResults : [];
				for (const r of results) {
					if (!r || typeof r !== "object") continue;
					const hasThumb = typeof r.thumbnailUrl === "string" && r.thumbnailUrl.trim();
					const hasInline = typeof r.posterInline === "string" && r.posterInline.startsWith("data:image/");
					if (hasThumb && hasInline) continue;
					const videoKey = keyFromPublicUrl(r.url);
					// 抽帧源：优先已有 poster 文件（小），否则视频本体。
					let frameSrc = null;
					try {
						if (hasThumb) {
							const thumbKey = keyFromPublicUrl(r.thumbnailUrl);
							if (thumbKey) { frameSrc = join(tmp, `t-${patched}.jpg`); await s3Download(thumbKey, frameSrc); }
						}
						if (!frameSrc) {
							if (!videoKey) continue; // 非自托管，跳过
							frameSrc = join(tmp, `v-${patched}.mp4`);
							await s3Download(videoKey, frameSrc);
						}
						if (!hasThumb) {
							const posterFile = join(tmp, `p-${patched}.jpg`);
							await ffmpegFrame(frameSrc, posterFile, POSTER_EDGE, 4);
							const bytes = await readFile(posterFile);
							const key = `gen/thumbnails/backfill/${Date.now().toString(36)}-${patched}.jpg`;
							if (!DRY) await s3.send(new PutObjectCommand({
								Bucket: bucket, Key: key, Body: bytes,
								ContentType: "image/jpeg", CacheControl: "public, max-age=31536000, immutable",
							}));
							r.thumbnailUrl = `${publicBase}/${key}`;
						}
						if (!hasInline) {
							const inlineFile = join(tmp, `i-${patched}.jpg`);
							await ffmpegFrame(frameSrc, inlineFile, INLINE_EDGE, 12);
							const b = await readFile(inlineFile);
							if (b.length > 0 && b.length <= INLINE_MAX) {
								r.posterInline = `data:image/jpeg;base64,${b.toString("base64")}`;
							}
						}
						patched++;
					} catch (err) {
						console.warn(`  [skip] ${row.id} ${String(r.url || "").slice(-40)}: ${err?.message || err}`);
					}
				}
			}
			if (patched > 0 && !DRY) {
				// 乐观并发防线：仅当 updated_at 未变时写回，变了说明有人在编辑，跳过本章。
				const affected = await prisma.$executeRawUnsafe(
					`update chapters set canvas_flow = $1 where id = $2 and updated_at = $3`,
					JSON.stringify(flow), row.id, row.updated_at,
				);
				if (affected === 1) console.log(`  [ok] ${row.id}: ${patched} 条 videoResults 回填`);
				else console.log(`  [race-skip] ${row.id}: 编辑中，本次跳过`);
			} else if (patched > 0) {
				console.log(`  [dry] ${row.id}: 将回填 ${patched} 条`);
			}
			totalPatched += patched;
		} finally {
			await rm(tmp, { recursive: true, force: true }).catch(() => {});
		}
	}
	console.log(`done. total patched: ${totalPatched}`);
	await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

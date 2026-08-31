import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildObjectStorageUrl, resolveObjectStorageTarget } from "./object-storage-config.mjs";

const OFFICIAL_OWNER_ID = "__tapcanvas_official__";
const OFFICIAL_FOLDER_ID = "material-folder-official-styles";
const EXPECTED_STYLE_COUNT = 171;
const PORT = Number(process.env.OFFICIAL_STYLE_IMPORT_PORT || 4466);

const storage = resolveObjectStorageTarget();
const objectClient = new S3Client(storage.s3ClientConfig);
const prisma = new PrismaClient();

function stableId(prefix, value) {
	return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function normalizeStyle(input) {
	const name = String(input?.name || "").replace(/^(?:Hot|New)\s*/u, "").trim();
	const sourceUrl = String(input?.sourceUrl || "").trim();
	const index = Number(input?.index);
	if (!name) throw new Error("style name is required");
	if (!/^https:\/\/static-oiioii-sg\.hogiai\.cn\/style_recommends\//u.test(sourceUrl)) {
		throw new Error(`unexpected style source URL: ${sourceUrl}`);
	}
	if (!Number.isInteger(index) || index < 1) throw new Error(`invalid style index: ${index}`);
	return { name, sourceUrl, index };
}

async function downloadAndUpload(style) {
	const response = await fetch(style.sourceUrl);
	if (!response.ok) throw new Error(`download failed (${response.status}): ${style.name}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length === 0) throw new Error(`empty image: ${style.name}`);
	const declaredType = String(response.headers.get("content-type") || "").split(";")[0].trim();
	const detectedType = bytes.subarray(0, 12).toString("ascii", 0, 4) === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
		? "image/webp"
		: bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
			? "image/png"
			: bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
				? "image/jpeg"
				: null;
	const contentType = declaredType.startsWith("image/") ? declaredType : detectedType;
	if (!contentType) throw new Error(`not an image (${declaredType || "unknown"}): ${style.name}`);
	const sourceName = new URL(style.sourceUrl).pathname.split("/").pop() || `${style.index}.webp`;
	const key = `official/style-library/oiioii/${String(style.index).padStart(3, "0")}-${sourceName}`;
	await objectClient.send(new PutObjectCommand({
		Bucket: storage.bucket,
		Key: key,
		Body: bytes,
		ContentType: contentType,
		CacheControl: "public, max-age=31536000, immutable",
	}));
	return buildObjectStorageUrl(storage.publicBase, key);
}

async function importStyles(rawStyles) {
	if (!Array.isArray(rawStyles)) throw new Error("request body must be a style array");
	const styles = rawStyles.map(normalizeStyle).sort((a, b) => a.index - b.index);
	if (styles.length !== EXPECTED_STYLE_COUNT) {
		throw new Error(`expected ${EXPECTED_STYLE_COUNT} styles, received ${styles.length}`);
	}
	if (new Set(styles.map((style) => style.index)).size !== styles.length) throw new Error("duplicate style indexes");
	if (new Set(styles.map((style) => style.name)).size !== styles.length) throw new Error("duplicate style names");

	const uploaded = [];
	for (const style of styles) {
		const imageUrl = await downloadAndUpload(style);
		uploaded.push({ ...style, imageUrl });
		process.stdout.write(`[${style.index}/${styles.length}] uploaded ${style.name}\n`);
	}

	const now = new Date().toISOString();
	await prisma.$transaction(async (tx) => {
		await tx.$executeRawUnsafe(
			`INSERT INTO material_folders (id, project_id, team_id, owner_id, name, created_at)
			 VALUES ($1, NULL, NULL, $2, '官方', $3)
			 ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, name = EXCLUDED.name`,
			OFFICIAL_FOLDER_ID,
			OFFICIAL_OWNER_ID,
			now,
		);
		for (const style of uploaded) {
			const assetId = stableId("official-style", style.sourceUrl);
			const versionId = stableId("official-style-version", style.sourceUrl);
			await tx.$executeRawUnsafe(
				`INSERT INTO material_assets
				 (id, owner_id, project_id, team_id, folder_id, kind, name, current_version, created_at, updated_at)
				 VALUES ($1, $2, '', NULL, $3, 'style', $4, 1, $5, $5)
				 ON CONFLICT (id) DO UPDATE SET folder_id = EXCLUDED.folder_id, name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`,
				assetId,
				OFFICIAL_OWNER_ID,
				OFFICIAL_FOLDER_ID,
				style.name,
				now,
			);
			await tx.$executeRawUnsafe(
				`INSERT INTO material_asset_versions
				 (id, asset_id, owner_id, project_id, version, data_json, note, created_at)
				 VALUES ($1, $2, $3, '', 1, $4, $5, $6)
				 ON CONFLICT (id) DO UPDATE SET data_json = EXCLUDED.data_json, note = EXCLUDED.note`,
				versionId,
				assetId,
				OFFICIAL_OWNER_ID,
				JSON.stringify({ imageUrl: style.imageUrl, sourceUrl: style.sourceUrl, sourceIndex: style.index }),
				"OiiOii 风格库官方导入",
				now,
			);
		}
	});
	return { folderId: OFFICIAL_FOLDER_ID, imported: uploaded.length, requestId: randomUUID() };
}

const server = createServer(async (request, response) => {
	response.setHeader("Access-Control-Allow-Origin", "https://www.oiioii.tv");
	response.setHeader("Content-Type", "application/json; charset=utf-8");
	if (request.method !== "POST" || request.url !== "/import") {
		response.statusCode = 404;
		response.end(JSON.stringify({ error: "not_found" }));
		return;
	}
	try {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const result = await importStyles(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		response.end(JSON.stringify(result));
		server.close();
	} catch (error) {
		response.statusCode = 500;
		response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
		server.close();
	}
});

server.listen(PORT, "127.0.0.1", () => {
	process.stdout.write(`official style importer listening on http://127.0.0.1:${PORT}/import\n`);
});

server.on("close", async () => {
	await prisma.$disconnect();
});

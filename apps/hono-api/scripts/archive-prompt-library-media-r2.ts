import path from "node:path";
import dotenv from "dotenv";
import type { WorkerEnv } from "../src/types";
import { archiveExistingPromptMediaToR2 } from "../src/modules/prompt-library/prompt-library.media-hosting";
import { getPrismaClient } from "../src/platform/node/prisma";

dotenv.config({ path: path.resolve(process.cwd(), "apps/hono-api/.env") });

async function main(): Promise<void> {
	const db = getPrismaClient();
	const env: WorkerEnv = {
		DB: db,
		JWT_SECRET: process.env.JWT_SECRET ?? "prompt-media-archive",
		R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
		R2_SESSION_TOKEN: process.env.R2_SESSION_TOKEN,
		R2_ENDPOINT_URL: process.env.R2_ENDPOINT_URL,
		R2_REGION: process.env.R2_REGION,
		R2_BUCKET: process.env.R2_BUCKET,
		R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
	};

	try {
		const result = await archiveExistingPromptMediaToR2({
			db,
			env,
			onProgress: (progress) => {
				if (progress.processed % 25 !== 0 && progress.processed !== progress.total) return;
				console.log(JSON.stringify({ event: "prompt_media_r2_archive_progress", ...progress }));
			},
		});
		console.log(JSON.stringify({ event: "prompt_media_r2_archive_complete", ...result }));
		if (result.failed > 0) {
			throw new Error(`R2 归档完成但有 ${result.failed} 条媒体失败，失败证据已输出`);
		}
	} finally {
		await db.$disconnect();
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});

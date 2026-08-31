import { Queue } from "bullmq";

import {
	assertAsyncImageQueueReady,
	type AsyncImageQueueJob,
} from "../src/modules/task/async-image.queue";
import { makeQueueConnection, QUEUE_NAMES } from "../src/modules/task/queues";

async function main(): Promise<void> {
	const connection = makeQueueConnection();
	const queue = new Queue<AsyncImageQueueJob>(QUEUE_NAMES.asyncImage, { connection });
	try {
		await assertAsyncImageQueueReady(queue);
		const workerCount = await queue.getWorkersCount();
		process.stdout.write(`${JSON.stringify({ ok: true, workerCount })}\n`);
	} finally {
		await queue.close();
		if (connection.status !== "end") await connection.quit();
	}
}

void main().catch((error: unknown) => {
	process.stderr.write(
		`[async-image-worker-health] ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exit(1);
});

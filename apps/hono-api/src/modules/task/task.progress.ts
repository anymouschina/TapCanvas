import { getSharedRedis } from "../../platform/redis-shared";
import { TaskProgressStore } from "./task-progress-store";
import {
	TaskProgressSnapshotSchema,
	type TaskProgressSnapshotDto,
} from "./task.schemas";

// Single store for the per-user "latest pending snapshot" used by GET
// /tasks/pending. Backed by Redis when REDIS_URL is set (self-expiring + shared
// across api replicas, so polling works behind a round-robin LB); otherwise a
// bounded in-memory store with TTL + per-user LRU. Either way it can no longer
// grow without bound — the previous Map leaked a permanent entry per user and
// pinned every non-terminal task forever. Set TASK_PROGRESS_REDIS=0 to force the
// in-memory backend even when REDIS_URL is present.
function resolveStore(): TaskProgressStore {
	const useRedis = String(process.env.TASK_PROGRESS_REDIS ?? "1") !== "0";
	return new TaskProgressStore({ redis: useRedis ? getSharedRedis() : null });
}

const store = resolveStore();

export function emitTaskProgress(
	userId: string,
	event: {
		nodeId?: string;
		nodeKind?: string;
		taskId?: string;
		taskKind?: TaskProgressSnapshotDto["taskKind"];
		vendor?: string;
		status: TaskProgressSnapshotDto["status"];
		progress?: number;
		message?: string;
		assets?: TaskProgressSnapshotDto["assets"];
		raw?: unknown;
		timestamp?: number;
	},
): void {
	if (!userId || !event || !event.status) return;
	const payload = TaskProgressSnapshotSchema.parse({
		...event,
		timestamp: event.timestamp ?? Date.now(),
	});

	// Persist latest snapshot for pending queries (fire-and-forget: this is a
	// read-through cache, never block the emitting path on it).
	void store.store(userId, payload).catch((err) => {
		console.warn("[task-progress] store failed", err);
	});
}

export function getPendingTaskSnapshots(
	userId: string,
	vendor?: string,
): Promise<TaskProgressSnapshotDto[]> {
	return store.getPending(userId, vendor);
}

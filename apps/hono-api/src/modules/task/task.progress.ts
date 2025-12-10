import {
	TaskProgressSnapshotSchema,
	type TaskProgressSnapshotDto,
} from "./task.schemas";

export type TaskProgressSubscriber = {
	push: (event: TaskProgressSnapshotDto) => void;
};

const taskProgressSubscribers = new Map<
	string,
	Set<TaskProgressSubscriber>
>();

const latestByUser = new Map<
	string,
	Map<string, TaskProgressSnapshotDto>
>();

type StoredKeyInput = {
	vendor?: string;
	nodeId?: string;
	taskId?: string;
};

function makeStoredKey(input: StoredKeyInput): string {
	const vendor = (input.vendor || "").trim();
	const nodeId = (input.nodeId || "").trim();
	const taskId = (input.taskId || "").trim();
	return [
		vendor || "*",
		nodeId || "*",
		taskId || "*",
	].join("|");
}

export function addTaskProgressSubscriber(
	userId: string,
	subscriber: TaskProgressSubscriber,
): void {
	const existing = taskProgressSubscribers.get(userId);
	if (existing) {
		existing.add(subscriber);
	} else {
		taskProgressSubscribers.set(userId, new Set([subscriber]));
	}
}

export function removeTaskProgressSubscriber(
	userId: string,
	subscriber: TaskProgressSubscriber,
): void {
	const existing = taskProgressSubscribers.get(userId);
	if (!existing) return;
	existing.delete(subscriber);
	if (existing.size === 0) {
		taskProgressSubscribers.delete(userId);
	}
}

function storeLatestSnapshot(
	userId: string,
	event: TaskProgressSnapshotDto,
) {
	const key = makeStoredKey({
		vendor: event.vendor,
		nodeId: event.nodeId,
		taskId: event.taskId,
	});
	let store = latestByUser.get(userId);
	if (!store) {
		store = new Map<string, TaskProgressSnapshotDto>();
		latestByUser.set(userId, store);
	}
	if (event.status === "succeeded" || event.status === "failed") {
		store.delete(key);
		return;
	}
	store.set(key, event);
}

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

	// Persist latest snapshot for pending queries
	storeLatestSnapshot(userId, payload);

	const subscribers = taskProgressSubscribers.get(userId);
	if (!subscribers || subscribers.size === 0) return;
	for (const sub of subscribers) {
		try {
			sub.push(payload);
		} catch (err) {
			console.warn("[task-progress] subscriber push failed", err);
		}
	}
}

export function getPendingTaskSnapshots(
	userId: string,
	vendor?: string,
): TaskProgressSnapshotDto[] {
	const store = latestByUser.get(userId);
	if (!store) return [];
	const targetVendor = (vendor || "").trim().toLowerCase();
	const result: TaskProgressSnapshotDto[] = [];
	for (const snapshot of store.values()) {
		if (!snapshot) continue;
		if (
			snapshot.status !== "queued" &&
			snapshot.status !== "running"
		) {
			continue;
		}
		if (
			targetVendor &&
			(snapshot.vendor || "").toLowerCase() !== targetVendor
		) {
			continue;
		}
		result.push(snapshot);
	}
	return result;
}


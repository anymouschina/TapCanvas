import { mkdtemp, mkdir, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type TaskWorkspace = {
	path: string;
	freeBytesBeforeCreate: number;
	cleanup: () => Promise<void>;
};

const DEFAULT_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;

function readPositiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveWorkspaceRoot(): string {
	const configured = (process.env.TAPCANVAS_TEMP_ROOT ?? "").trim();
	if (!configured) return join(tmpdir(), "tapcanvas");
	if (!isAbsolute(configured)) {
		throw new Error("TAPCANVAS_TEMP_ROOT must be an absolute path");
	}
	return resolve(configured);
}

function normalizePrefix(value: string): string {
	const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
	if (!normalized) throw new Error("temporary workspace prefix is required");
	return normalized.slice(0, 48);
}

export async function createTaskWorkspace(prefix: string): Promise<TaskWorkspace> {
	const root = resolveWorkspaceRoot();
	await mkdir(root, { recursive: true });
	const filesystem = await statfs(root);
	const freeBytesBeforeCreate = filesystem.bavail * filesystem.bsize;
	const minimumFreeBytes = readPositiveInteger(
		process.env.TAPCANVAS_TEMP_MIN_FREE_BYTES,
		DEFAULT_MIN_FREE_BYTES,
	);
	if (freeBytesBeforeCreate < minimumFreeBytes) {
		throw new Error(
			`temporary workspace capacity insufficient: freeBytes=${freeBytesBeforeCreate}, minimumFreeBytes=${minimumFreeBytes}, root=${root}`,
		);
	}

	const path = await mkdtemp(join(root, `${normalizePrefix(prefix)}-`));
	return {
		path,
		freeBytesBeforeCreate,
		cleanup: async () => {
			await rm(path, { recursive: true, force: true });
		},
	};
}

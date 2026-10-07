import { createHash } from "node:crypto";
import { diffWorkflowOutputCheckpoint, type WorkflowOutputCheckpointJson } from "./execution.output-checkpoint-delta";
import {
	WORKFLOW_OUTPUT_STORAGE_VERSION, decodeWorkflowOutput, encodeWorkflowOutput, patchWorkflowOutput, workflowOutputDelta,
	type StoredOutputValue, type StoredWorkflowOutput,
} from "./execution.output-storage";

export type WorkflowOutputCheckpointWrite = Readonly<{
	/** null is a guarded lifecycle write, never an output deletion. */
	output: StoredWorkflowOutput | null;
	nodeRunId: string;
	attempt: number;
	baseRootHash: string | null;
}>;

export type WorkflowOutputCheckpointPacket = Readonly<{
	version: 1;
	baseRootHash: string | null;
	root: StoredOutputValue;
	blockIds: readonly string[];
	blocks: Readonly<Record<string, StoredOutputValue>>;
}>;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function storedValue(value: unknown): value is StoredOutputValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (!Array.isArray(value) || value.length !== 2) return false;
	const [tag, body]: unknown[] = value;
	if (tag === "ref" || tag === "escaped-string") return typeof body === "string";
	if (tag === "array") return Array.isArray(body) && body.every(storedValue);
	if (tag !== "object" || !Array.isArray(body)) return false;
	return body.every((entry: unknown) => Array.isArray(entry) && entry.length === 2
		&& (typeof entry[0] === "string" || (Array.isArray(entry[0]) && entry[0].length === 2
			&& entry[0][0] === "escaped-string" && typeof entry[0][1] === "string")) && storedValue(entry[1]));
}

function storedBlocks(value: unknown): value is Readonly<Record<string, StoredOutputValue>> {
	return record(value) && Object.values(value).every(storedValue);
}

/** Storage envelope only; no cold encoding or semantic-history fallback. */
export function readStoredWorkflowOutputStrict(raw: unknown): StoredWorkflowOutput {
	const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
	if (!record(value) || value.storageVersion !== WORKFLOW_OUTPUT_STORAGE_VERSION
		|| !storedValue(value.root) || !storedBlocks(value.blocks)) {
		throw new Error("Invalid workflow checkpoint storage envelope");
	}
	const output: StoredWorkflowOutput = { storageVersion: WORKFLOW_OUTPUT_STORAGE_VERSION, root: value.root, blocks: value.blocks };
	// Check every supplied block, including unreachable/corrupt extras. No semantic expansion.
	return patchWorkflowOutput(output, []).output;
}

export function workflowOutputRootHash(output: StoredWorkflowOutput): string {
	return createHash("sha256").update(JSON.stringify(output.root)).digest("hex");
}

export function parseWorkflowOutputCheckpointPacket(raw: unknown): WorkflowOutputCheckpointPacket {
	if (!record(raw) || raw.version !== 1 || !(raw.baseRootHash === null
		|| (typeof raw.baseRootHash === "string" && /^[a-f0-9]{64}$/.test(raw.baseRootHash)))
		|| !storedValue(raw.root) || !storedBlocks(raw.blocks) || !Array.isArray(raw.blockIds)
		|| raw.blockIds.some((id: unknown) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
		|| new Set(raw.blockIds).size !== raw.blockIds.length) {
		throw new Error("Invalid workflow output checkpoint packet");
	}
	const blockIds: string[] = raw.blockIds;
	if (Object.keys(raw.blocks).some(id => !blockIds.includes(id))) throw new Error("Checkpoint contains a block outside its manifest");
	return { version: 1, baseRootHash: raw.baseRootHash, root: raw.root, blockIds, blocks: raw.blocks };
}

/** An old base is a rejected mutation, never permission to overwrite/replay. */
export function applyWorkflowOutputCheckpointPacket(
	previousRaw: unknown, packet: WorkflowOutputCheckpointPacket,
): StoredWorkflowOutput {
	if (packet.baseRootHash === null && previousRaw !== null) {
		throw new Error("workflow_output_checkpoint_stale_base");
	}
	const previous = packet.baseRootHash === null ? null : readStoredWorkflowOutputStrict(previousRaw);
	if (previous && workflowOutputRootHash(previous) !== packet.baseRootHash) {
		throw new Error("workflow_output_checkpoint_stale_base");
	}
	const blocks: Record<string, StoredOutputValue> = Object.create(null);
	for (const id of packet.blockIds) {
		const value = Object.hasOwn(packet.blocks, id) ? packet.blocks[id] : previous?.blocks[id];
		if (value === undefined) throw new Error(`Workflow checkpoint block missing: ${id}`);
		blocks[id] = value;
	}
	return readStoredWorkflowOutputStrict({ storageVersion: WORKFLOW_OUTPUT_STORAGE_VERSION, root: packet.root, blocks });
}

function jsonValue(value: unknown): value is WorkflowOutputCheckpointJson {
	return value === null || typeof value === "string" || typeof value === "boolean"
		|| (typeof value === "number" && Number.isFinite(value))
		|| (Array.isArray(value) ? value.every(jsonValue) : record(value) && Object.values(value).every(jsonValue));
}

/** Independent snapshot: mutable callers cannot change a previously acknowledged base. */
function normalize(value: unknown): WorkflowOutputCheckpointJson {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) throw new Error("Workflow checkpoint is not JSON serializable");
	const parsed: unknown = JSON.parse(serialized);
	if (!jsonValue(parsed)) throw new Error("Workflow checkpoint is not normalized JSON");
	return parsed;
}

export class WorkflowOutputCheckpointWriterError extends Error {
	readonly code = "workflow_output_checkpoint_writer_failed";
	constructor(cause: unknown) {
		super(`Workflow checkpoint writer failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		this.name = "WorkflowOutputCheckpointWriterError";
	}
}

/** Only acknowledged writes advance the base; errors stop this physical writer. */
export function createWorkflowOutputCheckpointSender(
	send: (packet: WorkflowOutputCheckpointPacket) => Promise<void>,
	initial: StoredWorkflowOutput | null = null,
) {
	const storedInitial = initial === null ? null : readStoredWorkflowOutputStrict(initial);
	let previous: Readonly<{ snapshot: WorkflowOutputCheckpointJson; output: StoredWorkflowOutput }> | null =
		storedInitial === null ? null : { snapshot: normalize(decodeWorkflowOutput(storedInitial)), output: storedInitial };
	let tail: Promise<void> = Promise.resolve();
	let writerFailure: WorkflowOutputCheckpointWriterError | null = null;
	const unacknowledged = new Map<number, WorkflowOutputCheckpointJson>();
	let sequence = 0;
	const fail = (cause: unknown): WorkflowOutputCheckpointWriterError => {
		writerFailure ??= cause instanceof WorkflowOutputCheckpointWriterError ? cause : new WorkflowOutputCheckpointWriterError(cause);
		return writerFailure;
	};
	const sender = (value: unknown): Promise<void> => {
		let snapshot: WorkflowOutputCheckpointJson;
		try { snapshot = normalize(value); }
		catch (cause: unknown) {
			const failure = fail(cause);
			tail = tail.then(() => { throw failure; }, () => { throw failure; });
			return tail;
		}
		const id = ++sequence;
		unacknowledged.set(id, snapshot);
		const write = tail.then(async () => {
			if (writerFailure !== null) throw writerFailure;
			const prior = previous;
			const output = prior ? patchWorkflowOutput(prior.output, diffWorkflowOutputCheckpoint(prior.snapshot, snapshot)).output
				: encodeWorkflowOutput(snapshot);
			const delta = workflowOutputDelta(output, prior ? Object.keys(prior.output.blocks) : []);
			await send({ version: 1, baseRootHash: prior ? workflowOutputRootHash(prior.output) : null,
				root: delta.root, blockIds: delta.blockIds, blocks: delta.blocks });
			previous = { snapshot, output };
			unacknowledged.delete(id);
		}).catch((cause: unknown) => { throw fail(cause); });
		tail = write;
		return write;
	};
	return Object.assign(sender, {
		settle: (): Promise<void> => tail,
		failure: (): WorkflowOutputCheckpointWriterError | null => writerFailure,
		acknowledgedRootHash: (): string | null => previous === null ? null : workflowOutputRootHash(previous.output),
		unacknowledgedSnapshots: (): readonly WorkflowOutputCheckpointJson[] => [...unacknowledged.values()],
	});
}

import { createHash } from "node:crypto";

export const WORKFLOW_OUTPUT_STORAGE_VERSION = "workflow.output-storage/v1";
type Scalar = string | number | boolean | null;
type StoredKey = string | readonly ["escaped-string", string];
// Containers are tagged, so user objects/arrays can never masquerade as refs.
export type StoredOutputValue = Scalar
	| readonly ["object", readonly (readonly [StoredKey, StoredOutputValue])[]]
	| readonly ["array", readonly StoredOutputValue[]]
	| readonly ["escaped-string", string]
	| readonly ["ref", string];
export type StoredWorkflowOutput = Readonly<{
	storageVersion: typeof WORKFLOW_OUTPUT_STORAGE_VERSION;
	root: StoredOutputValue;
	blocks: Readonly<Record<string, StoredOutputValue>>;
}>;

function hash(value: StoredOutputValue): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function encodeString(value: string): StoredKey {
	// PostgreSQL jsonb cannot represent NUL or unpaired UTF-16 surrogates.
	// Preserve their JSON escapes as text rather than rejecting valid JSON input.
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0 || (code >= 0xdc00 && code <= 0xdfff)) return ["escaped-string", JSON.stringify(value)];
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return ["escaped-string", JSON.stringify(value)];
			index += 1;
		}
	}
	return value;
}

function storeEncodedValue(encoded: StoredOutputValue, blocks: Record<string, StoredOutputValue>): StoredOutputValue {
	if (Buffer.byteLength(JSON.stringify(encoded)) < 512) return encoded;
	const id = hash(encoded);
	blocks[id] = encoded;
	return ["ref", id];
}

function encodeNormalizedValue(
	input: unknown, blocks: Record<string, StoredOutputValue>, onEncode?: () => void,
): StoredOutputValue {
	onEncode?.();
	let encoded: StoredOutputValue;
	if (typeof input === "string") encoded = encodeString(input);
	else if (input === null || typeof input === "number" || typeof input === "boolean") encoded = input;
	else if (Array.isArray(input)) encoded = ["array", input.map(child => encodeNormalizedValue(child, blocks, onEncode))];
	else if (typeof input === "object") {
		encoded = ["object", Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
			.map(([key, child]) => [encodeString(key), encodeNormalizedValue(child, blocks, onEncode)] as const)];
	} else throw new Error("Workflow output contains a non-JSON value");
	return storeEncodedValue(encoded, blocks);
}

/** Lossless JSON encoding. Repeated bodies, provenance and collections share blocks. */
export function encodeWorkflowOutput(value: unknown): StoredWorkflowOutput {
	// Normalize once using the same JSON semantics as the ledger (dates, undefined,
	// toJSON), and reject cycles/BigInt before opening a database transaction.
	const serialized = JSON.stringify(value);
	if (serialized === undefined) throw new Error("Workflow output is not JSON serializable");
	const normalized: unknown = JSON.parse(serialized);
	const blocks: Record<string, StoredOutputValue> = Object.create(null);
	const root = encodeNormalizedValue(normalized, blocks);
	return { storageVersion: WORKFLOW_OUTPUT_STORAGE_VERSION, root, blocks };
}

export type WorkflowOutputPatch =
	| Readonly<{ kind: "replace"; path: readonly (string | number)[]; value: unknown }>
	| Readonly<{ kind: "add"; path: readonly (string | number)[]; value: unknown }>
	| Readonly<{ kind: "delete"; path: readonly (string | number)[] }>;

export type WorkflowOutputPatchResult = Readonly<{
	output: StoredWorkflowOutput;
	diagnostics: Readonly<{
		validatedBlocks: number;
		patchedContainers: number;
		encodedReplacementValues: number;
		reusedBlocks: number;
		newBlocks: number;
	}>;
}>;

function storedString(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value) || value.length !== 2 || value[0] !== "escaped-string" || typeof value[1] !== "string") {
		throw new Error("Invalid workflow output escaped string");
	}
	const decoded: unknown = JSON.parse(value[1]);
	if (typeof decoded !== "string") throw new Error("Invalid workflow output escaped string");
	return decoded;
}

/**
 * Explicit JSON edits over the stored DAG. Integrity validation visits encoded
 * blocks once; only replacement values and their ancestors are re-encoded.
 * Object add requires a missing key; array add inserts at an index. Array
 * deletion removes that element. Edits sharing a shifted array's index
 * space are rejected rather than silently shifting another requested path.
 */
export function patchWorkflowOutput(stored: StoredWorkflowOutput, operations: readonly WorkflowOutputPatch[]): WorkflowOutputPatchResult {
	if (stored.storageVersion !== WORKFLOW_OUTPUT_STORAGE_VERSION || !isRecord(stored.blocks)) {
		throw new Error("Unsupported workflow output storage envelope");
	}
	const validated = new Set<string>();
	const active = new Set<string>();
	const validate = (value: StoredOutputValue): void => {
		if (value === null || typeof value === "string" || typeof value === "boolean"
			|| (typeof value === "number" && Number.isFinite(value))) return;
		if (!Array.isArray(value) || value.length !== 2) throw new Error("Invalid workflow output storage value");
		const [tag, payload] = value;
		if (tag === "escaped-string" && typeof payload === "string") { storedString(value); return; }
		if (tag === "ref" && typeof payload === "string") {
			if (!Object.hasOwn(stored.blocks, payload)) throw new Error(`Workflow output block missing: ${payload}`);
			if (active.has(payload)) throw new Error(`Workflow output block cycle: ${payload}`);
			if (validated.has(payload)) return;
			const block = stored.blocks[payload]!;
			if (hash(block) !== payload) throw new Error(`Workflow output block hash mismatch: ${payload}`);
			active.add(payload);
			validate(block);
			active.delete(payload);
			validated.add(payload);
			return;
		}
		if (tag === "array" && Array.isArray(payload)) { for (const child of payload) validate(child); return; }
		if (tag === "object" && Array.isArray(payload)) {
			const keys = new Set<string>();
			for (const entry of payload) {
				if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Invalid workflow output object entry");
				const key = entry[0];
				if (typeof key !== "string" && (!Array.isArray(key) || key.length !== 2 || key[0] !== "escaped-string" || typeof key[1] !== "string")) {
					throw new Error("Invalid workflow output object key");
				}
				const decodedKey = storedString(key);
				if (keys.has(decodedKey)) throw new Error("Invalid workflow output object key");
				keys.add(decodedKey);
				validate(entry[1]);
			}
			return;
		}
		throw new Error("Invalid workflow output storage container");
	};
	validate(stored.root);
	for (const id of Object.keys(stored.blocks)) validate(["ref", id]);
	const prefix = (a: readonly (string | number)[], b: readonly (string | number)[]) =>
		a.length <= b.length && a.every((part, index) => part === b[index]);
	for (const operation of operations) {
		if (operation.kind !== "replace" && operation.kind !== "add" && operation.kind !== "delete") throw new Error("Invalid workflow output patch operation");
		if (!Array.isArray(operation.path) || operation.path.some(part => typeof part !== "string"
			&& !(typeof part === "number" && Number.isSafeInteger(part) && part >= 0))) throw new Error("Invalid workflow output patch path");
		if (operation.kind === "delete" && operation.path.length === 0) throw new Error("Cannot delete workflow output root");
		if (operation.kind === "add" && operation.path.length === 0) throw new Error("Workflow output root already exists");
	}
	for (let left = 0; left < operations.length; left += 1) {
		for (let right = left + 1; right < operations.length; right += 1) {
			if (prefix(operations[left]!.path, operations[right]!.path) || prefix(operations[right]!.path, operations[left]!.path)) {
				throw new Error("Conflicting workflow output patch paths");
			}
		}
	}
	const blocks: Record<string, StoredOutputValue> = { ...stored.blocks };
	let patchedContainers = 0;
	let encodedReplacementValues = 0;
	const removed = Symbol("removed");
	const patch = (value: StoredOutputValue, edits: readonly WorkflowOutputPatch[], depth: number): StoredOutputValue | typeof removed => {
		const direct = edits.find(edit => edit.path.length === depth);
		if (direct) {
			if (direct.kind === "delete") return removed;
			// A wrapper supplies the same toJSON key as replacing that JSON field.
			const key = direct.path[depth - 1];
			const serialized = key === undefined ? JSON.stringify(direct.value) : JSON.stringify({ [String(key)]: direct.value });
			if (serialized === undefined) throw new Error("Workflow output is not JSON serializable");
			const normalized: unknown = JSON.parse(serialized);
			const replacement = key === undefined ? normalized : isRecord(normalized) && Object.hasOwn(normalized, String(key))
				? normalized[String(key)] : undefined;
			if (replacement === undefined) return typeof key === "number" ? null : removed;
			return encodeNormalizedValue(replacement, blocks, () => { encodedReplacementValues += 1; });
		}
		let container = value;
		while (Array.isArray(container) && container[0] === "ref") container = blocks[container[1]]!;
		if (!Array.isArray(container) || (container[0] !== "object" && container[0] !== "array")) {
			throw new Error("Workflow output patch path does not name a container");
		}
		patchedContainers += 1;
		const grouped = new Map<string | number, WorkflowOutputPatch[]>();
		for (const edit of edits) {
			const key = edit.path[depth]!;
			grouped.set(key, [...(grouped.get(key) ?? []), edit]);
		}
		if (container[0] === "array") {
			const items = [...container[1]];
			for (const [key, nested] of grouped) {
				const insertion = nested.some(edit => edit.kind === "add" && edit.path.length === depth + 1);
				if (typeof key !== "number" || key > items.length || (key === items.length && !insertion)) {
					throw new Error("Invalid workflow output patch array index");
				}
			}
			if (edits.some(edit => edit.kind !== "replace" && edit.path.length === depth + 1) && grouped.size > 1) {
				throw new Error("Conflicting workflow output patch array index shift");
			}
			for (const [key, nested] of grouped) {
				const index = key as number;
				const next = patch(items[index]!, nested, depth + 1);
				if (next === removed) items.splice(index, 1);
				else if (nested.some(edit => edit.kind === "add" && edit.path.length === depth + 1)) items.splice(index, 0, next);
				else items[index] = next;
			}
			return storeEncodedValue(["array", items], blocks);
		}
		const entries = [...container[1]];
		for (const [key, nested] of grouped) {
			if (typeof key !== "string") throw new Error("Workflow output patch object key must be a string");
			const index = entries.findIndex(entry => storedString(entry[0]) === key);
			const insertion = nested.some(edit => edit.kind === "add" && edit.path.length === depth + 1);
			if (index < 0 && !insertion) throw new Error("Workflow output patch path is missing");
			if (index >= 0 && insertion) throw new Error("Workflow output patch object key already exists");
			const next = patch(index < 0 ? null : entries[index]![1], nested, depth + 1);
			if (index < 0) { if (next !== removed) entries.push([encodeString(key), next]); }
			else if (next === removed) entries.splice(index, 1); else entries[index] = [entries[index]![0], next];
		}
		entries.sort(([left], [right]) => storedString(left) < storedString(right) ? -1 : storedString(left) > storedString(right) ? 1 : 0);
		return storeEncodedValue(["object", entries], blocks);
	};
	const root = operations.length === 0 ? stored.root : patch(stored.root, operations, 0);
	if (root === removed) throw new Error("Cannot delete workflow output root");
	const reachable = new Set<string>();
	const collect = (value: StoredOutputValue): void => {
		if (!Array.isArray(value)) return;
		if (value[0] === "ref") {
			if (reachable.has(value[1])) return;
			reachable.add(value[1]); collect(blocks[value[1]]!);
		} else if (value[0] === "array") for (const child of value[1]) collect(child);
		else if (value[0] === "object") for (const [, child] of value[1]) collect(child);
	};
	collect(root);
	const retained = Object.fromEntries([...reachable].map(id => [id, blocks[id]!]));
	const reusedBlocks = [...reachable].filter(id => Object.hasOwn(stored.blocks, id)).length;
	return {
		output: { storageVersion: WORKFLOW_OUTPUT_STORAGE_VERSION, root, blocks: retained } satisfies StoredWorkflowOutput,
		diagnostics: { validatedBlocks: validated.size, patchedContainers, encodedReplacementValues,
			reusedBlocks, newBlocks: reachable.size - reusedBlocks },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The single ledger read boundary; the public node-output contract stays unchanged. */
export function decodeWorkflowOutput(raw: unknown): unknown {
	const stored: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
	if (!isRecord(stored) || !("storageVersion" in stored)) return stored;
	if (stored.storageVersion !== WORKFLOW_OUTPUT_STORAGE_VERSION || !isRecord(stored.blocks)) {
		throw new Error("Unsupported workflow output storage envelope");
	}
	const blocks = stored.blocks;
	const validated = new Set<string>();
	const active = new Set<string>();
	const decode = (value: unknown): unknown => {
		if (value === null || typeof value === "string" || typeof value === "boolean" ||
			(typeof value === "number" && Number.isFinite(value))) return value;
		if (!Array.isArray(value) || value.length !== 2) throw new Error("Invalid workflow output storage value");
		const [tag, payload] = value;
		if (tag === "escaped-string" && typeof payload === "string") {
			const decoded: unknown = JSON.parse(payload);
			if (typeof decoded !== "string") throw new Error("Invalid workflow output escaped string");
			return decoded;
		}
		if (tag === "ref") {
			if (typeof payload !== "string" || !Object.hasOwn(blocks, payload)) {
				throw new Error(`Workflow output block missing: ${String(payload)}`);
			}
			if (active.has(payload)) throw new Error(`Workflow output block cycle: ${payload}`);
			const block = blocks[payload];
			if (!validated.has(payload)) {
				if (hash(block as StoredOutputValue) !== payload) throw new Error(`Workflow output block hash mismatch: ${payload}`);
				validated.add(payload);
			}
			active.add(payload);
			// Decode each occurrence separately: callers retain normal JSON ownership,
			// so mutating one port cannot accidentally mutate another artifact.
			const result = decode(block);
			active.delete(payload);
			return result;
		}
		if (tag === "array" && Array.isArray(payload)) return payload.map(decode);
		if (tag === "object" && Array.isArray(payload)) {
			const entries: [string, unknown][] = [];
			const keys = new Set<string>();
			for (const entry of payload) {
				if (!Array.isArray(entry) || entry.length !== 2) {
					throw new Error("Invalid workflow output object entry");
				}
				const key = decode(entry[0]);
				if (typeof key !== "string" || keys.has(key)) throw new Error("Invalid workflow output object key");
				keys.add(key);
				entries.push([key, decode(entry[1])]);
			}
			return Object.fromEntries(entries);
		}
		throw new Error("Invalid workflow output storage container");
	};
	return decode(stored.root);
}

export function workflowOutputDelta(output: StoredWorkflowOutput, existingHashes: readonly string[]) {
	const existing = new Set(existingHashes);
	return {
		root: output.root,
		blockIds: Object.keys(output.blocks),
		blocks: Object.fromEntries(Object.entries(output.blocks).filter(([id]) => !existing.has(id))),
	};
}

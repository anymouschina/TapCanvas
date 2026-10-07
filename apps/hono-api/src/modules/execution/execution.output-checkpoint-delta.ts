import type { WorkflowOutputPatch } from "./execution.output-storage";

/** Already normalized JSON: finite numbers, dense arrays and plain data objects. */
export type WorkflowOutputCheckpointJson =
	| string | number | boolean | null
	| readonly WorkflowOutputCheckpointJson[]
	| Readonly<{ [key: string]: WorkflowOutputCheckpointJson }>;

type JsonObject = Readonly<{ [key: string]: WorkflowOutputCheckpointJson }>;
type JsonContainer = JsonObject | readonly WorkflowOutputCheckpointJson[];

function children(value: JsonContainer): Readonly<Record<string, PropertyDescriptor>> {
	const prototype: unknown = Object.getPrototypeOf(value);
	if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
		throw new Error("Workflow output checkpoint requires normalized plain JSON objects");
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new Error("Workflow output checkpoint cannot contain symbol keys");
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const [key, descriptor] of Object.entries(descriptors)) {
		if (Array.isArray(value) && key === "length") continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
			throw new Error("Workflow output checkpoint requires enumerable data properties");
		}
	}
	const keys = Object.keys(value);
	if (Array.isArray(value) && (keys.length !== value.length
		|| keys.some((key, index) => key !== String(index)))) {
		throw new Error("Workflow output checkpoint requires dense JSON arrays without extra properties");
	}
	return descriptors;
}

/**
 * Produces disjoint edits for patchWorkflowOutput. Callers own normalization
 * and immutability of both snapshots: this function never invokes toJSON,
 * getters or JSON normalization. Identity-equal branches are trusted and not
 * traversed; changed containers/replacement values reject non-JSON shapes.
 * Object key order is irrelevant. Array length changes replace the whole array
 * so emitted edits never share an index space with an insertion/deletion.
 */
export function diffWorkflowOutputCheckpoint(
	previous: WorkflowOutputCheckpointJson,
	next: WorkflowOutputCheckpointJson,
): readonly WorkflowOutputPatch[] {
	const operations: WorkflowOutputPatch[] = [];
	const previousAncestors = new Set<object>();
	const nextAncestors = new Set<object>();
	const checkedPrevious = new Set<object>();
	const checkedNext = new Set<object>();
	const validateValue = (value: WorkflowOutputCheckpointJson, ancestors: Set<object>, checked: Set<object>): void => {
		if (value === null || typeof value === "string" || typeof value === "boolean") return;
		if (typeof value === "number" && Number.isFinite(value)) return;
		if (typeof value !== "object" || ancestors.has(value)) {
			throw new Error("Workflow output checkpoint contains a non-JSON value or cycle");
		}
		if (checked.has(value)) return;
		ancestors.add(value);
		for (const [key, descriptor] of Object.entries(children(value))) {
			if (Array.isArray(value) && key === "length") continue;
			validateValue(descriptor.value as WorkflowOutputCheckpointJson, ancestors, checked);
		}
		ancestors.delete(value);
		checked.add(value);
	};
	const visit = (left: WorkflowOutputCheckpointJson, right: WorkflowOutputCheckpointJson, path: readonly (string | number)[]): void => {
		if (left === right) return;
		if (left !== null && right !== null && typeof left === "object" && typeof right === "object"
			&& Array.isArray(left) === Array.isArray(right)
			&& (!Array.isArray(left) || left.length === (right as readonly WorkflowOutputCheckpointJson[]).length)) {
			if (previousAncestors.has(left) || nextAncestors.has(right)) throw new Error("Workflow output checkpoint contains a cycle");
			const leftFields = children(left);
			const rightFields = children(right);
			previousAncestors.add(left); nextAncestors.add(right);
			for (const key of Object.keys(leftFields).sort()) {
				if (Array.isArray(left) && key === "length") continue;
				const childPath = [...path, Array.isArray(left) ? Number(key) : key];
				if (!Object.hasOwn(rightFields, key)) {
					validateValue(leftFields[key]!.value as WorkflowOutputCheckpointJson, previousAncestors, checkedPrevious);
					operations.push({ kind: "delete", path: childPath });
				}
				else visit(leftFields[key]!.value as WorkflowOutputCheckpointJson, rightFields[key]!.value as WorkflowOutputCheckpointJson, childPath);
			}
			for (const key of Object.keys(rightFields).sort()) {
				if (Object.hasOwn(leftFields, key)) continue;
				const value = rightFields[key]!.value as WorkflowOutputCheckpointJson;
				validateValue(value, nextAncestors, checkedNext);
				operations.push({ kind: "add", path: [...path, key], value });
			}
			previousAncestors.delete(left); nextAncestors.delete(right);
			return;
		}
		validateValue(left, previousAncestors, checkedPrevious);
		validateValue(right, nextAncestors, checkedNext);
		operations.push({ kind: "replace", path, value: right });
	};
	visit(previous, next, []);
	return operations;
}

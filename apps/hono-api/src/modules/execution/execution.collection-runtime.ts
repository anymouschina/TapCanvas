import { readMediaDeliveryPolicy } from "./execution.media-delivery-policy";
import { readItemContinuation, previousItemContinuation } from "./execution.item-continuation";
import {
	createWorkflowCollection,
	isWorkflowCollection,
	type WorkflowCollectionItemV1,
	type WorkflowCollectionV1,
	type WorkflowItemLineageV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type {
	WorkflowNodeExecutionResult,
	WorkflowNodeItemRunV1,
	WorkflowNodeOutputV1,
} from "./execution.node-runtime";
import {
	resolveWorkflowNodeExecutionMode,
	resolveWorkflowNodeItemConcurrency,
	workflowNodeWaiting,
} from "./execution.node-runtime";
import { isTransientDatabaseReadError, readDatabaseErrorCodes } from "../../platform/node/database-read-retry";
import { mergeWorkflowExternalCheckSchedules, workflowExternalPollAfter } from "./execution.external-check";
import type {
	WorkflowNodeExecutionContext,
	WorkflowNodeExecutorDependencies,
} from "./execution.node-executors";
import { isRetryableTerminalMediaItemRun } from "./execution.terminal-media-retry";
import { readWorkflowDurableRetryDirective } from "./execution.durable-retry";
import { readWorkflowAgentOutputRepair } from "./execution.agent-output-repair";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import {
	canonicalWorkflowOutputPortIds,
	resolveSingleWorkflowOutputPortBinding,
} from "./execution.output-port-binding";

type ExecuteOnce = (
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
) => Promise<WorkflowNodeExecutionResult>;

function hasDurableResultLookupReceipt(
	semantics: ReturnType<typeof resolveCoreWorkflowExecutorSemantics>,
	run: WorkflowNodeItemRunV1,
): boolean {
	const outputField = semantics?.resultLookup.outputField;
	if (!outputField) return false;
	const value = run.evidence[outputField];
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return value !== undefined && value !== null;
}

function canRefreshPersistedItemReceipt(
	recoveryOfExecutionId: string | null | undefined,
	semantics: ReturnType<typeof resolveCoreWorkflowExecutorSemantics>,
	run: WorkflowNodeItemRunV1,
): boolean {
	return Boolean(
		recoveryOfExecutionId
		&& run.status === "failed"
		&& typeof run.evidence.canvasNodeId === "string"
		&& run.evidence.canvasNodeId.trim().length > 0
		&& semantics?.retrySafety === "idempotency_key_required"
		&& hasDurableResultLookupReceipt(semantics, run)
	);
}

function isStructuredOutputTerminalFailure(run: WorkflowNodeItemRunV1): boolean {
	if (readWorkflowAgentOutputRepair(run.evidence)) return false;
	const outputContractFailure = run.evidence.outputContractFailure;
	if (
		outputContractFailure
		&& typeof outputContractFailure === "object"
		&& !Array.isArray(outputContractFailure)
		&& (outputContractFailure as Record<string, unknown>).code === "structured_output_invalid"
	) return true;
	// Hard-cut historical retry evidence as well. Older executions may predate
	// the first-class submission policy field, but their exact structural
	// failure code is enough to prevent a same-task model re-entry.
	return run.evidence.retryableFailure === "structured_output_invalid";
}

type CollectionInput = Readonly<{
	portId: string;
	inputIndex: number;
	collection: WorkflowCollectionV1;
}>;

type CollectionAlignment = Readonly<{
	primary: WorkflowCollectionV1 | null;
	/** One selected collection per input for each primary item index. */
	perPrimaryItem: readonly ReadonlyMap<string, WorkflowCollectionV1>[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readAtomicSpecRecord(
	context: WorkflowNodeExecutionContext,
): Record<string, unknown> | null {
	const raw = context.node.data.workflowAtomicSpec;
	return isRecord(raw) ? raw : null;
}

function readPathLeaves(value: unknown, path: string): readonly unknown[] {
	const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
	if (segments.length === 0) return [];
	let current: unknown[] = [value];
	for (const segment of segments) {
		current = current.flatMap((entry) => {
			const candidates = Array.isArray(entry) ? entry : [entry];
			return candidates.flatMap((candidate) => {
				return [isRecord(candidate) ? candidate[segment] : undefined];
			});
		});
	}
	return current;
}

function readPathValues(value: unknown, path: string): readonly string[] {
	const flattenStrings = (entry: unknown): readonly string[] => {
		if (Array.isArray(entry)) return entry.flatMap(flattenStrings);
		return typeof entry === "string" && entry.trim() ? [entry.trim()] : [];
	};
	return readPathLeaves(value, path).flatMap(flattenStrings);
}

function isJoinKeyValue(value: unknown): boolean {
	return Array.isArray(value) ? value.every(isJoinKeyValue) : typeof value === "string" && value.trim().length > 0;
}

function joinedCollection(
	collection: WorkflowCollectionV1,
	primaryItem: WorkflowCollectionItemV1,
	items: readonly WorkflowCollectionItemV1[],
): WorkflowCollectionV1 {
	return {
		protocolVersion: collection.protocolVersion,
		collectionId: `${collection.collectionId}:join:${primaryItem.itemId}`,
		items: items.map((item, index) => ({ ...item, index })),
	};
}

function collectionInputs(
	inputs: WorkflowNodeExecutionContext["inputs"],
): readonly CollectionInput[] {
	return Object.entries(inputs).flatMap(([portId, values]) => values.flatMap((value, inputIndex) => (
		isWorkflowCollection(value) ? [{ portId, inputIndex, collection: value }] : []
	)));
}

function sameItemAlignment(
	left: WorkflowCollectionV1,
	right: WorkflowCollectionV1,
): boolean {
	return left.items.length === right.items.length
		&& left.items.every((item, index) => item.itemId === right.items[index]?.itemId);
}

function alignedCollections(
	collections: readonly CollectionInput[],
): WorkflowCollectionV1 | null {
	const primary = collections[0]?.collection ?? null;
	if (!primary) return null;
	for (const candidate of collections.slice(1)) {
		if (!sameItemAlignment(primary, candidate.collection)) {
			throw new Error(
				`Workflow node received misaligned collections ${primary.collectionId} and ${candidate.collection.collectionId}; connect an explicit Zip or Cross Join node`,
			);
		}
	}
	return primary;
}

function keyedJoinCollections(
	collections: readonly CollectionInput[],
	context: WorkflowNodeExecutionContext,
): CollectionAlignment | null {
	const specValue = readAtomicSpecRecord(context)?.inputAlignment;
	if (!isRecord(specValue)) return null;
	const spec = specValue;
	if (spec.strategy !== "keyed_join") {
		throw new Error(`Workflow node ${context.node.id} has unsupported inputAlignment.strategy`);
	}
	const primaryPort = typeof spec.primaryPort === "string" ? spec.primaryPort.trim() : "";
	const primaryKeyPath = typeof spec.primaryKeyPath === "string" ? spec.primaryKeyPath.trim() : "";
	const candidateKeyPath = typeof spec.candidateKeyPath === "string" ? spec.candidateKeyPath.trim() : "";
	if (!primaryPort || !primaryKeyPath || !candidateKeyPath) {
		throw new Error(`Workflow node ${context.node.id} keyed_join requires primaryPort, primaryKeyPath and candidateKeyPath`);
	}
	const primaryInput = collections.find((input) => input.portId === primaryPort);
	if (!primaryInput) throw new Error(`Workflow node ${context.node.id} keyed_join primaryPort ${primaryPort} is not a collection input`);
	const candidatePortSet = Array.isArray(spec.candidatePorts)
		? new Set(spec.candidatePorts.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))
		: null;
	const candidateInputs = collections.filter((input) => (
		input.portId !== primaryPort && (!candidatePortSet || candidatePortSet.has(input.portId))
	));
	if (candidatePortSet) {
		const unconfigured = collections.filter((input) => (
			input.portId !== primaryPort && !candidatePortSet.has(input.portId)
		));
		if (unconfigured.length > 0) {
			throw new Error(`Workflow node ${context.node.id} keyed_join has unconfigured collection input ${unconfigured[0]!.portId}`);
		}
	}
	const primaryKeys = new Map<string, WorkflowCollectionItemV1>();
	for (const item of primaryInput.collection.items) {
		const keys = readPathValues(item.value, primaryKeyPath);
		if (keys.length !== 1) throw new Error(`Workflow node ${context.node.id} keyed_join primary item ${item.itemId} must resolve exactly one key at ${primaryKeyPath}`);
		const key = keys[0]!;
		if (primaryKeys.has(key)) throw new Error(`Workflow node ${context.node.id} keyed_join primary key ${key} is duplicated`);
		primaryKeys.set(key, item);
	}
	const groupedCandidates = candidateInputs.map((input) => {
		const groups = new Map<string, WorkflowCollectionItemV1[]>();
		for (const item of input.collection.items) {
			const leaves = readPathLeaves(item.value, candidateKeyPath);
			if (leaves.length === 0 || !leaves.every(isJoinKeyValue)) {
				throw new Error(`Workflow node ${context.node.id} keyed_join candidate item ${item.itemId} has a missing or invalid key at ${candidateKeyPath}`);
			}
			const keys = readPathValues(item.value, candidateKeyPath);
			// An explicitly empty relationship list has zero consumers. Keep its
			// materialized receipt upstream; it participates in no joined item.
			for (const key of new Set(keys)) {
				if (!primaryKeys.has(key)) throw new Error(`Workflow node ${context.node.id} keyed_join candidate key ${key} has no matching primary item`);
				const group = groups.get(key) ?? [];
				group.push(item);
				groups.set(key, group);
			}
		}
		return { input, groups };
	});
	const perPrimaryItem = primaryInput.collection.items.map((primaryItem) => {
		const key = readPathValues(primaryItem.value, primaryKeyPath)[0]!;
		const selected = new Map<string, WorkflowCollectionV1>();
		for (const { input, groups } of groupedCandidates) {
			selected.set(`${input.portId}:${input.inputIndex}`, joinedCollection(
				input.collection,
				primaryItem,
				groups.get(key) ?? [],
			));
		}
		selected.set(`${primaryInput.portId}:${primaryInput.inputIndex}`, joinedCollection(
			primaryInput.collection,
			primaryItem,
			[primaryItem],
		));
		return selected;
	});
	return { primary: primaryInput.collection, perPrimaryItem };
}

function itemInputs(
	inputs: WorkflowNodeExecutionContext["inputs"],
	collections: readonly CollectionInput[],
	itemIndex: number,
	selectedCollections?: ReadonlyMap<string, WorkflowCollectionV1>,
	primaryInputKey?: string,
): WorkflowNodeExecutionContext["inputs"] {
	const collectionByPosition = selectedCollections ?? new Map(
		collections.map((input) => [`${input.portId}:${input.inputIndex}`, input.collection] as const),
	);
	return Object.fromEntries(Object.entries(inputs).map(([portId, values]) => [
		portId,
		values.map((value, inputIndex) => {
			const inputKey = `${portId}:${inputIndex}`;
			const collection = collectionByPosition.get(inputKey);
			if (!collection) return value;
			if (selectedCollections && inputKey !== primaryInputKey) return collection;
			return collection.items[collection.items.length === 1 ? 0 : itemIndex]?.value;
		}),
	]));
}

function itemLineage(
	collections: readonly CollectionInput[],
	itemIndex: number,
	selectedCollections?: ReadonlyMap<string, WorkflowCollectionV1>,
	primaryInputKey?: string,
): readonly WorkflowItemLineageV1[] {
	const seen = new Set<string>();
	return collections.flatMap((input) => {
		const collection = selectedCollections?.get(`${input.portId}:${input.inputIndex}`) ?? input.collection;
		if (selectedCollections && `${input.portId}:${input.inputIndex}` !== primaryInputKey) {
			return collection.items.flatMap((item) => item.lineage);
		}
		return collection.items[collection.items.length === 1 ? 0 : itemIndex]?.lineage ?? [];
	}).filter((entry) => {
		const identity = `${entry.nodeId}\u0000${entry.portId}\u0000${entry.itemId}\u0000${entry.index}`;
		if (seen.has(identity)) return false;
		seen.add(identity);
		return true;
	});
}

function aggregatePortBindings(input: Readonly<{
	context: WorkflowNodeExecutionContext;
	successfulRuns: readonly WorkflowNodeItemRunV1[];
}>): readonly Readonly<{ outputPortId: string; itemPortId: string }>[] {
	const observedPortIds = [...new Set(input.successfulRuns.flatMap((run) => Object.keys(run.ports)))];
	const expectedPortIds = canonicalWorkflowOutputPortIds(input.context);
	// Workflow IR can omit optional atomicSpec.outputPorts while the topology
	// still declares the one canonical output. Low-level executors retain their
	// executor-specific output name (`result`, `image`, `video`, ...). When both
	// sides are structurally singular, bind that observed value to the topology
	// port. Ambiguous multi-port graphs remain untouched and fail explicitly.
	const singleBinding = resolveSingleWorkflowOutputPortBinding({
		context: input.context,
		observedPortIds,
	});
	if (singleBinding) return [singleBinding];
	return [...new Set([...expectedPortIds, ...observedPortIds])].map((portId) => ({
		outputPortId: portId,
		itemPortId: portId,
	}));
}

function executorRef(context: WorkflowNodeExecutionContext): string {
	const raw = context.node.data.workflowAtomicSpec;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
	const value = (raw as Record<string, unknown>).executorRef;
	return typeof value === "string" ? value.trim() : "";
}

function aggregateOutput(input: Readonly<{
	context: WorkflowNodeExecutionContext;
	primary: WorkflowCollectionV1;
	itemRuns: readonly WorkflowNodeItemRunV1[];
	itemConcurrency: number;
	concurrencyState: WorkflowCollectionConcurrencySnapshot;
	finalized: boolean;
}>): WorkflowNodeOutputV1 {
	const successfulRuns = input.itemRuns.filter((run) => run.status === "success");
	// Item execution is the runtime authority for the ports it actually produced.
	// Persisted Workflow IR may omit the optional atomicSpec.outputPorts metadata
	// while the executor still has a configured primary output port. Aggregating
	// only the metadata list makes a successful each-node lose all values at the
	// parent boundary. Keep declared empty ports for topology visibility and add
	// every observed successful port without interpreting its payload.
	const portBindings = aggregatePortBindings({
		context: input.context,
		successfulRuns,
	});
	const ports = Object.fromEntries(portBindings.map(({ outputPortId, itemPortId }) => {
		const values: unknown[] = [];
		const itemIds: string[] = [];
		const parentLineage: WorkflowItemLineageV1[][] = [];
		for (const run of successfulRuns) {
			if (!Object.prototype.hasOwnProperty.call(run.ports, itemPortId)) continue;
			values.push(run.ports[itemPortId]);
			itemIds.push(run.itemId);
			parentLineage.push([...run.lineage]);
		}
		return [outputPortId, createWorkflowCollection({
			collectionId: `${input.context.executionId}:${input.context.node.id}:${outputPortId}`,
			producerNodeId: input.context.node.id,
			producerPortId: outputPortId,
			values,
			itemIds,
			parentLineage,
		})] as const;
	}));
	return {
		protocolVersion: "1",
		executorRef: executorRef(input.context),
		nodeId: input.context.node.id,
		executionMode: "each",
		ports,
		artifacts: successfulRuns.flatMap((run) => run.artifacts),
		evidence: {
			executorCompleted: input.finalized && (input.itemRuns.every((run) => run.status === "success")
                || (readMediaDeliveryPolicy(input.context.node.data) !== null && successfulRuns.length > 0
                    && input.itemRuns.every(run => run.status === "success" || run.status === "failed"))),
            partial: input.itemRuns.some(run => run.status === "failed"),
			collectionId: input.primary.collectionId,
			itemConcurrency: input.itemConcurrency,
			configuredItemConcurrency: input.itemConcurrency,
			activeItems: input.concurrencyState.activeItemIds.length,
			activeItemIds: input.concurrencyState.activeItemIds,
			startedItems: input.concurrencyState.startedItemIds.length,
			startedItemIds: input.concurrencyState.startedItemIds,
			peakActiveItems: input.concurrencyState.peakActiveItems,
			completedItems: successfulRuns.length,
			failedItems: input.itemRuns.filter((run) => run.status === "failed").length,
			settledItems: input.itemRuns.length,
			waitingItems: input.itemRuns.filter((run) => run.status === "waiting_external").length,
			totalItems: input.primary.items.length,
		},
		itemRuns: input.itemRuns,
		...(input.itemRuns.some((run) => run.status === "waiting_external")
			? {
				externalCheck: mergeWorkflowExternalCheckSchedules(
					input.itemRuns
						.filter((run) => run.status === "waiting_external")
						.map((run) => {
							if (!run.externalCheck) {
								throw new Error(`Workflow waiting item ${run.itemId} is missing its external check receipt`);
							}
							return run.externalCheck;
						}),
				),
			}
			: {}),
	};
}

type WorkflowCollectionConcurrencySnapshot = Readonly<{
	activeItemIds: readonly string[];
	startedItemIds: readonly string[];
	peakActiveItems: number;
}>;

type WorkflowCollectionConcurrencyTracker = {
	activeItemIds: Set<string>;
	startedItemIds: Set<string>;
	peakActiveItems: number;
};

function snapshotCollectionConcurrency(
	tracker: WorkflowCollectionConcurrencyTracker,
): WorkflowCollectionConcurrencySnapshot {
	return {
		activeItemIds: [...tracker.activeItemIds].sort(),
		startedItemIds: [...tracker.startedItemIds].sort(),
		peakActiveItems: tracker.peakActiveItems,
	};
}

function runtimeItemNodeId(baseNodeId: string, item: WorkflowCollectionItemV1): string {
	return `${baseNodeId}::item::${encodeURIComponent(item.itemId)}`;
}

function matchingPreviousItemRuns(
	context: WorkflowNodeExecutionContext,
	primary: WorkflowCollectionV1,
): readonly WorkflowNodeItemRunV1[] {
	if (context.resumeOnly !== true || !context.resumeOutputRefs) return [];
	return primary.items.flatMap((item) => {
		const runtimeNodeId = runtimeItemNodeId(context.node.id, item);
		const previousRun = context.resumeOutputRefs?.itemRuns.find(
			(run) => run.itemId === item.itemId && run.runtimeNodeId === runtimeNodeId,
		);
		return previousRun ? [previousRun] : [];
	});
}

function mergeItemRunCheckpoints(
	previousRuns: readonly WorkflowNodeItemRunV1[],
	settledRuns: readonly WorkflowNodeItemRunV1[],
): readonly WorkflowNodeItemRunV1[] {
	const merged = new Map<string, WorkflowNodeItemRunV1>();
	for (const run of previousRuns) merged.set(`${run.itemId}\u0000${run.runtimeNodeId}`, run);
	for (const run of settledRuns) merged.set(`${run.itemId}\u0000${run.runtimeNodeId}`, run);
	return [...merged.values()].sort((left, right) => left.index - right.index);
}

class CollectionCheckpointFailure extends Error {
	constructor(readonly failure: unknown, readonly settledRuns: readonly WorkflowNodeItemRunV1[]) {
		super(failure instanceof Error ? failure.message : String(failure), { cause: failure });
	}
}

async function mapItemsWithConcurrency<T>(
	items: readonly T[],
	concurrency: number,
	mapItem: (item: T, index: number) => Promise<WorkflowNodeItemRunV1>,
	tracker: WorkflowCollectionConcurrencyTracker,
	itemIdentity: (item: T, index: number) => string,
	onSettled?: (
		settledResults: readonly WorkflowNodeItemRunV1[],
		concurrencyState: WorkflowCollectionConcurrencySnapshot,
	) => Promise<void>,
	shouldPauseScheduling?: (result: WorkflowNodeItemRunV1) => boolean,
): Promise<readonly WorkflowNodeItemRunV1[]> {
	if (items.length === 0) return [];
	const results: Array<WorkflowNodeItemRunV1 | undefined> = new Array(items.length);
	let cursor = 0;
	let schedulingPaused = false;
	let checkpointChain = Promise.resolve();
	let checkpointError: unknown = null;
	const worker = async (): Promise<void> => {
		while (
			cursor < items.length
			&& checkpointError === null
			&& !schedulingPaused
		) {
			const index = cursor;
			cursor += 1;
			const item = items[index];
			if (item === undefined) throw new Error(`Workflow collection item ${index} is missing`);
			const itemId = itemIdentity(item, index);
			tracker.activeItemIds.add(itemId);
			tracker.startedItemIds.add(itemId);
			tracker.peakActiveItems = Math.max(tracker.peakActiveItems, tracker.activeItemIds.size);
			let result: WorkflowNodeItemRunV1;
			try {
				result = await mapItem(item, index);
			} finally {
				tracker.activeItemIds.delete(itemId);
			}
			results[index] = result;
			if (shouldPauseScheduling?.(result) === true) schedulingPaused = true;
			if (onSettled) {
				const settledSnapshot = results.filter((result): result is WorkflowNodeItemRunV1 => result !== undefined);
				const concurrencyState = snapshotCollectionConcurrency(tracker);
				checkpointChain = checkpointChain.then(() => onSettled(settledSnapshot, concurrencyState));
				try {
					await checkpointChain;
				} catch (error: unknown) {
					checkpointError = error;
				}
			}
		}
	};
	await Promise.all(Array.from(
		{ length: Math.min(concurrency, items.length) },
		() => worker(),
	));
	if (checkpointError !== null) throw new CollectionCheckpointFailure(
		checkpointError instanceof CollectionCheckpointFailure ? checkpointError.failure : checkpointError,
		results.filter((result): result is WorkflowNodeItemRunV1 => result !== undefined),
	);
	if (schedulingPaused) {
		return results.filter((result): result is WorkflowNodeItemRunV1 => result !== undefined);
	}
	return results.map((result, index) => {
		if (result === undefined) throw new Error(`Workflow collection item ${index} did not produce a run result`);
		return result;
	});
}

export async function executeWorkflowNodeByMode(
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
	executeOnce: ExecuteOnce,
): Promise<WorkflowNodeExecutionResult> {
	const executionMode = resolveWorkflowNodeExecutionMode(context.node);
	if (!executionMode) {
		return {
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: `Workflow node ${context.node.id} has no valid executionMode`,
		};
	}
	if (executionMode !== "each") {
		const result = await executeOnce(context, dependencies);
		if (!result.ok) return result;
		return {
			...result,
			outputRefs: { ...result.outputRefs, executionMode },
		};
	}
	let itemConcurrency: number;
	let itemContinuation: ReturnType<typeof readItemContinuation>;
	try {
		itemConcurrency = resolveWorkflowNodeItemConcurrency(context.node);
		itemContinuation = readItemContinuation(context.node, itemConcurrency);
		if (itemContinuation && (context.inputs[itemContinuation.inputPort]?.length ?? 0) > 0) {
			throw new Error(`Item continuation input ${itemContinuation.inputPort} is owned by the collection, not an external binding`);
		}
	} catch (error: unknown) {
		return {
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}

	const collections = collectionInputs(context.inputs);
	let alignment: CollectionAlignment;
	try {
		const keyed = keyedJoinCollections(collections, context);
		alignment = keyed ?? {
			primary: alignedCollections(collections),
			perPrimaryItem: [],
		};
	} catch (error: unknown) {
		return {
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
	if (!alignment.primary) {
		const result = await executeOnce(context, dependencies);
		if (!result.ok) return result;
		return {
			...result,
			outputRefs: { ...result.outputRefs, executionMode: "each" },
		};
	}
	const primary = alignment.primary;

	const previousItemRuns = matchingPreviousItemRuns(context, primary);
	const collectionExecutorRef = executorRef(context);
	const collectionExecutorSemantics = collectionExecutorRef
		? resolveCoreWorkflowExecutorSemantics(collectionExecutorRef)
		: null;
	const pauseAfterExternalWait = itemContinuation
		? (run: WorkflowNodeItemRunV1) => run.status !== "success"
		: collectionExecutorSemantics?.retrySafety !== "idempotency_key_required"
		? (run: WorkflowNodeItemRunV1) => run.status === "waiting_external"
		: undefined;
	const concurrencyTracker: WorkflowCollectionConcurrencyTracker = {
		activeItemIds: new Set<string>(),
		startedItemIds: new Set<string>(),
		peakActiveItems: 0,
	};
	const itemIdentity = (item: WorkflowCollectionItemV1): string => item.itemId;
	let checkpointItems = previousItemRuns;
	let checkpointWrites = Promise.resolve();
	const checkpointItemsOutput = async (
		updates: readonly WorkflowNodeItemRunV1[],
		concurrencyState: WorkflowCollectionConcurrencySnapshot,
	): Promise<void> => {
		checkpointItems = mergeItemRunCheckpoints(checkpointItems, updates);
		const output = aggregateOutput({
			context, primary, itemRuns: checkpointItems, itemConcurrency,
			concurrencyState, finalized: false,
		});
		checkpointWrites = checkpointWrites.then(() => context.checkpointOutputRefs?.(output));
		try {
			await checkpointWrites;
		} catch (error: unknown) {
			throw new CollectionCheckpointFailure(
				error instanceof CollectionCheckpointFailure ? error.failure : error,
				checkpointItems,
			);
		}
	};
	// Reconciliation fairness: every already-accepted external wait must receive
	// a poll even when an earlier sibling remains waiting. Put persisted waits at
	// the front and force that prefix to be scheduled; a newly discovered wait
	// still pauses untouched/new work, so no additional business side effects are
	// admitted while the accepted frontier is unsettled.
	const waitingRuntimeNodeIds = new Set(previousItemRuns
		.filter((run) => run.status === "waiting_external"
			|| canRefreshPersistedItemReceipt(context.recoveryOfExecutionId, collectionExecutorSemantics, run))
		.map((run) => run.runtimeNodeId));
	const waitingItems = primary.items.filter((item) => (
		waitingRuntimeNodeIds.has(runtimeItemNodeId(context.node.id, item))
	));
	const untouchedItems = primary.items.filter((item) => (
		!waitingRuntimeNodeIds.has(runtimeItemNodeId(context.node.id, item))
	));
	const executeItem = async (item: WorkflowCollectionItemV1): Promise<WorkflowNodeItemRunV1> => {
		const selectedCollections = alignment.perPrimaryItem[item.index];
		const primaryInputKey = (() => {
			const spec = readAtomicSpecRecord(context)?.inputAlignment;
			if (!isRecord(spec) || typeof spec.primaryPort !== "string") return undefined;
			const primaryInput = collections.find((input) => input.portId === spec.primaryPort);
			return primaryInput ? `${primaryInput.portId}:${primaryInput.inputIndex}` : undefined;
		})();
		const lineage = itemLineage(collections, item.index, selectedCollections, primaryInputKey);
		const runtimeNodeId = runtimeItemNodeId(context.node.id, item);
		const previousRun = context.resumeOutputRefs?.itemRuns.find(
			(run) => run.itemId === item.itemId && run.runtimeNodeId === runtimeNodeId,
		);
		const structuredOutputTerminalFailure = previousRun
			? isStructuredOutputTerminalFailure(previousRun)
			: false;
		const retryableTerminalFailure = previousRun
			? !structuredOutputTerminalFailure && (
				isRetryableTerminalMediaItemRun(executorRef(context), previousRun)
				|| readWorkflowDurableRetryDirective({ evidence: previousRun.evidence }) !== null
			)
			: false;
		// An explicit execution-family recovery is a new physical execution over
		// the same logical effect identities. Successful collection items remain
		// reusable. A failed idempotent/reconcilable item without its declared
		// durable lookup receipt never materialized an addressable external effect,
		// so it must execute again; otherwise a pre-submit validation failure would
		// be copied forever and definition cutovers could never repair it. Once the
		// receipt exists, keep the previous failure and require reconciliation rather
		// than admitting another paid submission. Unsafe/manual executors stay closed.
		const currentExecutorRef = collectionExecutorRef;
		const executorSemantics = collectionExecutorSemantics;
		const replayFailedItem = context.recoveryOfExecutionId != null
			&& previousRun?.status === "failed"
			&& !structuredOutputTerminalFailure
			&& (
				currentExecutorRef === "agents.logical-task/v2"
				|| executorSemantics?.sideEffect === "none"
				|| (
					executorSemantics?.retrySafety === "idempotency_key_required"
					&& !hasDurableResultLookupReceipt(executorSemantics, previousRun)
				)
			);
		// Explicit family recovery may refresh an existing receipt, never authorize a new paid effect.
		const reconcileFailedItem = previousRun
			? canRefreshPersistedItemReceipt(context.recoveryOfExecutionId, executorSemantics, previousRun)
			: false;
		if (
			context.resumeOnly === true
			&& previousRun
			&& (
				previousRun.status === "success"
				|| (
					previousRun.status === "failed"
					&& !retryableTerminalFailure
					&& !replayFailedItem
					&& !reconcileFailedItem
				)
			)
		) {
			return previousRun;
		}
		let result: WorkflowNodeExecutionResult;
		try {
			const resumeCurrentItem = context.resumeOnly === true
				&& !replayFailedItem
				&& (
					previousRun?.status === "waiting_external"
					|| retryableTerminalFailure
					|| reconcileFailedItem
				);
			const inputs = itemInputs(context.inputs, collections, item.index, selectedCollections, primaryInputKey);
			const previousItem = primary.items[item.index - 1];
			const continuationInputs = itemContinuation ? {
				[itemContinuation.inputPort]: [previousItemContinuation({
					spec: itemContinuation, index: item.index,
					previousItemId: previousItem?.itemId ?? null,
					previousRuntimeNodeId: previousItem ? runtimeItemNodeId(context.node.id, previousItem) : null,
					runs: checkpointItems,
				})],
			} : {};
			result = await executeOnce({
				...context,
				node: { ...context.node, id: runtimeNodeId },
				checkpointOutputRefs: context.checkpointOutputRefs ? async (output) => {
					if (output.nodeId !== runtimeNodeId || !output.externalCheck) {
						throw new Error(`Workflow item checkpoint requires its exact identity and external check: ${runtimeNodeId}`);
					}
					await checkpointItemsOutput([{
						itemId: item.itemId, index: item.index, runtimeNodeId, lineage,
						status: "waiting_external", ports: output.ports,
						artifacts: output.artifacts, evidence: output.evidence,
						externalCheck: output.externalCheck,
					}], snapshotCollectionConcurrency(concurrencyTracker));
				} : undefined,
				inputs: { ...inputs, ...continuationInputs },
				runtimeItemIndex: item.index,
				resumeOnly: resumeCurrentItem,
			}, dependencies);
		} catch (error: unknown) {
			const lastCheckpoint = checkpointItems.find((run) => run.runtimeNodeId === runtimeNodeId) ?? previousRun;
			if (error instanceof CollectionCheckpointFailure && lastCheckpoint) {
				// Persistence failed, not the executor. Keep its accepted candidate/receipt
				// waiting so collection recovery can reconcile it without replaying work.
				// The rejected checkpoint queue still reaches the collection boundary,
				// where the database failure is diagnosed and recovery is scheduled.
				return lastCheckpoint;
			}
			return {
				itemId: item.itemId,
				index: item.index,
				status: "failed",
				runtimeNodeId,
				lineage,
				// A failed observation cannot erase an already accepted effect or its outputs.
				ports: lastCheckpoint?.ports ?? {},
				artifacts: lastCheckpoint?.artifacts ?? [],
				evidence: { ...lastCheckpoint?.evidence, observationFailure: {
					observedAt: new Date().toISOString(),
					message: error instanceof Error ? error.message : String(error),
				} },
				errorCode: "workflow_node_runtime_failed",
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}
		if (result.ok) {
			return {
				itemId: item.itemId,
				index: item.index,
				status: "success",
				runtimeNodeId,
				lineage,
				ports: result.outputRefs.ports,
				artifacts: result.outputRefs.artifacts,
				evidence: { ...result.outputRefs.evidence, executorRef: result.outputRefs.executorRef },
			};
		} else if (result.waitingExternal === true) {
			return {
				itemId: item.itemId,
				index: item.index,
				status: "waiting_external",
				runtimeNodeId,
				lineage,
				ports: result.outputRefs.ports,
				artifacts: result.outputRefs.artifacts,
				evidence: result.outputRefs.evidence,
				externalCheck: result.externalCheck,
			};
		} else {
			return {
				itemId: item.itemId,
				index: item.index,
				status: "failed",
				runtimeNodeId,
				lineage,
				ports: result.outputRefs?.ports ?? {},
				artifacts: result.outputRefs?.artifacts ?? [],
				evidence: result.outputRefs?.evidence ?? {},
				errorCode: result.errorCode,
				errorMessage: result.errorMessage,
			};
		}
	};
	let settledPriorPhases: readonly WorkflowNodeItemRunV1[] = [];
	const checkpointSettledRuns = context.checkpointOutputRefs || itemContinuation
		? async (
			settledRuns: readonly WorkflowNodeItemRunV1[],
			concurrencyState: WorkflowCollectionConcurrencySnapshot,
		) => checkpointItemsOutput([
				...settledPriorPhases,
				...settledRuns,
			], concurrencyState)
		: undefined;
	let itemRuns: readonly WorkflowNodeItemRunV1[];
	try {
		if (waitingItems.length > 0) {
			// Reconcile the complete accepted frontier as a barrier. A concurrent
			// worker cannot claim untouched work until every older external wait has
			// settled and none remains waiting.
			const reconciledWaitingRuns = await mapItemsWithConcurrency(
				waitingItems,
				itemConcurrency,
				executeItem,
				concurrencyTracker,
				itemIdentity,
				checkpointSettledRuns,
			);
			settledPriorPhases = reconciledWaitingRuns;
			if (reconciledWaitingRuns.some((run) => run.status === "waiting_external")) {
				itemRuns = reconciledWaitingRuns;
			} else {
				const newlyScheduledRuns = await mapItemsWithConcurrency(
					untouchedItems,
					itemConcurrency,
					executeItem,
					concurrencyTracker,
					itemIdentity,
					checkpointSettledRuns,
					pauseAfterExternalWait,
				);
				itemRuns = [...reconciledWaitingRuns, ...newlyScheduledRuns];
			}
		} else {
			itemRuns = await mapItemsWithConcurrency(
				primary.items,
				itemConcurrency,
				executeItem,
				concurrencyTracker,
				itemIdentity,
				checkpointSettledRuns,
				pauseAfterExternalWait,
			);
		}
	} catch (error: unknown) {
		if (!(error instanceof CollectionCheckpointFailure)) throw error;
		// All already-started workers have settled. Preserve their exact receipts,
		// including results whose queued checkpoint never ran after an earlier error.
		const preservedRuns = mergeItemRunCheckpoints(checkpointItems, error.settledRuns);
		const failure = {
			observedAt: new Date().toISOString(),
			message: error.message,
			errorCodes: readDatabaseErrorCodes(error.failure),
		};
		console.error(JSON.stringify({ ...failure, message: "workflow_collection_checkpoint_failed",
			executionId: context.executionId, nodeId: context.node.id,
			settledItems: preservedRuns.length,
			stack: error.failure instanceof Error ? error.failure.stack : null,
		}));
		const preservedOutput = aggregateOutput({ context, primary, itemRuns: preservedRuns,
			itemConcurrency, concurrencyState: snapshotCollectionConcurrency(concurrencyTracker), finalized: false });
		const outputRefs = { ...preservedOutput,
			evidence: { ...preservedOutput.evidence, checkpointPersistenceFailure: failure } };
		// This schedules reconciliation of receipts, never replay of a provider action.
		// P2028 is admitted only at this database checkpoint boundary.
		if (isTransientDatabaseReadError(error.failure) || failure.errorCodes.includes("P2028")) {
			return workflowNodeWaiting(outputRefs, workflowExternalPollAfter(5_000));
		}
		return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error.message, outputRefs };
	}

	const mergedItemRuns = mergeItemRunCheckpoints(previousItemRuns, itemRuns);
	const outputRefs = aggregateOutput({
		context,
		primary,
		itemRuns: mergedItemRuns,
		itemConcurrency,
		concurrencyState: snapshotCollectionConcurrency(concurrencyTracker),
		finalized: mergedItemRuns.length === primary.items.length,
	});
	const failedRuns = mergedItemRuns.filter((run) => run.status === "failed");
	const waitingRuns = mergedItemRuns.filter((run) => run.status === "waiting_external");
	// Accepted sibling work remains owned by this collection until it settles.
	// Failures stay explicit in itemRuns/evidence; waiting never claims success.
	if (waitingRuns.length > 0) {
		if (!outputRefs.externalCheck) {
			throw new Error(`Workflow collection node ${context.node.id} is missing its external check receipt`);
		}
		return workflowNodeWaiting(outputRefs, outputRefs.externalCheck);
	}
	if (failedRuns.length > 0 && !(readMediaDeliveryPolicy(context.node.data)
        && mergedItemRuns.some(run => run.status === "success"))) {
		const firstFailure = failedRuns[0];
		const exactFailure = firstFailure?.errorMessage?.trim();
		return {
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: `Workflow node ${context.node.id} failed ${failedRuns.length}/${mergedItemRuns.length} item executions${exactFailure ? `: ${exactFailure}` : ""}`,
			outputRefs,
		};
	}
	return { ok: true, outputRefs };
}

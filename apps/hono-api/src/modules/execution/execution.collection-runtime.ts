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
import { mergeWorkflowExternalCheckSchedules } from "./execution.external-check";
import type {
	WorkflowNodeExecutionContext,
	WorkflowNodeExecutorDependencies,
} from "./execution.node-executors";
import { isRetryableTerminalMediaItemRun } from "./execution.terminal-media-retry";
import { readWorkflowDurableRetryDirective } from "./execution.durable-retry";
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

function isStructuredOutputTerminalFailure(run: WorkflowNodeItemRunV1): boolean {
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

function itemInputs(
	inputs: WorkflowNodeExecutionContext["inputs"],
	collections: readonly CollectionInput[],
	itemIndex: number,
): WorkflowNodeExecutionContext["inputs"] {
	const collectionByPosition = new Map(
		collections.map((input) => [`${input.portId}:${input.inputIndex}`, input.collection] as const),
	);
	return Object.fromEntries(Object.entries(inputs).map(([portId, values]) => [
		portId,
		values.map((value, inputIndex) => {
			const collection = collectionByPosition.get(`${portId}:${inputIndex}`);
			return collection ? collection.items[itemIndex]?.value : value;
		}),
	]));
}

function itemLineage(collections: readonly CollectionInput[], itemIndex: number): readonly WorkflowItemLineageV1[] {
	const seen = new Set<string>();
	return collections.flatMap(({ collection }) => collection.items[itemIndex]?.lineage ?? []).filter((entry) => {
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
			executorCompleted: input.finalized && input.itemRuns.every((run) => run.status === "success"),
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

async function mapItemsWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapItem: (item: T, index: number) => Promise<R>,
	tracker: WorkflowCollectionConcurrencyTracker,
	itemIdentity: (item: T, index: number) => string,
	onSettled?: (
		settledResults: readonly R[],
		concurrencyState: WorkflowCollectionConcurrencySnapshot,
	) => Promise<void>,
	shouldPauseScheduling?: (result: R) => boolean,
): Promise<readonly R[]> {
	if (items.length === 0) return [];
	const results: Array<R | undefined> = new Array(items.length);
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
			let result: R;
			try {
				result = await mapItem(item, index);
			} finally {
				tracker.activeItemIds.delete(itemId);
			}
			results[index] = result;
			if (shouldPauseScheduling?.(result) === true) schedulingPaused = true;
			if (onSettled) {
				const settledSnapshot = results.filter((result): result is R => result !== undefined);
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
	if (checkpointError !== null) throw checkpointError;
	if (schedulingPaused) {
		return results.filter((result): result is R => result !== undefined);
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
	try {
		itemConcurrency = resolveWorkflowNodeItemConcurrency(context.node);
	} catch (error: unknown) {
		return {
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}

	const collections = collectionInputs(context.inputs);
	let primary: WorkflowCollectionV1 | null;
	try {
		primary = alignedCollections(collections);
	} catch (error: unknown) {
		return {
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
	if (!primary) {
		const result = await executeOnce(context, dependencies);
		if (!result.ok) return result;
		return {
			...result,
			outputRefs: { ...result.outputRefs, executionMode: "each" },
		};
	}

	const previousItemRuns = matchingPreviousItemRuns(context, primary);
	const collectionExecutorRef = executorRef(context);
	const collectionExecutorSemantics = collectionExecutorRef
		? resolveCoreWorkflowExecutorSemantics(collectionExecutorRef)
		: null;
	const pauseAfterExternalWait = collectionExecutorSemantics?.retrySafety !== "idempotency_key_required"
		? (run: WorkflowNodeItemRunV1) => run.status === "waiting_external"
		: undefined;
	const concurrencyTracker: WorkflowCollectionConcurrencyTracker = {
		activeItemIds: new Set<string>(),
		startedItemIds: new Set<string>(),
		peakActiveItems: 0,
	};
	const itemIdentity = (item: WorkflowCollectionItemV1): string => item.itemId;
	// Reconciliation fairness: every already-accepted external wait must receive
	// a poll even when an earlier sibling remains waiting. Put persisted waits at
	// the front and force that prefix to be scheduled; a newly discovered wait
	// still pauses untouched/new work, so no additional business side effects are
	// admitted while the accepted frontier is unsettled.
	const waitingRuntimeNodeIds = new Set(previousItemRuns
		.filter((run) => run.status === "waiting_external")
		.map((run) => run.runtimeNodeId));
	const waitingItems = primary.items.filter((item) => (
		waitingRuntimeNodeIds.has(runtimeItemNodeId(context.node.id, item))
	));
	const untouchedItems = primary.items.filter((item) => (
		!waitingRuntimeNodeIds.has(runtimeItemNodeId(context.node.id, item))
	));
	const executeItem = async (item: WorkflowCollectionItemV1): Promise<WorkflowNodeItemRunV1> => {
		const lineage = itemLineage(collections, item.index);
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
		if (
			context.resumeOnly === true
			&& previousRun
			&& (
				previousRun.status === "success"
				|| (
					previousRun.status === "failed"
					&& !retryableTerminalFailure
					&& !replayFailedItem
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
				);
			result = await executeOnce({
				...context,
				node: { ...context.node, id: runtimeNodeId },
				inputs: itemInputs(context.inputs, collections, item.index),
				runtimeItemIndex: item.index,
				resumeOnly: resumeCurrentItem,
			}, dependencies);
		} catch (error: unknown) {
			return {
				itemId: item.itemId,
				index: item.index,
				status: "failed",
				runtimeNodeId,
				lineage,
				ports: {},
				artifacts: [],
				evidence: {},
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
	const checkpointSettledRuns = context.checkpointOutputRefs
		? async (
			settledRuns: readonly WorkflowNodeItemRunV1[],
			concurrencyState: WorkflowCollectionConcurrencySnapshot,
		) => context.checkpointOutputRefs?.(aggregateOutput({
			context,
			primary,
			itemRuns: mergeItemRunCheckpoints(previousItemRuns, [
				...settledPriorPhases,
				...settledRuns,
			]),
			itemConcurrency,
			concurrencyState,
			finalized: false,
		}))
		: undefined;
	let itemRuns: readonly WorkflowNodeItemRunV1[];
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
	// A deterministic terminal item failure is the collection's user-visible
	// terminal fact even when sibling provider tasks are still in flight. Their
	// durable task receipts remain in outputRefs and the media orphan reconciler
	// continues materializing them independently; keeping the parent in
	// waiting_external only hides a known failure and consumes execution budget.
	if (failedRuns.length > 0) {
		const firstFailure = failedRuns[0];
		const exactFailure = firstFailure?.errorMessage?.trim();
		return {
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: `Workflow node ${context.node.id} failed ${failedRuns.length}/${mergedItemRuns.length} item executions${exactFailure ? `: ${exactFailure}` : ""}`,
			outputRefs,
		};
	}
	if (waitingRuns.length > 0) {
		if (!outputRefs.externalCheck) {
			throw new Error(`Workflow collection node ${context.node.id} is missing its external check receipt`);
		}
		return workflowNodeWaiting(outputRefs, outputRefs.externalCheck);
	}
	return { ok: true, outputRefs };
}

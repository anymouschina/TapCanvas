import {
	VIDEO_AUTHORING_GRAPH_NODE_KINDS,
	VIDEO_AUTHORING_GRAPH_NODE_STATES,
	VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION,
	type VideoAuthoringGraph,
	type VideoAuthoringExecutionScope,
	type VideoAuthoringGraphNode,
	type VideoAuthoringGraphNodeKind,
	type VideoAuthoringGraphNodeState,
} from "@tapcanvas/video-orchestrator-protocol";

export const AUTHORING_GRAPH_MANIFEST_ARTIFACT_KEY = "graph:manifest";
export const AUTHORING_BEAT_SHEET_NODE_KEY = "beat_sheet";
export const AUTHORING_ASSET_COVERAGE_NODE_KEY = "asset:coverage";
export const AUTHORING_ASSEMBLY_NODE_KEY = "assembly:verification";
export const AUTHORING_PROMPT_PACKAGE_NODE_KEY = "prompt:package";
export const AUTHORING_ESTIMATE_NODE_KEY = "estimate:auto";
export const AUTHORING_PRODUCTION_HANDOFF_NODE_KEY = "production:handoff";
export const AUTHORING_CONCAT_NODE_KEY = "concat:auto";
export const AUTHORING_DELIVERY_VERIFY_NODE_KEY = "delivery:verify";

export function videoResultArtifactKey(clipIndex: number): string {
	return `video-result:${clipIndex}`;
}

export function videoSubmissionGraphNodeKey(clipIndex: number): string {
	return `video-submission:${clipIndex}`;
}

const NODE_KIND_SET = new Set<string>(VIDEO_AUTHORING_GRAPH_NODE_KINDS);

type GraphValidationResult =
	| Readonly<{ ok: true; graph: VideoAuthoringGraph }>
	| Readonly<{ ok: false; code: string; message: string }>;

function readRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readNode(value: unknown): VideoAuthoringGraphNode | null {
	const record = readRecord(value);
	if (!record) return null;
	const key = typeof record.key === "string" ? record.key.trim() : "";
	const kind = typeof record.kind === "string" && NODE_KIND_SET.has(record.kind)
		? record.kind as VideoAuthoringGraphNodeKind
		: null;
	const dependsOn = Array.isArray(record.dependsOn)
		? record.dependsOn.map((dependency) => typeof dependency === "string" ? dependency.trim() : "")
		: null;
	const clipIndex = record.clipIndex === undefined
		? undefined
		: typeof record.clipIndex === "number" && Number.isInteger(record.clipIndex) && record.clipIndex >= 0
			? record.clipIndex
			: null;
	if (!key || !kind || !dependsOn || dependsOn.some((dependency) => !dependency) || clipIndex === null) return null;
	const isClipScoped = kind === "clip_writer" || kind === "video_submission" || kind === "video_result";
	if (isClipScoped && clipIndex === undefined) return null;
	if (!isClipScoped && clipIndex !== undefined) return null;
	return {
		key,
		kind,
		dependsOn: [...new Set(dependsOn)],
		...(clipIndex !== undefined ? { clipIndex } : {}),
	};
}

export function compileVideoAuthoringGraph(input: {
	runId: string;
	clipIndexes: readonly number[];
	executionScope: VideoAuthoringExecutionScope;
}): VideoAuthoringGraph {
	const runId = input.runId.trim();
	if (!runId) throw new Error("video_authoring_graph_run_id_required");
	const clipIndexes = [...new Set(input.clipIndexes)].sort((left, right) => left - right);
	if (
		clipIndexes.length === 0 ||
		clipIndexes.some((clipIndex) => !Number.isInteger(clipIndex) || clipIndex < 0)
	) {
		throw new Error("video_authoring_graph_clip_indexes_invalid");
	}
	const clipNodes: VideoAuthoringGraphNode[] = clipIndexes.map((clipIndex) => ({
		key: `clip:${clipIndex}`,
		kind: "clip_writer",
		clipIndex,
		dependsOn: input.executionScope === "prompt_only"
			? [AUTHORING_BEAT_SHEET_NODE_KEY]
			: [AUTHORING_ASSET_COVERAGE_NODE_KEY],
	}));
	if (input.executionScope === "prompt_only") {
		return {
			protocolVersion: VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION,
			runId,
			executionScope: input.executionScope,
			nodes: [
				{ key: AUTHORING_BEAT_SHEET_NODE_KEY, kind: "beat_sheet", dependsOn: [] },
				...clipNodes,
				{
					key: AUTHORING_ASSEMBLY_NODE_KEY,
					kind: "assembly",
					dependsOn: clipNodes.map((node) => node.key),
				},
				{
					key: AUTHORING_PROMPT_PACKAGE_NODE_KEY,
					kind: "prompt_package",
					dependsOn: [AUTHORING_ASSEMBLY_NODE_KEY],
				},
			],
		};
	}
	const submissionNodes: VideoAuthoringGraphNode[] = clipIndexes.map((clipIndex) => ({
		key: videoSubmissionGraphNodeKey(clipIndex),
		kind: "video_submission",
		clipIndex,
		dependsOn: [AUTHORING_PRODUCTION_HANDOFF_NODE_KEY],
	}));
	const resultNodes: VideoAuthoringGraphNode[] = clipIndexes.map((clipIndex) => ({
		key: videoResultArtifactKey(clipIndex),
		kind: "video_result",
		clipIndex,
		dependsOn: [videoSubmissionGraphNodeKey(clipIndex)],
	}));
	return {
		protocolVersion: VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION,
		runId,
		executionScope: input.executionScope,
		nodes: [
			{ key: AUTHORING_BEAT_SHEET_NODE_KEY, kind: "beat_sheet", dependsOn: [] },
			{
				key: AUTHORING_ASSET_COVERAGE_NODE_KEY,
				kind: "asset_coverage",
				dependsOn: [AUTHORING_BEAT_SHEET_NODE_KEY],
			},
			...clipNodes,
			{
				key: AUTHORING_ASSEMBLY_NODE_KEY,
				kind: "assembly",
				dependsOn: clipNodes.map((node) => node.key),
			},
			{
				key: AUTHORING_ESTIMATE_NODE_KEY,
				kind: "estimate",
				dependsOn: [AUTHORING_ASSEMBLY_NODE_KEY, AUTHORING_ASSET_COVERAGE_NODE_KEY],
			},
			{
				key: AUTHORING_PRODUCTION_HANDOFF_NODE_KEY,
				kind: "production_handoff",
				dependsOn: [AUTHORING_ESTIMATE_NODE_KEY],
			},
			...submissionNodes,
			...resultNodes,
			{
				key: AUTHORING_CONCAT_NODE_KEY,
				kind: "concat",
				dependsOn: resultNodes.map((node) => node.key),
			},
			{
				key: AUTHORING_DELIVERY_VERIFY_NODE_KEY,
				kind: "delivery_verify",
				dependsOn: [AUTHORING_CONCAT_NODE_KEY],
			},
		],
	};
}

export type VideoAuthoringGraphNodeProjection = Readonly<{
	key: string;
	kind: VideoAuthoringGraphNodeKind;
	state: VideoAuthoringGraphNodeState;
	dependsOn: readonly string[];
	blockedBy: readonly string[];
	clipIndex?: number;
}>;

export type VideoAuthoringGraphProjection = Readonly<{
	runId: string;
	executionScope: VideoAuthoringExecutionScope;
	nodes: readonly VideoAuthoringGraphNodeProjection[];
	readyQueue: readonly string[];
	running: readonly string[];
	waitingExternal: readonly string[];
	failed: readonly string[];
	complete: boolean;
}>;

export type VideoAuthoringGraphArtifact = Readonly<{
	artifact_key: string;
	status: string;
	payload: string | null;
}>;

export type VideoAuthoringGraphArtifactProjectionResult =
	| Readonly<{
		ok: true;
		graph: VideoAuthoringGraph;
		projection: VideoAuthoringGraphProjection;
	}>
	| Readonly<{ ok: false; code: string; message: string }>;

export type VideoAuthoringGraphControlAction =
	| "prepare_assets_and_writers"
	| "drive_writers"
	| "repair_writers"
	| "assemble"
	| "package_prompts"
	| "estimate_and_handoff"
	| "wait_asset_repair"
	| "authoring_complete";

function parseArtifactPayload(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	try {
		return readRecord(JSON.parse(value) as unknown);
	} catch {
		return null;
	}
}

/**
 * A delivery verifier receipt can be durably written before all external
 * evidence arrives. Project that exact structured evidence gap as an external
 * wait so an older ready receipt cannot close the production DAG prematurely.
 */
function projectArtifactNodeState(
	artifact: VideoAuthoringGraphArtifact,
): VideoAuthoringGraphNodeState {
	const state = artifact.status as VideoAuthoringGraphNodeState;
	if (
		artifact.artifact_key !== AUTHORING_DELIVERY_VERIFY_NODE_KEY ||
		state !== "ready"
	) return state;
	const payload = parseArtifactPayload(artifact.payload);
	const verification = readRecord(payload?.deliveryVerification);
	const missingCriteria = Array.isArray(verification?.missingCriteria)
		? verification.missingCriteria.filter((criterion): criterion is string => typeof criterion === "string")
		: [];
	return verification?.satisfied === false && missingCriteria.includes("finalMediaProbe")
		? "waiting_external"
		: state;
}

export type VideoProductionGraphDriveDecision = Readonly<{
	disposition: "drive" | "complete" | "failed";
	reason: string;
}>;

const GRAPH_NODE_STATE_SET = new Set<string>(VIDEO_AUTHORING_GRAPH_NODE_STATES);

function sameDependencySet(actual: readonly string[], expected: readonly string[]): boolean {
	if (actual.length !== expected.length) return false;
	const actualSet = new Set(actual);
	return expected.every((dependency) => actualSet.has(dependency));
}

function validateCompiledVideoTopology(
	nodes: readonly VideoAuthoringGraphNode[],
	executionScope: VideoAuthoringExecutionScope,
): string | null {
	if (executionScope === "prompt_only") {
		const allowedKinds = new Set<VideoAuthoringGraphNodeKind>([
			"beat_sheet",
			"clip_writer",
			"assembly",
			"prompt_package",
		]);
		if (nodes.some((node) => !allowedKinds.has(node.kind))) return "prompt_only:media_node_present";
		const beatSheets = nodes.filter((node) => node.kind === "beat_sheet");
		if (
			beatSheets.length !== 1 ||
			beatSheets[0]?.key !== AUTHORING_BEAT_SHEET_NODE_KEY ||
			beatSheets[0].dependsOn.length !== 0
		) return "prompt_only:beat_sheet";
		const writers = nodes.filter((node) => node.kind === "clip_writer");
		if (writers.length === 0) return "prompt_only:clip_writer_empty";
		if (writers.some((node) =>
			node.clipIndex === undefined ||
			node.key !== `clip:${node.clipIndex}` ||
			!sameDependencySet(node.dependsOn, [AUTHORING_BEAT_SHEET_NODE_KEY])
		)) return "prompt_only:clip_writer_shape";
		const assemblies = nodes.filter((node) => node.kind === "assembly");
		if (
			assemblies.length !== 1 ||
			assemblies[0]?.key !== AUTHORING_ASSEMBLY_NODE_KEY ||
			!sameDependencySet(assemblies[0].dependsOn, writers.map((node) => node.key))
		) return "prompt_only:assembly";
		const packages = nodes.filter((node) => node.kind === "prompt_package");
		if (
			packages.length !== 1 ||
			packages[0]?.key !== AUTHORING_PROMPT_PACKAGE_NODE_KEY ||
			!sameDependencySet(packages[0].dependsOn, [AUTHORING_ASSEMBLY_NODE_KEY])
		) return "prompt_only:package";
		return null;
	}
	const singletonContracts: readonly Readonly<{
		key: string;
		kind: VideoAuthoringGraphNodeKind;
		dependsOn: readonly string[];
	}>[] = [
		{ key: AUTHORING_BEAT_SHEET_NODE_KEY, kind: "beat_sheet", dependsOn: [] },
		{ key: AUTHORING_ASSET_COVERAGE_NODE_KEY, kind: "asset_coverage", dependsOn: [AUTHORING_BEAT_SHEET_NODE_KEY] },
		{ key: AUTHORING_ESTIMATE_NODE_KEY, kind: "estimate", dependsOn: [AUTHORING_ASSEMBLY_NODE_KEY, AUTHORING_ASSET_COVERAGE_NODE_KEY] },
		{ key: AUTHORING_PRODUCTION_HANDOFF_NODE_KEY, kind: "production_handoff", dependsOn: [AUTHORING_ESTIMATE_NODE_KEY] },
		{ key: AUTHORING_DELIVERY_VERIFY_NODE_KEY, kind: "delivery_verify", dependsOn: [AUTHORING_CONCAT_NODE_KEY] },
	];
	for (const contract of singletonContracts) {
		const matches = nodes.filter((node) => node.kind === contract.kind);
		if (
			matches.length !== 1 ||
			matches[0]?.key !== contract.key ||
			!sameDependencySet(matches[0]?.dependsOn ?? [], contract.dependsOn)
		) {
			return `singleton:${contract.kind}`;
		}
	}

	const writers = nodes.filter((node) => node.kind === "clip_writer");
	const submissions = nodes.filter((node) => node.kind === "video_submission");
	const results = nodes.filter((node) => node.kind === "video_result");
	if (writers.length === 0) return "clip_writer:empty";
	const validateClipNodes = (
		clipNodes: readonly VideoAuthoringGraphNode[],
		keyFor: (clipIndex: number) => string,
		dependenciesFor: (clipIndex: number) => readonly string[],
	): boolean => clipNodes.every((node) =>
		node.clipIndex !== undefined &&
		node.key === keyFor(node.clipIndex) &&
		sameDependencySet(node.dependsOn, dependenciesFor(node.clipIndex))
	);
	if (!validateClipNodes(writers, (clipIndex) => `clip:${clipIndex}`, () => [AUTHORING_ASSET_COVERAGE_NODE_KEY])) {
		return "clip_writer:shape";
	}
	if (!validateClipNodes(submissions, videoSubmissionGraphNodeKey, () => [AUTHORING_PRODUCTION_HANDOFF_NODE_KEY])) {
		return "video_submission:shape";
	}
	if (!validateClipNodes(results, videoResultArtifactKey, (clipIndex) => [videoSubmissionGraphNodeKey(clipIndex)])) {
		return "video_result:shape";
	}
	const indexesFor = (clipNodes: readonly VideoAuthoringGraphNode[]): string => clipNodes
		.map((node) => node.clipIndex)
		.sort((left, right) => (left ?? -1) - (right ?? -1))
		.join(",");
	const writerIndexes = indexesFor(writers);
	if (indexesFor(submissions) !== writerIndexes || indexesFor(results) !== writerIndexes) {
		return "clip_indexes:mismatch";
	}
	const assemblies = nodes.filter((node) => node.kind === "assembly");
	if (
		assemblies.length !== 1 ||
		assemblies[0]?.key !== AUTHORING_ASSEMBLY_NODE_KEY ||
		!sameDependencySet(assemblies[0]?.dependsOn ?? [], writers.map((node) => node.key))
	) {
		return "assembly:shape";
	}
	const concats = nodes.filter((node) => node.kind === "concat");
	if (
		concats.length !== 1 ||
		concats[0]?.key !== AUTHORING_CONCAT_NODE_KEY ||
		!sameDependencySet(concats[0]?.dependsOn ?? [], results.map((node) => node.key))
	) {
		return "concat:shape";
	}
	return null;
}

export function projectVideoAuthoringGraph(input: {
	graph: VideoAuthoringGraph;
	nodeStates: Readonly<Record<string, VideoAuthoringGraphNodeState | undefined>>;
}): VideoAuthoringGraphProjection {
	const validation = validateVideoAuthoringGraph(input.graph);
	if (!validation.ok) throw new Error(`${validation.code}:${validation.message}`);
	const stateByKey = new Map<string, VideoAuthoringGraphNodeState>();
	for (const node of validation.graph.nodes) {
		stateByKey.set(node.key, input.nodeStates[node.key] ?? "pending");
	}
	const nodes = validation.graph.nodes.map((node): VideoAuthoringGraphNodeProjection => {
		const blockedBy = node.dependsOn.filter((dependency) => stateByKey.get(dependency) !== "ready");
		return {
			key: node.key,
			kind: node.kind,
			state: stateByKey.get(node.key) ?? "pending",
			dependsOn: node.dependsOn,
			blockedBy,
			...(node.clipIndex !== undefined ? { clipIndex: node.clipIndex } : {}),
		};
	});
	const readyQueue = nodes
		.filter((node) => (node.state === "pending" || node.state === "stale") && node.blockedBy.length === 0)
		.map((node) => node.key);
	return {
		runId: validation.graph.runId,
		executionScope: validation.graph.executionScope,
		nodes,
		readyQueue,
		running: nodes.filter((node) => node.state === "running").map((node) => node.key),
		waitingExternal: nodes.filter((node) => node.state === "waiting_external").map((node) => node.key),
		failed: nodes.filter((node) => node.state === "failed").map((node) => node.key),
		complete: nodes.every((node) => node.state === "ready"),
	};
}

export function projectVideoAuthoringGraphArtifacts(input: {
	runId: string;
	artifacts: readonly VideoAuthoringGraphArtifact[];
}): VideoAuthoringGraphArtifactProjectionResult {
	const manifest = input.artifacts.find((artifact) => artifact.artifact_key === AUTHORING_GRAPH_MANIFEST_ARTIFACT_KEY);
	const parsed = parseVideoAuthoringGraphManifest(manifest?.payload ?? null);
	if (!parsed.ok) return parsed;
	if (parsed.graph.runId !== input.runId) {
		return {
			ok: false,
			code: "video_authoring_graph_run_id_mismatch",
			message: `authoring graph runId=${parsed.graph.runId} 与持久 runId=${input.runId} 不一致。`,
		};
	}
	const nodeStates: Record<string, VideoAuthoringGraphNodeState | undefined> = {};
	const graphNodeKeys = new Set(parsed.graph.nodes.map((node) => node.key));
	for (const artifact of input.artifacts) {
		if (!graphNodeKeys.has(artifact.artifact_key)) continue;
		if (!GRAPH_NODE_STATE_SET.has(artifact.status)) {
			return {
				ok: false,
				code: "video_authoring_graph_node_status_invalid",
				message: `authoring graph 节点 ${artifact.artifact_key} 的持久状态 ${artifact.status} 不在协议集合内。`,
			};
		}
		nodeStates[artifact.artifact_key] = projectArtifactNodeState(artifact);
	}
	return {
		ok: true,
		graph: parsed.graph,
		projection: projectVideoAuthoringGraph({ graph: parsed.graph, nodeStates }),
	};
}

function findProjectedNode(
	projection: VideoAuthoringGraphProjection,
	key: string,
): VideoAuthoringGraphNodeProjection {
	const node = projection.nodes.find((candidate) => candidate.key === key);
	if (!node) throw new Error(`video_authoring_graph_node_missing:${key}`);
	return node;
}

export function selectVideoAuthoringGraphControlAction(
	projection: VideoAuthoringGraphProjection,
): VideoAuthoringGraphControlAction {
	const beatSheet = findProjectedNode(projection, AUTHORING_BEAT_SHEET_NODE_KEY);
	if (beatSheet.state !== "ready") throw new Error("video_authoring_graph_beat_sheet_not_ready");
	if (projection.executionScope === "prompt_only") {
		const clips = projection.nodes.filter((node) => node.kind === "clip_writer");
		if (clips.some((node) => node.state === "running")) return "drive_writers";
		if (clips.some((node) => node.state === "failed")) return "repair_writers";
		if (clips.some((node) => node.state !== "ready")) return "drive_writers";
		const assembly = findProjectedNode(projection, AUTHORING_ASSEMBLY_NODE_KEY);
		if (assembly.state !== "ready") return "assemble";
		const promptPackage = findProjectedNode(projection, AUTHORING_PROMPT_PACKAGE_NODE_KEY);
		return promptPackage.state === "ready" ? "authoring_complete" : "package_prompts";
	}
	const assetCoverage = findProjectedNode(projection, AUTHORING_ASSET_COVERAGE_NODE_KEY);
	if (assetCoverage.state === "running" || assetCoverage.state === "waiting_external") {
		return "wait_asset_repair";
	}
	if (assetCoverage.state !== "ready") return "prepare_assets_and_writers";

	const clips = projection.nodes.filter((node) => node.kind === "clip_writer");
	// A failed clip does not close the join while independent siblings are still
	// running. Keep ingesting active writers; repair becomes runnable only after
	// the whole writer frontier has settled.
	if (clips.some((node) => node.state === "running")) return "drive_writers";
	if (clips.some((node) => node.state === "failed")) return "repair_writers";
	if (clips.some((node) => node.state !== "ready")) return "drive_writers";

	const assembly = findProjectedNode(projection, AUTHORING_ASSEMBLY_NODE_KEY);
	if (assembly.state !== "ready") return "assemble";
	const estimate = findProjectedNode(projection, AUTHORING_ESTIMATE_NODE_KEY);
	const handoff = findProjectedNode(projection, AUTHORING_PRODUCTION_HANDOFF_NODE_KEY);
	if (estimate.state !== "ready" || handoff.state !== "ready") return "estimate_and_handoff";
	return "authoring_complete";
}

/**
 * The run row is the durable workflow cursor, while graph artifacts are an
 * independently persisted execution projection. Asset availability can change
 * after the projection was written, so an asset-repair cursor must always
 * re-enter the fresh-read coverage action even when an older projection still
 * appears pending/stale. This is a structural state reconciliation only; it
 * does not infer asset semantics from labels or prompt text.
 */
export function reconcileAuthoringGraphControlAction(input: {
	authoringState: string | null;
	projectedAction: VideoAuthoringGraphControlAction;
}): VideoAuthoringGraphControlAction {
	return input.authoringState === "asset_repair_required"
		? "wait_asset_repair"
		: input.projectedAction;
}

export function selectVideoProductionGraphDriveDecision(
	projection: VideoAuthoringGraphProjection,
): VideoProductionGraphDriveDecision {
	if (projection.executionScope === "prompt_only") {
		return {
			disposition: "complete",
			reason: "prompt_only_has_no_production_graph",
		};
	}
	const productionKinds = new Set<VideoAuthoringGraphNodeKind>([
		"video_submission",
		"video_result",
		"concat",
		"delivery_verify",
	]);
	const productionNodes = projection.nodes.filter((node) => productionKinds.has(node.kind));
	const delivery = findProjectedNode(projection, AUTHORING_DELIVERY_VERIFY_NODE_KEY);
	if (delivery.state === "ready") {
		return { disposition: "complete", reason: "delivery_verification_recorded" };
	}
	const runnable = productionNodes.filter((node) => projection.readyQueue.includes(node.key));
	const active = productionNodes.filter(
		(node) => node.state === "running" || node.state === "waiting_external",
	);
	if (runnable.length > 0 || active.length > 0) {
		return {
			disposition: "drive",
			reason: runnable.length > 0
				? `ready:${runnable.map((node) => node.key).join(",")}`
				: `active:${active.map((node) => node.key).join(",")}`,
		};
	}
	const handoff = findProjectedNode(projection, AUTHORING_PRODUCTION_HANDOFF_NODE_KEY);
	if (handoff.state !== "ready") {
		return { disposition: "failed", reason: `production_handoff_not_ready:${handoff.state}` };
	}
	const failed = productionNodes.filter((node) => node.state === "failed");
	if (failed.length > 0) {
		return {
			disposition: "failed",
			reason: `production_graph_node_failed:${failed.map((node) => node.key).join(",")}`,
		};
	}
	return { disposition: "failed", reason: "production_graph_has_no_ready_or_active_node" };
}

export function validateVideoAuthoringGraph(value: unknown): GraphValidationResult {
	const record = readRecord(value);
	const runId = typeof record?.runId === "string" ? record.runId.trim() : "";
	const executionScope = record?.executionScope === "prompt_only" || record?.executionScope === "media_delivery"
		? record.executionScope
		: null;
	if (!record || record.protocolVersion !== VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION || !runId || !executionScope) {
		return {
			ok: false,
			code: "video_authoring_graph_header_invalid",
			message: "authoring graph 缺少有效 protocolVersion/runId。",
		};
	}
	if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
		return { ok: false, code: "video_authoring_graph_nodes_required", message: "authoring graph nodes 不能为空。" };
	}
	const nodes: VideoAuthoringGraphNode[] = [];
	for (const valueNode of record.nodes) {
		const node = readNode(valueNode);
		if (!node) return { ok: false, code: "video_authoring_graph_node_invalid", message: "authoring graph node 结构无效。" };
		nodes.push(node);
	}
	const nodeByKey = new Map<string, VideoAuthoringGraphNode>();
	for (const node of nodes) {
		if (nodeByKey.has(node.key)) {
			return { ok: false, code: "video_authoring_graph_duplicate_node", message: `authoring graph node 重复：${node.key}` };
		}
		nodeByKey.set(node.key, node);
	}
	for (const node of nodes) {
		for (const dependency of node.dependsOn) {
			if (!nodeByKey.has(dependency)) {
				return {
					ok: false,
					code: "video_authoring_graph_dependency_missing",
					message: `authoring graph node ${node.key} 依赖不存在：${dependency}`,
				};
			}
		}
	}
	const remainingDependencies = new Map(nodes.map((node) => [node.key, node.dependsOn.length] as const));
	const dependents = new Map<string, string[]>();
	for (const node of nodes) {
		for (const dependency of node.dependsOn) {
			const children = dependents.get(dependency) ?? [];
			children.push(node.key);
			dependents.set(dependency, children);
		}
	}
	const queue = nodes.filter((node) => node.dependsOn.length === 0).map((node) => node.key);
	let visited = 0;
	while (queue.length > 0) {
		const key = queue.shift();
		if (!key) continue;
		visited += 1;
		for (const dependent of dependents.get(key) ?? []) {
			const next = (remainingDependencies.get(dependent) ?? 0) - 1;
			remainingDependencies.set(dependent, next);
			if (next === 0) queue.push(dependent);
		}
	}
	if (visited !== nodes.length) {
		return { ok: false, code: "video_authoring_graph_cycle", message: "authoring graph 存在依赖环。" };
	}
	const topologyError = validateCompiledVideoTopology(nodes, executionScope);
	if (topologyError) {
		return {
			ok: false,
			code: "video_authoring_graph_topology_invalid",
			message: `authoring graph 不符合统一视频交付拓扑：${topologyError}`,
		};
	}
	return {
		ok: true,
		graph: {
			protocolVersion: VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION,
			runId,
			executionScope,
			nodes,
		},
	};
}

export function parseVideoAuthoringGraphManifest(payload: string | null): GraphValidationResult {
	if (!payload) {
		return { ok: false, code: "video_authoring_graph_manifest_missing", message: "authoring graph manifest 缺失。" };
	}
	try {
		return validateVideoAuthoringGraph(JSON.parse(payload) as unknown);
	} catch {
		return { ok: false, code: "video_authoring_graph_manifest_invalid_json", message: "authoring graph manifest 不是合法 JSON。" };
	}
}

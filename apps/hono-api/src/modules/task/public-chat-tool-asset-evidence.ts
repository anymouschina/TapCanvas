export type PublicChatToolAssetEvidenceCall = {
	status: string;
	outputJson: Record<string, unknown> | null;
};

export type PublicChatToolDeliveryArtifactCall = PublicChatToolAssetEvidenceCall & {
	toolCallId: string;
	logicalToolName?: string;
	name: string;
	inputJson?: Record<string, unknown> | null;
};

export type PublicChatToolDeliveryArtifact = {
	toolCallId: string;
	toolName: string;
	assetType: "image" | "video" | "audio" | "workflow";
	deliveryState: "materialized" | "accepted_async";
	nodeId: string | null;
	taskId: string | null;
	runId: string | null;
	runProtocol?: "workflow_execution_family";
	clipIndex: number | null;
	assetUrl: string | null;
	/** Parent chat task is terminal at durable submission; the canvas node owns later materialization. */
	completionBoundary?: "submission";
};

export type PublicChatMaterializedToolAssets = {
	imageUrls: string[];
	videoUrls: string[];
};

const IMAGE_DELIVERY_TOOL_NAMES = new Set(["tapcanvas_image_generate_to_canvas"]);
const VIDEO_DELIVERY_TOOL_NAMES = new Set([
	"tapcanvas_video_generate_to_canvas",
	"tapcanvas_video_concat",
]);
const WORKFLOW_EXECUTION_TOOL_NAMES = new Set([
	"tapcanvas_equipped_workflow_run",
	"tapcanvas_workflow_resume",
	"tapcanvas_workflow_run",
]);
const AUDIO_DELIVERY_TOOL_NAMES = new Set(["tapcanvas_audio_generate_to_canvas"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHttpUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
	} catch {
		return null;
	}
}

function readTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function readNonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeState(value: unknown): string {
	return readTrimmedString(value)?.toLowerCase() ?? "";
}

function collectUrlField(
	record: Record<string, unknown>,
	key: string,
	target: Set<string>,
): void {
	const url = readHttpUrl(record[key]);
	if (url) target.add(url);
}

function collectResultArrayUrls(
	record: Record<string, unknown>,
	key: "imageResults" | "videoResults",
	target: Set<string>,
): void {
	const values = record[key];
	if (!Array.isArray(values)) return;
	for (const value of values) {
		if (!isRecord(value)) continue;
		const url = readHttpUrl(value.url);
		if (url) target.add(url);
	}
}

function collectStoryboardCellUrls(record: Record<string, unknown>, target: Set<string>): void {
	const cells = record.storyboardEditorCells;
	if (!Array.isArray(cells)) return;
	for (const cell of cells) {
		if (!isRecord(cell)) continue;
		const url = readHttpUrl(cell.imageUrl);
		if (url) target.add(url);
	}
}

function collectRecordAssets(
	record: Record<string, unknown>,
	imageUrls: Set<string>,
	videoUrls: Set<string>,
	depth: number,
): void {
	if (record.ok === false) return;
	const lifecycleStatus = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
	if (lifecycleStatus === "failed" || lifecycleStatus === "error" || lifecycleStatus === "cancelled") {
		return;
	}
	collectUrlField(record, "imageUrl", imageUrls);
	collectUrlField(record, "videoUrl", videoUrls);
	collectUrlField(record, "concatVideoUrl", videoUrls);
	collectResultArrayUrls(record, "imageResults", imageUrls);
	collectResultArrayUrls(record, "videoResults", videoUrls);
	collectStoryboardCellUrls(record, imageUrls);
	if (depth >= 3) return;
	for (const key of ["data", "result", "response"] as const) {
		const nested = record[key];
		if (isRecord(nested)) collectRecordAssets(nested, imageUrls, videoUrls, depth + 1);
	}
	for (const key of ["items", "results", "details", "nodes"] as const) {
		const nested = record[key];
		if (!Array.isArray(nested)) continue;
		for (const item of nested) {
			if (isRecord(item)) collectRecordAssets(item, imageUrls, videoUrls, depth + 1);
		}
	}
}

export function collectPublicChatMaterializedToolAssets(
	toolCalls: PublicChatToolAssetEvidenceCall[],
): PublicChatMaterializedToolAssets {
	const imageUrls = new Set<string>();
	const videoUrls = new Set<string>();
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded" || !toolCall.outputJson) continue;
		collectRecordAssets(toolCall.outputJson, imageUrls, videoUrls, 0);
	}
	return {
		imageUrls: [...imageUrls],
		videoUrls: [...videoUrls],
	};
}

type StableExecutionIdentity = {
	nodeId: string | null;
	taskId: string | null;
	runId: string | null;
	clipIndex: number | null;
};

type DeliveryRecord = {
	record: Record<string, unknown>;
	identity: StableExecutionIdentity;
	completionBoundary: "submission" | null;
};

function mergeExecutionIdentity(
	record: Record<string, unknown>,
	inherited: StableExecutionIdentity,
	clipIndexByNodeId: ReadonlyMap<string, number>,
): StableExecutionIdentity {
	const nodeId = readTrimmedString(record.nodeId) ?? inherited.nodeId;
	return {
		nodeId,
		taskId: readTrimmedString(record.taskId) ?? inherited.taskId,
		runId: readTrimmedString(record.runId) ?? inherited.runId,
		clipIndex:
			readNonNegativeInteger(record.clipIndex) ??
			(nodeId ? clipIndexByNodeId.get(nodeId) ?? null : null) ??
			inherited.clipIndex,
	};
}

function readNodeClipIndex(value: unknown): number | null {
	if (!isRecord(value)) return null;
	const data = isRecord(value.data) ? value.data : null;
	return readNonNegativeInteger(data?.clipIndex) ?? readNonNegativeInteger(value.clipIndex);
}

function buildInputExecutionIdentity(inputJson: Record<string, unknown> | null | undefined): {
	seed: StableExecutionIdentity;
	clipIndexByNodeId: ReadonlyMap<string, number>;
} {
	const clipIndexByNodeId = new Map<string, number>();
	const node = isRecord(inputJson?.node) ? inputJson.node : null;
	const nodeId = readTrimmedString(node?.id);
	const nodeClipIndex = readNodeClipIndex(node);
	if (nodeId && nodeClipIndex !== null) clipIndexByNodeId.set(nodeId, nodeClipIndex);
	const nodes = inputJson?.nodes;
	if (Array.isArray(nodes)) {
		for (const value of nodes) {
			if (!isRecord(value)) continue;
			const childNodeId = readTrimmedString(value.id);
			const childClipIndex = readNodeClipIndex(value);
			if (childNodeId && childClipIndex !== null) {
				clipIndexByNodeId.set(childNodeId, childClipIndex);
			}
		}
	}
	const data = isRecord(inputJson?.data) ? inputJson.data : null;
	return {
		seed: {
			nodeId: null,
			taskId: null,
			runId: null,
			clipIndex:
				readNonNegativeInteger(inputJson?.clipIndex) ??
				nodeClipIndex ??
				readNonNegativeInteger(data?.clipIndex),
		},
		clipIndexByNodeId,
	};
}

function isTerminalFailureRecord(record: Record<string, unknown>): boolean {
	if (record.ok === false) return true;
	const states = [normalizeState(record.status), normalizeState(record.state)];
	return states.some(
		(state) => state === "failed" || state === "error" || state === "cancelled",
	);
}

function collectDeliveryRecords(
	value: unknown,
	target: DeliveryRecord[],
	inherited: StableExecutionIdentity,
	clipIndexByNodeId: ReadonlyMap<string, number>,
	inheritedCompletionBoundary: "submission" | null,
	depth = 0,
): void {
	if (!isRecord(value) || depth > 5 || isTerminalFailureRecord(value)) return;
	const identity = mergeExecutionIdentity(value, inherited, clipIndexByNodeId);
	const completionBoundary = value.completionBoundary === "submission"
		? "submission"
		: inheritedCompletionBoundary;
	target.push({ record: value, identity, completionBoundary });
	for (const key of ["data", "result", "response"] as const) {
		collectDeliveryRecords(
			value[key],
			target,
			identity,
			clipIndexByNodeId,
			completionBoundary,
			depth + 1,
		);
	}
	for (const key of [
		"items",
		"results",
		"details",
		"nodes",
		"imageResults",
		"videoResults",
		"audioResults",
		"storyboardEditorCells",
	] as const) {
		const nested = value[key];
		if (!Array.isArray(nested)) continue;
		for (const item of nested) {
			collectDeliveryRecords(
				item,
				target,
				identity,
				clipIndexByNodeId,
				completionBoundary,
				depth + 1,
			);
		}
	}
}

function hasAcceptedAsyncState(record: Record<string, unknown>): boolean {
	if (record.ok === false) return false;
	if (record.acceptedAsync === true || record.shouldYield === true) return true;
	const states = [normalizeState(record.status), normalizeState(record.state)];
	return states.some(
		(state) =>
			state === "accepted_async" ||
			state === "queued" ||
			state === "running" ||
			state === "scheduled" ||
			state === "video_running" ||
			state === "submit_waiting_capacity",
	);
}

function collectDirectAssetUrls(
	record: Record<string, unknown>,
	assetType: PublicChatToolDeliveryArtifact["assetType"],
): string[] {
	const urls = new Set<string>();
	if (assetType === "image") {
		collectUrlField(record, "imageUrl", urls);
	} else if (assetType === "video") {
		collectUrlField(record, "videoUrl", urls);
		collectUrlField(record, "concatVideoUrl", urls);
	} else if (assetType === "audio") {
		collectUrlField(record, "audioUrl", urls);
	}
	if (assetType !== "workflow") collectUrlField(record, "url", urls);
	return [...urls];
}

function readLogicalToolCall(toolCall: PublicChatToolDeliveryArtifactCall): {
	name: string;
	inputJson: Record<string, unknown> | null;
} {
	if (toolCall.name !== "tapcanvas_call_tool" && toolCall.name !== "call_tool") {
		return { name: readTrimmedString(toolCall.logicalToolName) ?? toolCall.name, inputJson: toolCall.inputJson ?? null };
	}
	const name = readTrimmedString(toolCall.logicalToolName) ?? toolCall.name;
	const args = isRecord(toolCall.inputJson?.args) ? toolCall.inputJson.args : null;
	return { name, inputJson: args };
}

export function collectPublicChatToolDeliveryArtifacts(
	toolCalls: PublicChatToolDeliveryArtifactCall[],
): PublicChatToolDeliveryArtifact[] {
	const artifacts: PublicChatToolDeliveryArtifact[] = [];
	const seen = new Set<string>();
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded" || !toolCall.outputJson) continue;
		const logicalToolCall = readLogicalToolCall(toolCall);
		const assetType = WORKFLOW_EXECUTION_TOOL_NAMES.has(logicalToolCall.name)
			? "workflow"
			: IMAGE_DELIVERY_TOOL_NAMES.has(logicalToolCall.name)
			? "image"
			: VIDEO_DELIVERY_TOOL_NAMES.has(logicalToolCall.name)
				? "video"
				: AUDIO_DELIVERY_TOOL_NAMES.has(logicalToolCall.name)
					? "audio"
					: null;
		if (!assetType) continue;
		const runProtocol = WORKFLOW_EXECUTION_TOOL_NAMES.has(logicalToolCall.name)
			? "workflow_execution_family" as const
			: null;
		const records: DeliveryRecord[] = [];
		const inputIdentity = buildInputExecutionIdentity(logicalToolCall.inputJson);
		// Remote tools are canonically wrapped as {ok, content, data}; batch child
		// identities therefore live at data.results[]. Walk the protocol tree rather
		// than assuming results is a top-level array, and keep each child's identity.
		collectDeliveryRecords(
			toolCall.outputJson,
			records,
			inputIdentity.seed,
			inputIdentity.clipIndexByNodeId,
			null,
		);
		for (const { record, identity, completionBoundary } of records) {
			const materializedUrls = collectDirectAssetUrls(record, assetType);
			for (const assetUrl of materializedUrls) {
				const key = [
					toolCall.toolCallId,
					assetType,
					"materialized",
					identity.nodeId,
					identity.taskId,
					identity.runId,
					identity.clipIndex,
					assetUrl,
				].join("|");
				if (seen.has(key)) continue;
				seen.add(key);
				artifacts.push({
					toolCallId: toolCall.toolCallId,
					toolName: logicalToolCall.name,
					assetType,
					deliveryState: "materialized",
					nodeId: identity.nodeId,
					taskId: identity.taskId,
					runId: identity.runId,
					...(runProtocol ? { runProtocol } : {}),
					clipIndex: identity.clipIndex,
					assetUrl,
				});
			}
			if (materializedUrls.length > 0 || !hasAcceptedAsyncState(record)) continue;
			if (!identity.nodeId && !identity.taskId && !identity.runId) continue;
			const key = [
				toolCall.toolCallId,
				assetType,
				"accepted_async",
				identity.nodeId,
				identity.taskId,
				identity.runId,
				identity.clipIndex,
			].join("|");
			if (seen.has(key)) continue;
			seen.add(key);
			artifacts.push({
				toolCallId: toolCall.toolCallId,
				toolName: logicalToolCall.name,
				assetType,
				deliveryState: "accepted_async",
				nodeId: identity.nodeId,
				taskId: identity.taskId,
				runId: identity.runId,
				...(runProtocol ? { runProtocol } : {}),
				clipIndex: identity.clipIndex,
				assetUrl: null,
				...(completionBoundary ? { completionBoundary } : {}),
			});
		}
	}
	return artifacts;
}

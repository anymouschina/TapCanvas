import type { AgentPerformanceSnapshotV1 } from "@tapcanvas/agent-observability";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function requiredNumber(value: unknown): number | null {
	return numberOrNull(value);
}

function optionalNumber(value: unknown): number | null | undefined {
	return value === null ? null : numberOrNull(value) ?? undefined;
}

/**
 * Strictly normalizes the agents-cli physical-run performance contract before
 * it enters canonical trace attributes. Missing required structural fields make
 * the snapshot unavailable; they never affect task completion.
 */
export function normalizeAgentPerformanceSnapshot(
	value: unknown,
): AgentPerformanceSnapshotV1 | null {
	const root = record(value);
	const model = record(root?.model);
	const tools = record(root?.tools);
	const context = record(root?.context);
	const toolSurface = record(root?.toolSurface);
	const progress = record(root?.progress);
	if (root?.version !== 1 || !model || !tools || !context || !toolSurface || !progress) return null;

	const wallTimeMs = requiredNumber(root.wallTimeMs);
	const timeToFirstTextMs = optionalNumber(root.timeToFirstTextMs);
	const timeToFirstToolMs = optionalNumber(root.timeToFirstToolMs);
	const modelTurnCount = requiredNumber(model.turnCount);
	const modelDurationMs = requiredNumber(model.durationMs);
	const modelWallTimeShare = requiredNumber(model.wallTimeShare);
	const modelInputTokens = requiredNumber(model.inputTokens);
	const modelOutputTokens = requiredNumber(model.outputTokens);
	const modelTotalTokens = requiredNumber(model.totalTokens);
	const modelCacheReadInputTokens = requiredNumber(model.cacheReadInputTokens);
	const modelCacheCreationInputTokens = requiredNumber(model.cacheCreationInputTokens);
	const toolCallCount = requiredNumber(tools.callCount);
	const toolDurationMs = requiredNumber(tools.durationMs);
	const toolWallTimeShare = requiredNumber(tools.wallTimeShare);
	const schemaDiscoveryCount = requiredNumber(tools.schemaDiscoveryCount);
	const blockedCount = requiredNumber(tools.blockedCount);
	const failedCount = requiredNumber(tools.failedCount);
	const contextBudgetTokens = optionalNumber(context.budgetTokens);
	const contextThresholdTokens = optionalNumber(context.thresholdTokens);
	const contextTotalTokens = optionalNumber(context.totalTokens);
	const contextPeakTotalTokens = optionalNumber(context.peakTotalTokens);
	const contextSystemTokens = optionalNumber(context.systemTokens);
	const contextMessageTokens = optionalNumber(context.messageTokens);
	const contextToolTokens = optionalNumber(context.toolTokens);
	const modelVisibleCount = optionalNumber(toolSurface.modelVisibleCount);
	const sentSchemaChars = optionalNumber(toolSurface.sentSchemaChars);
	const modelVisibleDefinitionChars = optionalNumber(toolSurface.modelVisibleDefinitionChars);
	const initialSentSchemaChars = optionalNumber(toolSurface.initialSentSchemaChars);
	const maxSentSchemaChars = optionalNumber(toolSurface.maxSentSchemaChars);
	const initialModelVisibleDefinitionChars = optionalNumber(toolSurface.initialModelVisibleDefinitionChars);
	const maxModelVisibleDefinitionChars = optionalNumber(toolSurface.maxModelVisibleDefinitionChars);
	const catalogRemoteCount = optionalNumber(toolSurface.catalogRemoteCount);
	const authorizedRemoteDefinitionChars = optionalNumber(toolSurface.authorizedRemoteDefinitionChars);
	const catalogNameChars = optionalNumber(toolSurface.catalogNameChars);
	const duplicatedWrapperEnumChars = optionalNumber(toolSurface.duplicatedWrapperEnumChars);
	const progressRevision = requiredNumber(progress.revision);
	const durableClaimCount = requiredNumber(progress.durableClaimCount);
	const progressSincePhysicalRunStart = requiredNumber(progress.progressSincePhysicalRunStart);
	const suspensionLimit = optionalNumber(progress.suspensionLimit);
	const suspensionObserved = optionalNumber(progress.suspensionObserved);
	const suspensionUsageTokens = optionalNumber(progress.suspensionUsageTokens);
	const projectedInputTokens = optionalNumber(progress.projectedInputTokens);
	const projectedMinimumOutputTokens = optionalNumber(progress.projectedMinimumOutputTokens);
	const projectedTotalTokens = optionalNumber(progress.projectedTotalTokens);

	if (
		wallTimeMs === null || timeToFirstTextMs === undefined || timeToFirstToolMs === undefined ||
		modelTurnCount === null || modelDurationMs === null || modelWallTimeShare === null ||
		modelInputTokens === null || modelOutputTokens === null || modelTotalTokens === null ||
		modelCacheReadInputTokens === null || modelCacheCreationInputTokens === null ||
		toolCallCount === null || toolDurationMs === null || toolWallTimeShare === null ||
		schemaDiscoveryCount === null || blockedCount === null || failedCount === null ||
		contextBudgetTokens === undefined || contextThresholdTokens === undefined ||
		contextTotalTokens === undefined || contextSystemTokens === undefined ||
		contextPeakTotalTokens === undefined ||
		contextMessageTokens === undefined || contextToolTokens === undefined ||
		modelVisibleCount === undefined || sentSchemaChars === undefined ||
		modelVisibleDefinitionChars === undefined || initialSentSchemaChars === undefined ||
		maxSentSchemaChars === undefined || initialModelVisibleDefinitionChars === undefined ||
		maxModelVisibleDefinitionChars === undefined || catalogRemoteCount === undefined ||
		authorizedRemoteDefinitionChars === undefined || catalogNameChars === undefined ||
		duplicatedWrapperEnumChars === undefined || progressRevision === null ||
		durableClaimCount === null || progressSincePhysicalRunStart === null ||
		suspensionLimit === undefined || suspensionObserved === undefined ||
		suspensionUsageTokens === undefined || projectedInputTokens === undefined ||
		projectedMinimumOutputTokens === undefined || projectedTotalTokens === undefined ||
		typeof progress.suspended !== "boolean"
	) return null;

	const overBudget = context.overBudget === null
		? null
		: typeof context.overBudget === "boolean"
			? context.overBudget
			: undefined;
	const suspensionBudgetKind = progress.suspensionBudgetKind === null
		? null
		: typeof progress.suspensionBudgetKind === "string" && progress.suspensionBudgetKind.trim()
			? progress.suspensionBudgetKind.trim()
			: undefined;
	if (overBudget === undefined || suspensionBudgetKind === undefined) return null;

	return {
		version: 1,
		wallTimeMs,
		timeToFirstTextMs,
		timeToFirstToolMs,
		model: {
			turnCount: modelTurnCount,
			durationMs: modelDurationMs,
			wallTimeShare: modelWallTimeShare,
			inputTokens: modelInputTokens,
			outputTokens: modelOutputTokens,
			totalTokens: modelTotalTokens,
			cacheReadInputTokens: modelCacheReadInputTokens,
			cacheCreationInputTokens: modelCacheCreationInputTokens,
		},
		tools: {
			callCount: toolCallCount,
			durationMs: toolDurationMs,
			wallTimeShare: toolWallTimeShare,
			schemaDiscoveryCount,
			blockedCount,
			failedCount,
		},
		context: {
			budgetTokens: contextBudgetTokens,
			thresholdTokens: contextThresholdTokens,
			totalTokens: contextTotalTokens,
			peakTotalTokens: contextPeakTotalTokens,
			systemTokens: contextSystemTokens,
			messageTokens: contextMessageTokens,
			toolTokens: contextToolTokens,
			overBudget,
		},
		toolSurface: {
			modelVisibleCount,
			sentSchemaChars,
			modelVisibleDefinitionChars,
			initialSentSchemaChars,
			maxSentSchemaChars,
			initialModelVisibleDefinitionChars,
			maxModelVisibleDefinitionChars,
			catalogRemoteCount,
			authorizedRemoteDefinitionChars,
			catalogNameChars,
			duplicatedWrapperEnumChars,
		},
		progress: {
			revision: progressRevision,
			durableClaimCount,
			progressSincePhysicalRunStart,
			suspended: progress.suspended,
			suspensionBudgetKind,
			suspensionLimit,
			suspensionObserved,
			suspensionUsageTokens,
			projectedInputTokens,
			projectedMinimumOutputTokens,
			projectedTotalTokens,
		},
	};
}

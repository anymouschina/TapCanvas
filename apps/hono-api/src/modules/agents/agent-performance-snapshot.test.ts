import { describe, expect, it } from "vitest";

import { normalizeAgentPerformanceSnapshot } from "./agent-performance-snapshot";

const validSnapshot = {
	version: 1,
	wallTimeMs: 1000,
	timeToFirstTextMs: 700,
	timeToFirstToolMs: 610,
	model: {
		turnCount: 1,
		durationMs: 600,
		wallTimeShare: 0.6,
		inputTokens: 120,
		outputTokens: 30,
		totalTokens: 150,
		cacheReadInputTokens: 20,
		cacheCreationInputTokens: 4,
	},
	tools: {
		callCount: 2,
		durationMs: 30,
		wallTimeShare: 0.03,
		schemaDiscoveryCount: 1,
		blockedCount: 1,
		failedCount: 0,
	},
	context: {
		budgetTokens: 64000,
		thresholdTokens: 54400,
		totalTokens: 13000,
		peakTotalTokens: 17000,
		systemTokens: 2000,
		messageTokens: 5000,
		toolTokens: 6000,
		overBudget: false,
	},
	toolSurface: {
		modelVisibleCount: 19,
		sentSchemaChars: 14000,
		modelVisibleDefinitionChars: 18000,
		initialSentSchemaChars: 12000,
		maxSentSchemaChars: 14000,
		initialModelVisibleDefinitionChars: 16000,
		maxModelVisibleDefinitionChars: 18000,
		catalogRemoteCount: 28,
		authorizedRemoteDefinitionChars: 92000,
		catalogNameChars: 827,
		duplicatedWrapperEnumChars: 1824,
	},
	progress: {
		revision: 4,
		durableClaimCount: 1,
		progressSincePhysicalRunStart: 2,
		suspended: false,
		suspensionBudgetKind: null,
		suspensionLimit: null,
		suspensionObserved: null,
		suspensionUsageTokens: null,
		projectedInputTokens: null,
		projectedMinimumOutputTokens: null,
		projectedTotalTokens: null,
	},
} as const;

describe("normalizeAgentPerformanceSnapshot", () => {
	it("preserves the diagnostic physical-run contract", () => {
		expect(normalizeAgentPerformanceSnapshot(validSnapshot)).toEqual(validSnapshot);
	});

	it("rejects incomplete or non-finite snapshots without inventing defaults", () => {
		expect(normalizeAgentPerformanceSnapshot({ ...validSnapshot, model: undefined })).toBeNull();
		expect(normalizeAgentPerformanceSnapshot({ ...validSnapshot, wallTimeMs: Number.NaN })).toBeNull();
		expect(normalizeAgentPerformanceSnapshot({
			...validSnapshot,
			context: { ...validSnapshot.context, overBudget: "false" },
		})).toBeNull();
	});
});

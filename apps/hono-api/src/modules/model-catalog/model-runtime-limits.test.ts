import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import {
	getCatalogModelByVendorAndKey,
	listCatalogModelsByModelAlias,
	listCatalogModelsByModelKey,
} from "./model-catalog.repo";
import {
	parseModelRuntimeLimitsFromError,
	resolveModelOutputBudget,
} from "./model-runtime-limits";

vi.mock("./model-catalog.repo", () => ({
	getCatalogModelByVendorAndKey: vi.fn(),
	listCatalogModelsByModelAlias: vi.fn(),
	listCatalogModelsByModelKey: vi.fn(),
	upsertCatalogModelRow: vi.fn(),
}));

const createContext = (): AppContext =>
	({ env: { DB: {} } }) as unknown as AppContext;

beforeEach(() => {
	vi.mocked(getCatalogModelByVendorAndKey).mockResolvedValue(null);
	vi.mocked(listCatalogModelsByModelKey).mockResolvedValue([]);
	vi.mocked(listCatalogModelsByModelAlias).mockResolvedValue([]);
});

describe("parseModelRuntimeLimitsFromError", () => {
	it("extracts maxOutput from range-style upstream errors", () => {
		const result = parseModelRuntimeLimitsFromError(
			"Invalid max_tokens value, the valid range of max_tokens is [1, 8192]",
		);

		expect(result).toEqual({ maxOutput: 8192 });
	});

	it("extracts contextWindow from maximum context errors", () => {
		const result = parseModelRuntimeLimitsFromError(
			"This model's maximum context length is 128000 tokens. However, you requested more.",
		);

		expect(result).toEqual({ contextWindow: 128000 });
	});
});

describe("resolveModelOutputBudget", () => {
	it("caps Claude output at the upstream 4096-token contract before dispatch", async () => {
		const result = await resolveModelOutputBudget({
			c: createContext(),
			modelKey: "claude-opus-4-7",
			desiredMaxOutput: 12_000,
			inputText: "compact critic request",
		});

		expect(result.maxOutput).toBe(4_096);
		expect(result.effectiveMaxOutput).toBe(4_096);
		expect(result.source).toBe("static");
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	ensureModelCatalogSchema,
	isAgentsBridgeEnabled,
	listCatalogModelsByModelAlias,
	listCatalogModelsByModelKey,
	prisma,
	registerPublicFlowRoutes,
	runAgentsBridgeChatTask,
} = vi.hoisted(() => ({
	ensureModelCatalogSchema: vi.fn(async () => undefined),
	isAgentsBridgeEnabled: vi.fn(() => false),
	listCatalogModelsByModelAlias: vi.fn(async () => []),
	listCatalogModelsByModelKey: vi.fn(async () => []),
	prisma: {
		model_catalog_vendors: {
			findMany: vi.fn(async () => []),
		},
		model_catalog_vendor_api_keys: {
			findMany: vi.fn(async () => []),
		},
		proxy_providers: {
			findMany: vi.fn(async () => []),
		},
		model_tokens: {
			findMany: vi.fn(async () => []),
		},
	},
	registerPublicFlowRoutes: vi.fn(),
	runAgentsBridgeChatTask: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prisma }));
vi.mock("../flow/flow.public.routes", () => ({ registerPublicFlowRoutes }));
vi.mock("../task/task.agents-bridge", () => ({
	isAgentsBridgeEnabled,
	runAgentsBridgeChatTask,
}));
vi.mock("../model-catalog/model-catalog.repo", () => ({
	ensureModelCatalogSchema,
	listCatalogModelsByModelAlias,
	listCatalogModelsByModelKey,
}));

import { buildPublicVisionTaskRequest, resolvePublicTaskVendors } from "./apiKey.routes";

function makeCtx(): AppContext {
	return {
		env: {
			DB: {},
			PUBLIC_VENDOR_ROUTING: "",
		} as AppContext["env"],
		req: {
			url: "https://example.com/public/tasks",
		} as AppContext["req"],
	} as unknown as AppContext;
}

function makeCatalogModelRow(input: {
	vendorKey: string;
	modelKey: string;
	modelAlias: string | null;
	kind: string;
	enabled?: number;
}): {
	vendor_key: string;
	model_key: string;
	model_alias: string | null;
	label_zh: string;
	kind: string;
	enabled: number;
	meta: string | null;
	created_at: string;
	updated_at: string;
} {
	return {
		vendor_key: input.vendorKey,
		model_key: input.modelKey,
		model_alias: input.modelAlias,
		label_zh: `${input.vendorKey}:${input.modelKey}`,
		kind: input.kind,
		enabled: input.enabled ?? 1,
		meta: null,
		created_at: "2026-03-24T00:00:00.000Z",
		updated_at: "2026-03-24T00:00:00.000Z",
	};
}

describe("resolvePublicTaskVendors modelKey routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureModelCatalogSchema.mockResolvedValue(undefined);
		isAgentsBridgeEnabled.mockReturnValue(false);
		prisma.model_catalog_vendors.findMany.mockResolvedValue([
			{ key: "yunwu", enabled: 1, auth_type: "bearer" },
		]);
		prisma.model_catalog_vendor_api_keys.findMany.mockResolvedValue([
			{ vendor_key: "yunwu", enabled: 1, api_key: "sk-test" },
		]);
		prisma.proxy_providers.findMany.mockResolvedValue([]);
		prisma.model_tokens.findMany.mockResolvedValue([]);
		listCatalogModelsByModelAlias.mockResolvedValue([]);
		listCatalogModelsByModelKey.mockResolvedValue([]);
	});

	it("prefers exact modelKey match before alias compatibility fallback", async () => {
		listCatalogModelsByModelKey.mockImplementation(async (db: unknown, modelKey: string) => {
			if (db && modelKey === "gemini-3.1-flash-image-preview") {
				return [
					makeCatalogModelRow({
						vendorKey: "yunwu",
						modelKey: "gemini-3.1-flash-image-preview",
						modelAlias: "nano-banana-2",
						kind: "image",
					}),
				];
			}
			return [];
		});

		const resolved = await resolvePublicTaskVendors(makeCtx(), "user-1", "auto", {
			kind: "text_to_image",
			extras: { modelKey: "gemini-3.1-flash-image-preview" },
		});

		expect(resolved.vendorCandidates).toEqual(["yunwu"]);
		expect(resolved.modelAliasRaw).toBe("");
		expect(resolved.aliasMap).toBeNull();
		expect(listCatalogModelsByModelAlias).not.toHaveBeenCalled();
	});

	it("keeps alias compatibility when modelKey does not match any real model_key", async () => {
		listCatalogModelsByModelKey.mockResolvedValue([]);
		listCatalogModelsByModelAlias.mockImplementation(async (db: unknown, modelAlias: string) => {
			if (db && modelAlias === "nano-banana-pro") {
				return [
					makeCatalogModelRow({
						vendorKey: "yunwu",
						modelKey: "gemini-3-pro-image-preview",
						modelAlias: "nano-banana-pro",
						kind: "image",
					}),
				];
			}
			return [];
		});

		const resolved = await resolvePublicTaskVendors(makeCtx(), "user-1", "auto", {
			kind: "text_to_image",
			extras: { modelKey: "nano-banana-pro" },
		});

		expect(resolved.vendorCandidates).toEqual(["yunwu"]);
		expect(resolved.modelAliasRaw).toBe("nano-banana-pro");
		expect(resolved.aliasMap?.get("yunwu")).toBe("gemini-3-pro-image-preview");
		expect(listCatalogModelsByModelAlias).toHaveBeenCalledWith(
			expect.anything(),
			"nano-banana-pro",
		);
	});

	it("resolves alias-style modelKey even when vendor is explicit", async () => {
		listCatalogModelsByModelKey.mockResolvedValue([]);
		listCatalogModelsByModelAlias.mockImplementation(async (db: unknown, modelAlias: string) => {
			if (db && modelAlias === "veo3.1-fast") {
				return [
					makeCatalogModelRow({
						vendorKey: "yunwu",
						modelKey: "veo3-fast",
						modelAlias: "veo3.1-fast",
						kind: "video",
					}),
				];
			}
			return [];
		});

		const resolved = await resolvePublicTaskVendors(makeCtx(), "user-1", "yunwu", {
			kind: "text_to_video",
			extras: { modelKey: "veo3.1-fast" },
		});

		expect(resolved.vendorCandidates).toEqual(["yunwu"]);
		expect(resolved.modelAliasRaw).toBe("veo3.1-fast");
		expect(resolved.aliasMap?.get("yunwu")).toBe("veo3-fast");
	});

	it("treats modelAlias value as exact model_key when alias lookup misses", async () => {
		listCatalogModelsByModelAlias.mockResolvedValue([]);
		listCatalogModelsByModelKey.mockImplementation(async (db: unknown, modelKey: string) => {
			if (db && modelKey === "gemini-3.1-flash-image-preview") {
				return [
					makeCatalogModelRow({
						vendorKey: "yunwu",
						modelKey: "gemini-3.1-flash-image-preview",
						modelAlias: "vision-style-pro",
						kind: "image",
					}),
				];
			}
			return [];
		});

		const resolved = await resolvePublicTaskVendors(makeCtx(), "user-1", "auto", {
			kind: "image_to_prompt",
			extras: { modelAlias: "gemini-3.1-flash-image-preview" },
		});

		expect(resolved.vendorCandidates).toEqual(["yunwu"]);
		expect(resolved.modelAliasRaw).toBe("gemini-3.1-flash-image-preview");
		expect(resolved.aliasMap?.get("yunwu")).toBe("gemini-3.1-flash-image-preview");
		expect(listCatalogModelsByModelAlias).toHaveBeenCalledWith(
			expect.anything(),
			"gemini-3.1-flash-image-preview",
		);
		expect(listCatalogModelsByModelKey).toHaveBeenCalledWith(
			expect.anything(),
			"gemini-3.1-flash-image-preview",
		);
	});
});

describe("buildPublicVisionTaskRequest", () => {
	it("does not inject default modelAlias when caller explicitly provides modelKey", () => {
		const request = buildPublicVisionTaskRequest(
			{
				imageUrl: "https://example.com/reference.png",
				modelKey: "gemini-3.1-flash-image-preview",
			},
			{
				imageUrl: "https://example.com/reference.png",
				imageData: null,
				prompt: "analyze this image",
			},
		);

		expect(request).toEqual({
			kind: "image_to_prompt",
			prompt: "analyze this image",
			extras: {
				imageUrl: "https://example.com/reference.png",
				modelKey: "gemini-3.1-flash-image-preview",
			},
		});
	});

	it("uses the default modelAlias only when both modelAlias and modelKey are absent", () => {
		const request = buildPublicVisionTaskRequest(
			{
				imageUrl: "https://example.com/reference.png",
			},
			{
				imageUrl: "https://example.com/reference.png",
				imageData: null,
				prompt: "analyze this image",
			},
		);

		expect(request.extras.modelAlias).toBe("gemini-3.1-flash-image-preview");
		expect(request.extras.modelKey).toBeUndefined();
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

type StoredSkill = {
	id: string;
	owner_id: string;
	file_name: string;
	name: string;
	description: string | null;
	content: string;
	logo_url: string | null;
	force_full_context: number;
	size_bytes: number;
	sha256: string;
	marketplace_product_id: string | null;
	marketplace_price_cents: number | null;
	marketplace_currency: string | null;
	marketplace_listed_at: string | null;
	source_marketplace_product_id: string | null;
	created_at: string;
	updated_at: string;
};

type Query = {
	where?: Record<string, unknown>;
	select?: Record<string, boolean>;
	data?: Record<string, unknown>;
};

type OptionalMarketplaceFields = Pick<
	StoredSkill,
	| "marketplace_product_id"
	| "marketplace_price_cents"
	| "marketplace_currency"
	| "marketplace_listed_at"
	| "source_marketplace_product_id"
>;

type StoredSkillCreateData = Omit<StoredSkill, keyof OptionalMarketplaceFields>
	& Partial<OptionalMarketplaceFields>;

const databaseState = vi.hoisted(() => ({
	rows: [] as StoredSkill[],
	contentReads: 0,
}));

function matchesWhere(row: StoredSkill, where: Record<string, unknown> | undefined): boolean {
	if (!where) return true;
	return Object.entries(where).every(([key, expected]) => {
		if (key === "id" && expected && typeof expected === "object") {
			const condition = expected as { in?: string[]; not?: string };
			if (condition.in) return condition.in.includes(row.id);
			if (condition.not) return row.id !== condition.not;
		}
		return row[key as keyof StoredSkill] === expected;
	});
}

function selectRow(row: StoredSkill, select: Record<string, boolean> | undefined): Record<string, unknown> | StoredSkill {
	if (!select) {
		databaseState.contentReads += 1;
		return { ...row };
	}
	const selected: Record<string, unknown> = {};
	for (const [key, enabled] of Object.entries(select)) {
		if (enabled) selected[key] = row[key as keyof StoredSkill];
	}
	if (select.content) databaseState.contentReads += 1;
	return selected;
}

const skillModel = {
	findMany: vi.fn(async (query: Query = {}) => databaseState.rows
		.filter((row) => matchesWhere(row, query.where))
		.map((row) => selectRow(row, query.select))),
	findFirst: vi.fn(async (query: Query = {}) => {
		const row = databaseState.rows.find((candidate) => matchesWhere(candidate, query.where));
		return row ? selectRow(row, query.select) : null;
	}),
	count: vi.fn(async (query: Query = {}) => databaseState.rows.filter((row) => matchesWhere(row, query.where)).length),
	create: vi.fn(async (query: Query) => {
		const data = query.data as unknown as StoredSkillCreateData;
		const row: StoredSkill = {
			...data,
			marketplace_product_id: data.marketplace_product_id ?? null,
			marketplace_price_cents: data.marketplace_price_cents ?? null,
			marketplace_currency: data.marketplace_currency ?? null,
			marketplace_listed_at: data.marketplace_listed_at ?? null,
			source_marketplace_product_id: data.source_marketplace_product_id ?? null,
		};
		databaseState.rows.push(row);
		return selectRow(row, query.select);
	}),
	update: vi.fn(async (query: Query & { where: { id: string } }) => {
		const index = databaseState.rows.findIndex((row) => row.id === query.where.id);
		if (index < 0) throw new Error("missing row");
		const next = { ...databaseState.rows[index], ...query.data } as StoredSkill;
		databaseState.rows[index] = next;
		return selectRow(next, query.select);
	}),
	delete: vi.fn(async (query: { where: { id: string } }) => {
		const index = databaseState.rows.findIndex((row) => row.id === query.where.id);
		if (index < 0) throw new Error("missing row");
		const [deleted] = databaseState.rows.splice(index, 1);
		return deleted;
	}),
	aggregate: vi.fn(async (query: Query) => ({
		_sum: {
			size_bytes: databaseState.rows
				.filter((row) => matchesWhere(row, query.where))
				.reduce((sum, row) => sum + row.size_bytes, 0),
		},
	})),
};

type PrismaStub = {
	user_skill_assets: typeof skillModel;
	$transaction: <T>(action: (client: PrismaStub) => Promise<T>) => Promise<T>;
};

const prismaStub: PrismaStub = {
	user_skill_assets: skillModel,
	$transaction: async <T>(action: (client: PrismaStub) => Promise<T>): Promise<T> => action(prismaStub),
};

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prismaStub }));

import {
	createUserContextAsset,
	deleteUserContextAsset,
	getUserContextAssetContent,
	installUserContextAssetFromMarketplaceInTransaction,
	listUserContextAssets,
	updateUserContextAssetMarketplaceListing,
	updateUserContextAsset,
} from "./user-context-assets.service";
import { CreateUserContextAssetRequestSchema } from "./agents.schemas";
import type { CreateUserContextAssetRequestDto } from "./agents.schemas";

const TEST_LOGO_URL = "https://assets.example.com/skill-logo.png";

function createSkill(
	userId: string,
	input: Omit<CreateUserContextAssetRequestDto, "logoUrl"> & { logoUrl?: string },
) {
	return createUserContextAsset(userId, { ...input, logoUrl: input.logoUrl ?? TEST_LOGO_URL });
}

describe("user context assets", () => {
	beforeEach(() => {
		databaseState.rows = [];
		databaseState.contentReads = 0;
		vi.clearAllMocks();
	});

	it("lists Skill metadata without reading bodies and reads one body only by explicit id", async () => {
		const content = "# Visual rules\n\nKeep the subject identity stable.\n";
		const created = await createSkill("user-a", { fileName: "visual-rules.md", content });
		databaseState.contentReads = 0;

		expect(await listUserContextAssets("user-a")).toEqual([
			expect.not.objectContaining({ content: expect.anything() }),
		]);
		expect(databaseState.contentReads).toBe(0);

		const resolved = await getUserContextAssetContent("user-a", created.id);
		expect(resolved).toMatchObject({ id: created.id, content });
		expect(databaseState.contentReads).toBe(1);
	});

	it("accepts only the Skill upload contract", () => {
		expect(CreateUserContextAssetRequestSchema.safeParse({ fileName: "my-skill.md", content: "# Skill\n", logoUrl: TEST_LOGO_URL }).success).toBe(true);
		expect(CreateUserContextAssetRequestSchema.safeParse({ fileName: "my-skill.md", content: "# Skill\n" }).success).toBe(false);
		expect(CreateUserContextAssetRequestSchema.safeParse({ kind: "brief", fileName: "creative-brief.md", content: "# Brief\n", logoUrl: TEST_LOGO_URL }).success).toBe(false);
	});

	it("rejects creating or editing a Skill definition without a hosted Logo", async () => {
		await expect(createUserContextAsset("user-a", {
			fileName: "missing-logo.md",
			content: "# Missing logo",
			logoUrl: "",
		})).rejects.toMatchObject({ code: "user_context_asset_logo_required" });

		const created = await createSkill("user-a", { fileName: "legacy.md", content: "before" });
		const row = databaseState.rows.find((item) => item.id === created.id);
		if (!row) throw new Error("test fixture missing");
		row.logo_url = null;
		await expect(updateUserContextAsset("user-a", created.id, { content: "after" }))
			.rejects.toMatchObject({ code: "user_context_asset_logo_required" });
		await expect(listUserContextAssets("user-a")).resolves.toEqual([
			expect.objectContaining({ id: created.id }),
		]);
	});

	it("isolates the account-wide Skill library by authenticated user", async () => {
		await createSkill("user-a", { fileName: "campaign.md", content: "# Campaign A\n" });
		await createSkill("user-b", { fileName: "campaign.md", content: "# Campaign B\n" });
		expect((await listUserContextAssets("user-a"))[0]?.sha256).not.toBe((await listUserContextAssets("user-b"))[0]?.sha256);
	});

	it("rejects non-Markdown uploads and duplicate names without overwriting", async () => {
		await expect(createSkill("user-a", { fileName: "brief.txt", content: "plain text" }))
			.rejects.toMatchObject({ code: "user_context_asset_markdown_required" });
		await createSkill("user-a", { fileName: "brief.md", content: "first" });
		await expect(createSkill("user-a", { fileName: "brief.md", content: "second" }))
			.rejects.toMatchObject({ code: "user_context_asset_file_exists" });
	});

	it("persists metadata and overwrites only when the user explicitly allows it", async () => {
		const first = await createSkill("user-a", {
			fileName: "brief.md",
			content: "first",
			name: "第一版",
			description: "初始描述",
		});
		const overwritten = await createSkill("user-a", {
			fileName: "brief.md",
			content: "second",
			name: "第二版",
			description: "更新描述",
			overwrite: true,
		});
		expect(overwritten).toMatchObject({ id: first.id, name: "第二版", description: "更新描述" });
		expect(overwritten.sha256).not.toBe(first.sha256);
		expect(databaseState.rows).toHaveLength(1);
	});

	it("prevents purchased Skill bodies from being overwritten or edited", async () => {
		const source = await createSkill("seller", { fileName: "paid.md", content: "paid" });
		await updateUserContextAssetMarketplaceListing("seller", source.id, {
			productId: "paid-product",
			priceCredits: 200,
			listedAt: "2026-07-22T00:00:00.000Z",
		});
		const installed = await installUserContextAssetFromMarketplaceInTransaction(
			prismaStub as unknown as Prisma.TransactionClient,
			{ buyerUserId: "buyer", sellerUserId: "seller", sourceAssetId: source.id, productId: "paid-product", priceCredits: 200 },
		);
		await expect(createSkill("buyer", {
			fileName: installed.asset.fileName,
			content: "replacement",
			overwrite: true,
		})).rejects.toMatchObject({ code: "user_context_asset_purchased_overwrite_forbidden" });
		await expect(updateUserContextAsset("buyer", installed.asset.id, { content: "replacement" }))
			.rejects.toMatchObject({ code: "user_context_asset_purchased_content_update_forbidden" });
	});

	it("recomputes content integrity metadata on edit", async () => {
		const created = await createSkill("user-a", { fileName: "editable.md", content: "before" });
		const updated = await updateUserContextAsset("user-a", created.id, { content: "after", name: "已编辑" });
		expect(updated).toMatchObject({ id: created.id, name: "已编辑", sizeBytes: 5 });
		expect(updated.sha256).not.toBe(created.sha256);
	});

	it("requires listed Skills to be unlisted before uninstall", async () => {
		const created = await createSkill("user-a", { fileName: "listed.md", content: "listed" });
		await updateUserContextAssetMarketplaceListing("user-a", created.id, {
			productId: "listed-product",
			priceCredits: 300,
			listedAt: "2026-07-22T00:00:00.000Z",
		});
		await expect(deleteUserContextAsset("user-a", created.id))
			.rejects.toMatchObject({ code: "user_context_asset_listed_delete_forbidden" });
		databaseState.rows[0].marketplace_product_id = null;
		databaseState.rows[0].marketplace_price_cents = null;
		databaseState.rows[0].marketplace_currency = null;
		databaseState.rows[0].marketplace_listed_at = null;
		await expect(deleteUserContextAsset("user-a", created.id)).resolves.toEqual({ deleted: true });
		expect(databaseState.rows).toHaveLength(0);
	});

	it("fails explicitly when requested database content no longer matches its metadata", async () => {
		const created = await createSkill("user-a", { fileName: "locked.md", content: "original" });
		const row = databaseState.rows.find((item) => item.id === created.id);
		if (!row) throw new Error("test fixture missing");
		row.content = "tampered";
		await expect(getUserContextAssetContent("user-a", created.id)).rejects.toMatchObject({
			code: "user_context_asset_integrity_mismatch",
		});
	});

	it("installs a purchased marketplace Skill exactly once per buyer and product", async () => {
		const source = await createSkill("seller", {
			fileName: "storyboard-director.md",
			content: "# Storyboard director\n\nKeep shot continuity.\n",
		});
		await updateUserContextAssetMarketplaceListing("seller", source.id, {
			productId: "product-storyboard",
			priceCredits: 200,
			listedAt: "2026-07-22T00:00:00.000Z",
		});
		const input = {
			buyerUserId: "buyer",
			sellerUserId: "seller",
			sourceAssetId: source.id,
			productId: "product-storyboard",
			priceCredits: 200,
		};

		const transaction = prismaStub as unknown as Prisma.TransactionClient;
		const first = await installUserContextAssetFromMarketplaceInTransaction(transaction, input);
		const second = await installUserContextAssetFromMarketplaceInTransaction(transaction, input);

		expect(second.asset.id).toBe(first.asset.id);
		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		expect(second.asset.sourceMarketplaceProductId).toBe("product-storyboard");
		expect(databaseState.rows.filter((row) => (
			row.owner_id === "buyer" && row.source_marketplace_product_id === "product-storyboard"
		))).toHaveLength(1);
	});

	it("rejects a tampered marketplace source before creating an installed copy", async () => {
		const source = await createSkill("seller", {
			fileName: "tampered.md",
			content: "# Trusted source\n",
		});
		await updateUserContextAssetMarketplaceListing("seller", source.id, {
			productId: "product-tampered",
			priceCredits: 200,
			listedAt: "2026-07-22T00:00:00.000Z",
		});
		const row = databaseState.rows.find((item) => item.id === source.id);
		if (!row) throw new Error("test fixture missing");
		row.content = "# Modified after listing\n";

		await expect(installUserContextAssetFromMarketplaceInTransaction(
			prismaStub as unknown as Prisma.TransactionClient,
			{ buyerUserId: "buyer", sellerUserId: "seller", sourceAssetId: source.id, productId: "product-tampered", priceCredits: 200 },
		)).rejects.toMatchObject({ code: "user_context_asset_integrity_mismatch" });
		expect(databaseState.rows.some((item) => item.owner_id === "buyer")).toBe(false);
	});
});

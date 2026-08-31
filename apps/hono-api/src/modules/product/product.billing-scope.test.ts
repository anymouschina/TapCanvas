import type { PrismaClient } from "../../types";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ProductQueryArgs = {
	where: unknown;
};

let listWhere: unknown;
let countWhere: unknown;

const prismaStub = {
	products: {
		findMany: vi.fn(async (input: ProductQueryArgs) => {
			listWhere = input.where;
			return [];
		}),
		count: vi.fn(async (input: ProductQueryArgs) => {
			countWhere = input.where;
			return 0;
		}),
	},
};

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prismaStub,
}));

import { countProducts, listProducts } from "./product.repo";
import { ProductListQuerySchema } from "./product.schemas";

describe("billing product catalog scope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listWhere = undefined;
		countWhere = undefined;
	});

	it("accepts billing scope while preserving all as the explicit default", () => {
		expect(ProductListQuerySchema.parse({}).scope).toBe("all");
		expect(ProductListQuerySchema.parse({ scope: "billing" }).scope).toBe("billing");
	});

	it("applies the same platform owner and non-credit filters to list and count", async () => {
		const db = {} as PrismaClient;
		const filter = {
			ownerId: "platform-owner",
			excludedCurrency: "CREDITS",
		};

		await listProducts(db, { ...filter, limit: 100, offset: 0 });
		await countProducts(db, filter);

		const expectedWhere = {
			owner_id: "platform-owner",
			currency: { not: "CREDITS" },
		};
		expect(listWhere).toEqual(expectedWhere);
		expect(countWhere).toEqual(expectedWhere);
	});
});

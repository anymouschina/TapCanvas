import { describe, expect, it } from "vitest";
import { ActivateTeamSubscriptionSchema, UpsertTeamSubscriptionPlanSchema } from "./team-subscription.schemas";

const validPlan = {
	name: "PLUS",
	tier: "plus",
	maxSeats: 5,
	minSeats: 5,
	features: {
		concurrent_tasks_per_seat: 2,
		unlimited_concurrent_tasks: false,
		canvas_collab: true,
		shared_asset_library: true,
		seat_management: true,
		credit_quota_control: true,
		fast_invoice: true,
		creditGrants: {
			annual: { includedCreditsPerSeat: 12000 },
		},
		presentation: {
			badge: "团队入门",
			variantOrder: 1,
			accent: "graphite",
			featured: false,
			campaignBenefits: ["固定 5 个协作席位"],
			capabilities: ["多人实时协作画布"],
		},
	},
	sortWeight: 1,
	enabled: true,
};

describe("UpsertTeamSubscriptionPlanSchema", () => {
	it("accepts an annual-only team plan", () => {
		const parsed = UpsertTeamSubscriptionPlanSchema.parse(validPlan);
		expect(parsed.features.creditGrants.annual.includedCreditsPerSeat).toBe(12000);
	});

	it("rejects an invalid seat range", () => {
		const parsed = UpsertTeamSubscriptionPlanSchema.safeParse({
			...validPlan,
			minSeats: 6,
			maxSeats: 5,
		});
		expect(parsed.success).toBe(false);
	});

	it("allows editing historical plans with up to 2000 seats", () => {
		const parsed = UpsertTeamSubscriptionPlanSchema.safeParse({
			...validPlan,
			maxSeats: 2000,
		});
		expect(parsed.success).toBe(true);
	});

	it("rejects a plan without an annual credit allocation", () => {
		const parsed = UpsertTeamSubscriptionPlanSchema.safeParse({
			...validPlan,
			features: {
				...validPlan.features,
				creditGrants: {},
			},
		});
		expect(parsed.success).toBe(false);
	});

	it("rejects unsupported presentation accents", () => {
		const parsed = UpsertTeamSubscriptionPlanSchema.safeParse({
			...validPlan,
			features: {
				...validPlan.features,
				presentation: { ...validPlan.features.presentation, accent: "orange" },
			},
		});
		expect(parsed.success).toBe(false);
	});

});

describe("ActivateTeamSubscriptionSchema", () => {
	it("defaults team allocations to an annual term", () => {
		expect(ActivateTeamSubscriptionSchema.parse({ planId: "team-plus" }).billingCycle).toBe("annual");
	});

	it("rejects monthly team allocations", () => {
		expect(ActivateTeamSubscriptionSchema.safeParse({
			planId: "team-plus",
			billingCycle: "monthly",
		}).success).toBe(false);
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
	isAdminRequest: vi.fn(),
	findMany: vi.fn(),
	upsert: vi.fn(),
}));

vi.mock("../team/team.service", () => ({
	isAdminRequest: mocks.isAdminRequest,
}));

import {
	listAdminBuiltInCapabilities,
	listSystemDisabledBuiltInCapabilityKeys,
	updateAdminBuiltInCapabilityState,
} from "./built-in-capability-settings.service";

const context = {
	env: {
		DB: {
			agent_builtin_capability_settings: {
				findMany: mocks.findMany,
				upsert: mocks.upsert,
			},
		},
	},
} as unknown as AppContext;

describe("system built-in capability settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isAdminRequest.mockReturnValue(true);
		mocks.findMany.mockResolvedValue([]);
	});

	it("lists the runtime catalog with enabled defaults when no override exists", async () => {
		const capabilities = await listAdminBuiltInCapabilities(context);
		const oneClickVideo = capabilities.find((capability) => capability.key === "one_click_video");

		expect(oneClickVideo).toMatchObject({
			id: "builtin:one_click_video",
			enabled: true,
			updatedAt: null,
			updatedByUserId: null,
		});
	});

	it("persists an audited platform-wide stop for the exact catalog key", async () => {
		mocks.upsert.mockImplementation(async (input: {
			create: {
				capability_id: string;
				enabled: number;
				updated_by_user_id: string;
				created_at: string;
				updated_at: string;
			};
		}) => input.create);

		const updated = await updateAdminBuiltInCapabilityState(
			context,
			"admin-1",
			"one_click_video",
			false,
		);

		expect(updated).toMatchObject({ key: "one_click_video", enabled: false, updatedByUserId: "admin-1" });
		expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
			where: { capability_id: "one_click_video" },
			create: expect.objectContaining({ enabled: 0, updated_by_user_id: "admin-1" }),
			update: expect.objectContaining({ enabled: 0, updated_by_user_id: "admin-1" }),
		}));
	});

	it("fresh-reads only globally disabled capability keys for runtime enforcement", async () => {
		mocks.findMany.mockResolvedValue([{ capability_id: "one_click_video" }]);

		await expect(listSystemDisabledBuiltInCapabilityKeys(context))
			.resolves.toEqual(["one_click_video"]);
		expect(mocks.findMany).toHaveBeenCalledWith({
			where: { enabled: 0 },
			select: { capability_id: true },
			orderBy: { capability_id: "asc" },
		});
	});

	it("rejects non-admin callers before exposing system settings", async () => {
		mocks.isAdminRequest.mockReturnValue(false);
		await expect(listAdminBuiltInCapabilities(context))
			.rejects.toMatchObject({ status: 403, code: "forbidden" });
		expect(mocks.findMany).not.toHaveBeenCalled();
	});
});

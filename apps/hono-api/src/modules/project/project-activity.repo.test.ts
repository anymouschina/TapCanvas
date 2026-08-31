import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../types";
import { ProjectActivityTouchError, touchProjectActivity } from "./project-activity.repo";

function createDb(input: {
	updateMany: ReturnType<typeof vi.fn>;
	findUnique?: ReturnType<typeof vi.fn>;
}): PrismaClient {
	return {
		projects: {
			updateMany: input.updateMany,
			findUnique: input.findUnique ?? vi.fn().mockResolvedValue(null),
		},
	} as unknown as PrismaClient;
}

describe("touchProjectActivity", () => {
	it("updates exactly the owner-scoped project activity timestamp", async () => {
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		await touchProjectActivity({
			db: createDb({ updateMany }),
			projectId: "project-1",
			ownerId: "owner-1",
			nowIso: "2026-07-23T12:00:00.000Z",
		});
		expect(updateMany).toHaveBeenCalledWith({
			where: {
				id: "project-1",
				owner_id: "owner-1",
				updated_at: { lt: "2026-07-23T12:00:00.000Z" },
			},
			data: { updated_at: "2026-07-23T12:00:00.000Z" },
		});
	});

	it("fails explicitly when the project cannot be touched", async () => {
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		await expect(touchProjectActivity({
			db: createDb({ updateMany }),
			projectId: "project-missing",
			ownerId: "owner-1",
			nowIso: "2026-07-23T12:00:00.000Z",
		})).rejects.toBeInstanceOf(ProjectActivityTouchError);
	});

	it("does not block an already durable canvas write when project metadata is absent", async () => {
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const findUnique = vi.fn().mockResolvedValue(null);
		await expect(touchProjectActivity({
			db: createDb({ updateMany, findUnique }),
			projectId: "project-missing",
			ownerId: "owner-1",
			nowIso: "2026-07-23T12:00:00.000Z",
			allowMissing: true,
		})).resolves.toBeUndefined();
		expect(findUnique).toHaveBeenCalledWith({
			where: { id: "project-missing" },
			select: { id: true, owner_id: true },
		});
	});

	it("also tolerates a missing row when Prisma throws during the touch", async () => {
		const error = Object.assign(new Error("record disappeared"), { code: "P2025" });
		const updateMany = vi.fn().mockRejectedValue(error);
		const findUnique = vi.fn().mockResolvedValue(null);
		await expect(touchProjectActivity({
			db: createDb({ updateMany, findUnique }),
			projectId: "project-missing",
			ownerId: "owner-1",
			nowIso: "2026-07-23T12:00:00.000Z",
			allowMissing: true,
		})).resolves.toBeUndefined();
	});

	it("treats an adapter P2025 existence probe as a missing ancillary row", async () => {
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const findUnique = vi.fn().mockRejectedValue(
			Object.assign(new Error("record disappeared"), { code: "P2025" }),
		);
		await expect(touchProjectActivity({
			db: createDb({ updateMany, findUnique }),
			projectId: "project-missing",
			ownerId: "owner-1",
			nowIso: "2026-07-23T12:00:00.000Z",
			allowMissing: true,
		})).resolves.toBeUndefined();
	});

	it("does not hide a touch error when the project row still exists", async () => {
		const error = new Error("temporary database failure");
		const updateMany = vi.fn().mockRejectedValue(error);
		const findUnique = vi.fn().mockResolvedValue({ id: "project-1", owner_id: "owner-1" });
		await expect(touchProjectActivity({
			db: createDb({ updateMany, findUnique }),
			projectId: "project-1",
			ownerId: "owner-1",
			nowIso: "2026-07-23T12:00:00.000Z",
			allowMissing: true,
		})).rejects.toBe(error);
	});

	it("does not regress a project timestamp that is already newer", async () => {
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const findUnique = vi.fn().mockResolvedValue({ id: "project-1", owner_id: "owner-1" });
		await expect(touchProjectActivity({
			db: createDb({ updateMany, findUnique }),
			projectId: "project-1",
			ownerId: "owner-1",
			nowIso: "2026-07-23T12:00:00.000Z",
		})).resolves.toBeUndefined();
		expect(findUnique).toHaveBeenCalledWith({
			where: { id: "project-1" },
			select: { id: true, owner_id: true },
		});
	});
});

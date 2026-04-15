import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AppContext } from "../../types";

const PLATFORM_OWNER_ENV_KEY = "COMMERCE_PLATFORM_OWNER_ID";

function buildOwnerMissingError(c: AppContext, ownerId: string): AppError {
	const platformOwnerId = String(c.env.COMMERCE_PLATFORM_OWNER_ID || "").trim();
	if (platformOwnerId && platformOwnerId === ownerId) {
		return new AppError(
			`${PLATFORM_OWNER_ENV_KEY} (${ownerId}) does not match any users.id`,
			{
				status: 500,
				code: "commerce_platform_owner_user_missing",
			},
		);
	}
	return new AppError(`Owner user not found: ${ownerId}`, {
		status: 404,
		code: "owner_user_not_found",
	});
}

export async function assertOwnerUserExists(
	c: AppContext,
	ownerId: string,
): Promise<void> {
	const normalizedOwnerId = ownerId.trim();
	if (!normalizedOwnerId) {
		throw new AppError("Owner user id is required", {
			status: 400,
			code: "owner_user_id_required",
		});
	}

	const row = await getPrismaClient().users.findUnique({
		where: { id: normalizedOwnerId },
		select: { id: true },
	});
	if (!row) {
		throw buildOwnerMissingError(c, normalizedOwnerId);
	}
}

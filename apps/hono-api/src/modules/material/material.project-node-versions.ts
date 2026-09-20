import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { listProjectNodeAssetsForOwner } from "./material.project-node-assets.service";
import type { MaterialAssetVersionDto } from "./material.schemas";

/** Project nodes expose their current canvas revision, not a fabricated version history. */
export async function listProjectNodeVersionsForOwner(
	c: AppContext,
	userId: string,
	input: { projectId: string; assetId: string },
): Promise<MaterialAssetVersionDto[]> {
	const assets = await listProjectNodeAssetsForOwner(c, userId, { projectId: input.projectId });
	const asset = assets.find((item) => item.id === input.assetId);
	if (!asset?.latestVersion) {
		throw new AppError("Project node material not found in the authorized project", {
			status: 404,
			code: "project_node_material_not_found",
			details: input,
		});
	}
	return [asset.latestVersion];
}

import { getPrismaClient } from "../../platform/node/prisma";

export type AssetUriRow = {
	id: string;
	type: string;
	cdn_url: string;
	task_id: string | null;
	node_id: string | null;
	user_id: string;
	created_at: string;
};

export async function upsertAssetUri(input: {
	id: string;
	type: "image" | "video" | "audio";
	cdnUrl: string;
	taskId?: string | null;
	nodeId?: string | null;
	userId: string;
}): Promise<void> {
	const now = new Date().toISOString();
	await getPrismaClient().asset_uris.upsert({
		where: { id: input.id },
		create: {
			id: input.id,
			type: input.type,
			cdn_url: input.cdnUrl,
			task_id: input.taskId ?? null,
			node_id: input.nodeId ?? null,
			user_id: input.userId,
			created_at: now,
		},
		update: {
			cdn_url: input.cdnUrl,
			node_id: input.nodeId ?? null,
		},
	});
}

export async function findAssetUri(id: string): Promise<AssetUriRow | null> {
	const row = await getPrismaClient().asset_uris.findUnique({ where: { id } });
	return row ?? null;
}

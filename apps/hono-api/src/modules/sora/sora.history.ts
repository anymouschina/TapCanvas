import type { AppContext } from "../../types";
import type { VideoHistoryRecord } from "./sora.types";

export async function listSoraVideoHistory(
	c: AppContext,
	userId: string,
	params: { limit?: number; offset?: number; status?: string } = {},
): Promise<{ records: VideoHistoryRecord[]; total: number }> {
	const limit =
		typeof params.limit === "number"
			? Math.min(100, Math.max(1, params.limit))
			: 20;
	const offset =
		typeof params.offset === "number"
			? Math.max(0, params.offset)
			: 0;

	const whereClauses: string[] = ["user_id = ?", "provider = ?"];
	const bindings: any[] = [userId, "sora"];

	if (params.status) {
		whereClauses.push("status = ?");
		bindings.push(params.status);
	}

	const whereSql = whereClauses.length
		? `WHERE ${whereClauses.join(" AND ")}`
		: "";

	const rowsPromise = c.env.DB.prepare(
		`SELECT * FROM video_generation_histories
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
	)
		.bind(...bindings, limit, offset)
		.all<any>();

	const countPromise = c.env.DB.prepare(
		`SELECT COUNT(*) as cnt FROM video_generation_histories ${whereSql}`,
	)
		.bind(...bindings)
		.first<{ cnt: number }>();

	const [rowsResult, countResult] = await Promise.all([
		rowsPromise,
		countPromise,
	]);

	const rows = rowsResult.results ?? [];
	const total = countResult?.cnt ?? 0;

	const records: VideoHistoryRecord[] = rows.map((r) => ({
		id: r.id,
		prompt: r.prompt,
		parameters: r.parameters ? JSON.parse(r.parameters) : undefined,
		imageUrl: r.image_url ?? null,
		taskId: r.task_id,
		generationId: r.generation_id ?? null,
		status: r.status,
		videoUrl: r.video_url ?? null,
		thumbnailUrl: r.thumbnail_url ?? null,
		duration: typeof r.duration === "number" ? r.duration : null,
		width: typeof r.width === "number" ? r.width : null,
		height: typeof r.height === "number" ? r.height : null,
		tokenId: r.token_id ?? null,
		provider: r.provider,
		model: r.model ?? null,
		cost: typeof r.cost === "number" ? r.cost : null,
		createdAt: r.created_at,
		isFavorite: r.is_favorite === 1,
		rating: typeof r.rating === "number" ? r.rating : null,
		notes: r.notes ?? null,
	}));

	return { records, total };
}


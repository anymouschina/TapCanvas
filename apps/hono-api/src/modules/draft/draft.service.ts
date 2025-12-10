import type { AppContext } from "../../types";

export async function suggestPrompts(
	c: AppContext,
	userId: string,
	input: { query: string; provider: string; limit: number; mode?: string },
) {
	const trimmed = (input.query || "").trim();
	if (!trimmed) {
		return { prompts: [] as string[] };
	}

	const provider = (input.provider || "sora").trim();
	const limit = Number.isFinite(input.limit) && input.limit > 0
		? input.limit
		: 6;

	const like = `%${trimmed.toLowerCase()}%`;
	const stmt = c.env.DB.prepare(
		`SELECT prompt FROM video_generation_histories
     WHERE user_id = ? AND provider = ?
       AND LOWER(prompt) LIKE ?
     ORDER BY updated_at DESC
     LIMIT ?`,
	);

	const { results } = await stmt
		.bind(userId, provider, like, limit * 3)
		.all<{ prompt: string | null }>();

	const prompts = Array.from(
		new Set(
			(results || [])
				.map((r) => (r.prompt || "").trim())
				.filter((p) => p && p.length > 0),
		),
	).slice(0, limit);

	return { prompts };
}

export async function markPromptUsed(
	c: AppContext,
	userId: string,
	input: { prompt: string; provider: string },
) {
	const trimmed = (input.prompt || "").trim();
	if (!trimmed) return { ok: true };

	const provider = (input.provider || "sora").trim();
	const nowIso = new Date().toISOString();

	// 简化实现：通过更新相关记录的 updated_at，让最近使用的提示更靠前
	await c.env.DB.prepare(
		`UPDATE video_generation_histories
     SET updated_at = ?
     WHERE user_id = ? AND provider = ? AND prompt = ?`,
	)
		.bind(nowIso, userId, provider, trimmed)
		.run();

	return { ok: true };
}


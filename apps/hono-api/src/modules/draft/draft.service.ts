import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export async function suggestPrompts(
	c: AppContext,
	userId: string,
	input: { query: string; provider: string; limit: number; mode?: string },
) {
	void c;
	const trimmed = (input.query || "").trim();
	if (!trimmed) {
		return { prompts: [] as string[] };
	}

	const provider = (input.provider || "sora").trim();
	const limit =
		Number.isFinite(input.limit) && input.limit > 0
			? input.limit
			: 6;

	const rows = await getPrismaClient().video_generation_histories.findMany({
		where: {
			user_id: userId,
			provider,
			prompt: { contains: trimmed, mode: "insensitive" },
		},
		orderBy: { updated_at: "desc" },
		take: limit * 3,
		select: { prompt: true },
	});

	const prompts = Array.from(
		new Set(
			rows
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
	void c;
	const trimmed = (input.prompt || "").trim();
	if (!trimmed) return { ok: true };

	const provider = (input.provider || "sora").trim();
	const nowIso = new Date().toISOString();

	await getPrismaClient().video_generation_histories.updateMany({
		where: {
			user_id: userId,
			provider,
			prompt: trimmed,
		},
		data: {
			updated_at: nowIso,
		},
	});

	return { ok: true };
}

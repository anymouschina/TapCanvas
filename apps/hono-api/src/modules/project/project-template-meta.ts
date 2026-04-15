import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AppContext } from "../../types";

export type TemplateMetaAssetRow = {
	id: string;
	owner_id: string | null;
	data: string | null;
};

export function normalizeTemplateMetaString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function normalizeOwnerId(value: unknown): string | null {
	const normalized = normalizeTemplateMetaString(value);
	return normalized || null;
}

export async function getTemplateMetaAssetByProject(
	c: AppContext,
	projectId: string,
): Promise<TemplateMetaAssetRow | null> {
	void c;
	return getPrismaClient().assets.findFirst({
		where: {
			project_id: projectId,
			data: { contains: `"kind":"workflowTemplateMeta"` },
		},
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		select: { id: true, owner_id: true, data: true },
	});
}

export async function upsertTemplateMetaByProject(
	c: AppContext,
	input: {
		projectId: string;
		projectOwnerId: string | null;
		projectName: string;
		templateTitle?: string;
		templateDescription?: string;
		templateCoverUrl?: string;
		updatedBy: "admin" | "owner";
		nowIso: string;
	},
): Promise<void> {
	const existing = await getTemplateMetaAssetByProject(c, input.projectId);
	let currentData: Record<string, unknown> = {};
	if (existing?.data && typeof existing.data === "string") {
		try {
			const parsed = JSON.parse(existing.data);
			if (parsed && typeof parsed === "object") {
				currentData = parsed as Record<string, unknown>;
			}
		} catch {
			currentData = {};
		}
	}

	const nextTitle =
		normalizeTemplateMetaString(input.templateTitle) ||
		normalizeTemplateMetaString(input.projectName) ||
		"未命名模板";
	const nextDescription = normalizeTemplateMetaString(input.templateDescription);
	const nextCoverUrl = normalizeTemplateMetaString(input.templateCoverUrl);
	const nextData = {
		...(currentData && typeof currentData === "object" ? currentData : {}),
		kind: "workflowTemplateMeta",
		title: nextTitle,
		description: nextDescription,
		coverUrl: nextCoverUrl,
		updatedBy: input.updatedBy,
		updatedAt: input.nowIso,
	};

	if (existing?.id) {
		await getPrismaClient().assets.update({
			where: { id: existing.id },
			data: {
				data: JSON.stringify(nextData),
				updated_at: input.nowIso,
			},
		});
		return;
	}

	const ownerId = normalizeOwnerId(input.projectOwnerId);
	if (!ownerId) {
		throw new AppError("Template owner missing", {
			status: 400,
			code: "template_owner_missing",
		});
	}

	await getPrismaClient().assets.create({
		data: {
			id: crypto.randomUUID(),
			name: `模板元数据 · ${nextTitle}`,
			data: JSON.stringify(nextData),
			owner_id: ownerId,
			project_id: input.projectId,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
}

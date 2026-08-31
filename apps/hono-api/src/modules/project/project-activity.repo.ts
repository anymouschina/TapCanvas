import type { PrismaClient } from "../../types";

function readPrismaErrorCode(error: unknown): string | null {
	if (!error || typeof error !== "object") return null;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : null;
}

export class ProjectActivityTouchError extends Error {
	readonly projectId: string;

	constructor(projectId: string) {
		super(`Project activity touch failed: ${projectId}`);
		this.name = "ProjectActivityTouchError";
		this.projectId = projectId;
	}
}

export async function touchProjectActivity(input: {
	db: PrismaClient;
	projectId: string;
	ownerId: string;
	nowIso: string;
	/**
	 * Canvas flows can be authoritative before the optional project-directory
	 * row has been materialized (and a project can also be deleted while an
	 * already accepted media task is finishing).  In that path the activity
	 * timestamp is ancillary metadata; it must not roll back the durable canvas
	 * write or stop the video driver.
	 */
	allowMissing?: boolean;
}): Promise<void> {
	const findExistingProject = async (): Promise<{ id: string } | null> => {
		try {
			// `id` is the project primary key. Using findUnique avoids the adapter
			// path that has been observed to surface a P2002 while executing the
			// owner-scoped findFirst probe. Owner verification remains explicit so
			// this probe cannot turn into an authorization bypass.
			const project = await input.db.projects.findUnique({
				where: { id: input.projectId },
				select: { id: true, owner_id: true },
			});
			return project && project.owner_id === input.ownerId ? { id: project.id } : null;
		} catch (error) {
			// Some Prisma adapters surface a disappearing row as P2025 even for
			// the existence probe. It is still a missing ancillary metadata row.
			const code = readPrismaErrorCode(error);
			if (code === "P2025") return null;
			if (input.allowMissing === true && code === "P2002") {
				console.warn(
					`[project-activity] project existence probe hit adapter constraint; ancillary touch skipped project=${input.projectId} owner=${input.ownerId}`,
				);
				return null;
			}
			console.error(
				`[project-activity] project existence probe failed project=${input.projectId} owner=${input.ownerId} allowMissing=${input.allowMissing === true} code=${code ?? "unknown"}`,
			);
			throw error;
		}
	};
	let result: { count: number };
	try {
		result = await input.db.projects.updateMany({
			where: {
				id: input.projectId,
				owner_id: input.ownerId,
				updated_at: { lt: input.nowIso },
			},
			data: { updated_at: input.nowIso },
		});
	} catch (error) {
		if (input.allowMissing !== true) throw error;
		if (readPrismaErrorCode(error) === "P2025") {
			console.warn(
				`[project-activity] project activity touch raced with a missing row; canvas write remains authoritative project=${input.projectId} owner=${input.ownerId}`,
			);
			return;
		}
		// Prisma can throw instead of returning count=0 when the row disappears
		// during a concurrent project deletion. Re-check the owner-scoped row so
		// an ancillary activity touch never rolls back an already durable canvas.
		const existing = await findExistingProject();
		if (existing) throw error;
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(
			`[project-activity] project row missing after touch error; canvas write remains authoritative project=${input.projectId} owner=${input.ownerId} reason=${reason}`,
		);
		return;
	}
	if (result.count === 1) return;
	const existing = await findExistingProject();
	if (!existing) {
		if (input.allowMissing === true) {
			console.warn(
				`[project-activity] project row missing; canvas write remains authoritative project=${input.projectId} owner=${input.ownerId}`,
			);
			return;
		}
		throw new ProjectActivityTouchError(input.projectId);
	}
}

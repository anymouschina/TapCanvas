import { vi } from "vitest";

// 共享测试桩：章节画布保存链路（putChapterCanvasFlow / getChapterCanvasFlow）用的最小
// AppContext + Prisma 内存桩。chapter.canvas-flow.service.test.ts 与
// chapter.canvas-flow.source.test.ts 都复用它，避免复制粘贴 fake ctx。

export type FakeChapter = {
	id: string;
	owner_id: string;
	project_id?: string;
	canvas_flow: string | null;
	canvas_flow_revision: number;
};

export function matchesWhere(row: FakeChapter, where: any): boolean {
	if (where.id !== undefined && row.id !== where.id) return false;
	if (where.owner_id !== undefined && row.owner_id !== where.owner_id)
		return false;
	if (
		where.canvas_flow_revision !== undefined &&
		row.canvas_flow_revision !== where.canvas_flow_revision
	)
		return false;
	return true;
}

export type FakeVideoRun = { id: string; chapter_id: string; state: string };

export function makeCtx(
	chapters: Map<string, FakeChapter>,
	videoRuns: FakeVideoRun[] = [],
	role: "admin" | "member" = "member",
) {
	return {
		get: (key: string) => key === "auth" ? { role } : undefined,
		env: {
			DB: {
				// 团队访问路径（getProjectForUserAccess→team schema/share 查询）的最小桩：
				// 非本人访问时走到这里，返回「无共享/无项目」→ 服务层按 not-found 抛，测试不再炸 TypeError。
				$executeRawUnsafe: vi.fn(async () => 0),
				$queryRawUnsafe: vi.fn(async () => []),
				projects: {
					findFirst: vi.fn(async ({ where }: { where?: { id?: string; owner_id?: string } }) =>
						where?.id === "project-1" && where?.owner_id === "u1" ? { id: "project-1" } : null,
					),
					updateMany: vi.fn(async ({ where }: { where?: { id?: string; owner_id?: string } }) => ({
						count: where?.id === "project-1" && where?.owner_id === "u1" ? 1 : 0,
					})),
				},
				video_runs: {
					findFirst: vi.fn(async ({ where }: any) => {
						for (const r of videoRuns) {
							if (
								where?.chapter_id !== undefined &&
								r.chapter_id !== where.chapter_id
							)
								continue;
							if (
								where?.state?.notIn &&
								where.state.notIn.includes(r.state)
							)
								continue;
							return r;
						}
						return null;
					}),
					findMany: vi.fn(async ({ where }: any) => {
						return videoRuns.filter((r) => {
							if (
								where?.chapter_id !== undefined &&
								r.chapter_id !== where.chapter_id
							)
								return false;
							if (
								where?.state?.notIn &&
								where.state.notIn.includes(r.state)
							)
								return false;
							return true;
						});
					}),
				},
				chapters: {
					findFirst: vi.fn(async ({ where }: any) => {
						for (const row of chapters.values()) {
							if (matchesWhere(row, where)) return { ...row, project_id: row.project_id ?? "project-1" };
						}
						return null;
					}),
					updateMany: vi.fn(async ({ where, data }: any) => {
						let count = 0;
						for (const row of chapters.values()) {
							if (!matchesWhere(row, where)) continue;
							const {
								canvas_flow_revision: revisionUpdate,
								...rest
							} = data;
							Object.assign(row, rest);
							if (
								typeof revisionUpdate === "object" &&
								revisionUpdate?.increment
							) {
								row.canvas_flow_revision =
									row.canvas_flow_revision + revisionUpdate.increment;
							} else if (typeof revisionUpdate === "number") {
								row.canvas_flow_revision = revisionUpdate;
							}
							count += 1;
						}
						return { count };
					}),
				},
			},
		},
	} as any;
}

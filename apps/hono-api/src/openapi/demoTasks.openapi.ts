import { createRoute, z, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { AppEnv } from "../types";
import { getPrismaClient } from "../platform/node/prisma";

const DemoTaskSchema = z
	.object({
		name: z.string().min(1).openapi({ example: "lorem" }),
		slug: z.string().min(1).openapi({ example: "lorem-1" }),
		description: z.string().optional().openapi({ example: "任务描述（可选）" }),
		completed: z.boolean().default(false).openapi({ example: false }),
		due_date: z
			.string()
			.datetime()
			.openapi({ example: "2026-01-01T00:00:00.000Z" }),
	})
	.openapi("DemoTask");

const ErrorResponseSchema = z
	.object({
		success: z.literal(false),
		error: z.string(),
	})
	.openapi("ErrorResponse");

const ZodIssueSchema = z
	.object({
		code: z.string(),
		message: z.string(),
		path: z.array(z.union([z.string(), z.number()])),
	})
	.openapi("ZodIssue");

const ValidationErrorResponseSchema = z
	.object({
		success: z.literal(false),
		error: z.literal("请求参数不合法"),
		issues: z.array(ZodIssueSchema).optional(),
	})
	.openapi("ValidationErrorResponse");

const listDemoTasksRouteConfig = {
	method: "get" as const,
	path: "/api/tasks" as const,
	tags: ["Demo Tasks"],
	summary: "列出示例任务",
	request: {
		query: z.object({
			page: z.coerce.number().int().min(0).default(0).openapi({
				description: "分页页码（从 0 开始）",
				example: 0,
			}),
			isCompleted: z.enum(["true", "false"]).optional().openapi({
				description: "是否已完成过滤（true/false，可选）",
				example: "false",
			}),
		}),
	},
	responses: {
		200: {
			description: "返回任务列表",
			content: {
				"application/json": {
					schema: z
						.object({
							success: z.literal(true),
							tasks: z.array(DemoTaskSchema),
						})
						.openapi({
							example: {
								success: true,
								tasks: [
									{
										name: "lorem",
										slug: "lorem-1",
										description: "任务描述（可选）",
										completed: false,
										due_date: "2026-01-01T00:00:00.000Z",
									},
								],
							},
						}),
				},
			},
		},
		400: {
			description: "请求参数不合法",
			content: {
				"application/json": {
					schema: ValidationErrorResponseSchema,
				},
			},
		},
	},
};
const ListDemoTasksRoute = createRoute(listDemoTasksRouteConfig);

const createDemoTaskRouteConfig = {
	method: "post" as const,
	path: "/api/tasks" as const,
	tags: ["Demo Tasks"],
	summary: "创建示例任务",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: DemoTaskSchema.openapi({
						description: "示例任务对象",
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "返回创建后的任务",
			content: {
				"application/json": {
					schema: z
						.object({
							success: z.literal(true),
							task: DemoTaskSchema,
						})
						.openapi({
							example: {
								success: true,
								task: {
									name: "lorem",
									slug: "lorem-1",
									description: "任务描述（可选）",
									completed: false,
									due_date: "2026-01-01T00:00:00.000Z",
								},
							},
						}),
				},
			},
		},
		409: {
			description: "任务 slug 已存在",
			content: {
				"application/json": {
					schema: ErrorResponseSchema.openapi({
						example: { success: false, error: "Task slug already exists" },
					}),
				},
			},
		},
		400: {
			description: "请求参数不合法",
			content: {
				"application/json": {
					schema: ValidationErrorResponseSchema,
				},
			},
		},
	},
};
const CreateDemoTaskRoute = createRoute(createDemoTaskRouteConfig);

const fetchDemoTaskRouteConfig = {
	method: "get" as const,
	path: "/api/tasks/{taskSlug}" as const,
	tags: ["Demo Tasks"],
	summary: "获取单个示例任务",
	request: {
		params: z.object({
			taskSlug: z.string().min(1).openapi({
				description: "任务 slug",
				example: "lorem-1",
			}),
		}),
	},
	responses: {
		200: {
			description: "返回任务",
			content: {
				"application/json": {
					schema: z
						.object({
							success: z.literal(true),
							task: DemoTaskSchema,
						})
						.openapi({
							example: {
								success: true,
								task: {
									name: "lorem",
									slug: "lorem-1",
									description: "任务描述（可选）",
									completed: false,
									due_date: "2026-01-01T00:00:00.000Z",
								},
							},
						}),
				},
			},
		},
		404: {
			description: "任务不存在",
			content: {
				"application/json": {
					schema: ErrorResponseSchema.openapi({
						example: { success: false, error: "Task not found" },
					}),
				},
			},
		},
		400: {
			description: "请求参数不合法",
			content: {
				"application/json": {
					schema: ValidationErrorResponseSchema,
				},
			},
		},
	},
};
const FetchDemoTaskRoute = createRoute(fetchDemoTaskRouteConfig);

const deleteDemoTaskRouteConfig = {
	method: "delete" as const,
	path: "/api/tasks/{taskSlug}" as const,
	tags: ["Demo Tasks"],
	summary: "删除示例任务",
	request: {
		params: z.object({
			taskSlug: z.string().min(1).openapi({
				description: "任务 slug",
				example: "lorem-1",
			}),
		}),
	},
	responses: {
		200: {
			description: "返回被删除的任务",
			content: {
				"application/json": {
					schema: z
						.object({
							success: z.literal(true),
							task: DemoTaskSchema,
						})
						.openapi({
							example: {
								success: true,
								task: {
									name: "lorem",
									slug: "lorem-1",
									description: "任务描述（可选）",
									completed: false,
									due_date: "2026-01-01T00:00:00.000Z",
								},
							},
						}),
				},
			},
		},
		404: {
			description: "任务不存在",
			content: {
				"application/json": {
					schema: ErrorResponseSchema.openapi({
						example: { success: false, error: "Task not found" },
					}),
				},
			},
		},
		400: {
			description: "请求参数不合法",
			content: {
				"application/json": {
					schema: ValidationErrorResponseSchema,
				},
			},
		},
	},
};
const DeleteDemoTaskRoute = createRoute(deleteDemoTaskRouteConfig);

export function registerDemoTasksOpenApi(app: OpenAPIHono<AppEnv>) {
	const listDemoTasksHandler: RouteHandler<typeof ListDemoTasksRoute, AppEnv> = async (c) => {
		const { page, isCompleted } = c.req.valid("query");
		const completed =
			isCompleted === "true"
				? true
				: isCompleted === "false"
					? false
					: undefined;

		const pageSize = 20;
		const offset = page * pageSize;
		const rows = await getPrismaClient().tasks.findMany({
			where: typeof completed === "boolean" ? { completed: completed ? 1 : 0 } : {},
			orderBy: { due_date: "asc" },
			take: pageSize,
			skip: offset,
		});

		return c.json(
			{
				success: true,
				tasks: rows.map((row) => ({
					name: row.name,
					slug: row.slug,
					description: row.description ?? undefined,
					completed: row.completed === 1,
					due_date: row.due_date,
				})),
			},
				200,
			);
	};
	app.openapi(ListDemoTasksRoute, listDemoTasksHandler);

	const createDemoTaskHandler: RouteHandler<typeof CreateDemoTaskRoute, AppEnv> = async (c) => {
		const taskToCreate = c.req.valid("json");

		try {
			await getPrismaClient().tasks.create({
				data: {
					slug: taskToCreate.slug,
					name: taskToCreate.name,
					description: taskToCreate.description ?? null,
					completed: taskToCreate.completed ? 1 : 0,
					due_date: taskToCreate.due_date,
				},
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			if (message.includes("SQLITE_CONSTRAINT") || message.includes("P2002")) {
				return c.json(
					{
						success: false,
						error: "Task slug already exists",
					},
					409,
				);
			}
			throw error;
		}

		return c.json(
			{
				success: true,
				task: taskToCreate,
			},
				200,
			);
	};
	app.openapi(CreateDemoTaskRoute, createDemoTaskHandler);

	const fetchDemoTaskHandler: RouteHandler<typeof FetchDemoTaskRoute, AppEnv> = async (c) => {
		const { taskSlug } = c.req.valid("param");

		const row = await getPrismaClient().tasks.findUnique({
			where: { slug: taskSlug },
			select: {
				name: true,
				slug: true,
				description: true,
				completed: true,
				due_date: true,
			},
		});

		if (!row) {
			return c.json(
				{
					success: false,
					error: "Task not found",
				},
				404,
			);
		}

		return c.json(
			{
				success: true,
				task: {
					name: row.name,
					slug: row.slug,
					description: row.description ?? undefined,
					completed: row.completed === 1,
					due_date: row.due_date,
				},
			},
				200,
			);
	};
	app.openapi(FetchDemoTaskRoute, fetchDemoTaskHandler);

	const deleteDemoTaskHandler: RouteHandler<typeof DeleteDemoTaskRoute, AppEnv> = async (c) => {
		const { taskSlug } = c.req.valid("param");

		const row = await getPrismaClient().tasks.findUnique({
			where: { slug: taskSlug },
			select: {
				name: true,
				slug: true,
				description: true,
				completed: true,
				due_date: true,
			},
		});

		if (!row) {
			return c.json(
				{
					success: false,
					error: "Task not found",
				},
				404,
			);
		}

		await getPrismaClient().tasks.delete({ where: { slug: taskSlug } });

		return c.json(
			{
				success: true,
				task: {
					name: row.name,
					slug: row.slug,
					description: row.description ?? undefined,
					completed: row.completed === 1,
					due_date: row.due_date,
				},
			},
				200,
			);
	};
	app.openapi(DeleteDemoTaskRoute, deleteDemoTaskHandler);
}

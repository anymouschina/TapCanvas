import { Bool, Num, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { type AppContext, Task } from "../types";

export class TaskList extends OpenAPIRoute {
	schema = {
		tags: ["Tasks"],
		summary: "List Tasks",
		request: {
			query: z.object({
				page: Num({
					description: "Page number",
					default: 0,
				}),
				isCompleted: Bool({
					description: "Filter by completed flag",
					required: false,
				}),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of tasks",
				content: {
					"application/json": {
						schema: z.object({
							series: z.object({
								success: Bool(),
								result: z.object({
									tasks: Task.array(),
								}),
							}),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		// Get validated data
		const data = await this.getValidatedData<typeof this.schema>();
		const { page, isCompleted } = data.query;

		const pageSize = 20;
		const offset = page * pageSize;

		let sql =
			"SELECT name, slug, description, completed, due_date FROM tasks";
		const params: unknown[] = [];

		if (typeof isCompleted === "boolean") {
			sql += " WHERE completed = ?";
			params.push(isCompleted ? 1 : 0);
		}

		sql += " ORDER BY due_date ASC LIMIT ? OFFSET ?";
		params.push(pageSize, offset);

		const result = await c.env.DB.prepare(sql)
			.bind(...params)
			.all<{
				name: string;
				slug: string;
				description: string | null;
				completed: number;
				due_date: string;
			}>();

		const rows = result.results ?? [];

		return {
			success: true,
			tasks: rows.map((row) => ({
				name: row.name,
				slug: row.slug,
				description: row.description,
				completed: row.completed === 1,
				due_date: row.due_date,
			})),
		};
	}
}

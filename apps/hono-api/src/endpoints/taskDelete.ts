import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { type AppContext, Task } from "../types";

export class TaskDelete extends OpenAPIRoute {
	schema = {
		tags: ["Tasks"],
		summary: "Delete a Task",
		request: {
			params: z.object({
				taskSlug: Str({ description: "Task slug" }),
			}),
		},
		responses: {
			"200": {
				description: "Returns if the task was deleted successfully",
				content: {
					"application/json": {
						schema: z.object({
							series: z.object({
								success: Bool(),
								result: z.object({
									task: Task,
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
		const { taskSlug } = data.params;

		const row = await c.env.DB.prepare(
			"SELECT name, slug, description, completed, due_date FROM tasks WHERE slug = ?",
		)
			.bind(taskSlug)
			.first<{
				name: string;
				slug: string;
				description: string | null;
				completed: number;
				due_date: string;
			}>();

		if (!row) {
			return c.json(
				{
					success: false,
					error: "Task not found",
				},
				404,
			);
		}

		await c.env.DB.prepare("DELETE FROM tasks WHERE slug = ?")
			.bind(taskSlug)
			.run();

		return {
			result: {
				task: {
					name: row.name,
					slug: row.slug,
					description: row.description,
					completed: row.completed === 1,
					due_date: row.due_date,
				},
			},
			success: true,
		};
	}
}

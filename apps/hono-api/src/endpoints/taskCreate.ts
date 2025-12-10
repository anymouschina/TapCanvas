import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { type AppContext, Task } from "../types";

export class TaskCreate extends OpenAPIRoute {
	schema = {
		tags: ["Tasks"],
		summary: "Create a new Task",
		request: {
			body: {
				content: {
					"application/json": {
						schema: Task,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the created task",
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
			"409": {
				description: "Task slug already exists",
				content: {
					"application/json": {
						schema: z.object({
							series: z.object({
								success: Bool(),
								error: Str(),
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
		const taskToCreate = data.body;

		try {
			await c.env.DB.prepare(
				`
        INSERT INTO tasks (slug, name, description, completed, due_date)
        VALUES (?, ?, ?, ?, ?)
      `,
			)
				.bind(
					taskToCreate.slug,
					taskToCreate.name,
					taskToCreate.description ?? null,
					taskToCreate.completed ? 1 : 0,
					taskToCreate.due_date,
				)
				.run();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			if (message.includes("SQLITE_CONSTRAINT")) {
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

		return {
			success: true,
			task: {
				name: taskToCreate.name,
				slug: taskToCreate.slug,
				description: taskToCreate.description,
				completed: taskToCreate.completed,
				due_date: taskToCreate.due_date,
			},
		};
	}
}

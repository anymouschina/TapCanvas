import { ToolHandler } from "./registry.js";
import { TodoManager, TodoItem } from "../planner/todo.js";

export function createTodoTool(manager: TodoManager): ToolHandler {
  return {
    definition: {
      name: "TodoWrite",
      description: "更新轻量任务清单。用于复杂任务的执行前 planning 和进度维护；仅用于短期清单，不是持久化主任务系统；多步协作优先使用 task_* 工具。",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
                activeForm: { type: "string" },
              },
              required: ["content", "status", "activeForm"],
            },
          },
        },
        required: ["items"],
      },
    },
    async execute(args, _ctx, toolCallId) {
      const items = Array.isArray(args.items) ? (args.items as TodoItem[]) : [];
      try {
        const result = manager.update(items);
        return { toolCallId, content: result };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

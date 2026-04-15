export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
};

export class TodoManager {
  private items: TodoItem[] = [];

  update(items: TodoItem[]) {
    const validated: TodoItem[] = [];
    let inProgress = 0;

    items.forEach((item, index) => {
      const content = String(item.content ?? "").trim();
      const status = String(item.status ?? "pending").toLowerCase();
      const activeForm = String(item.activeForm ?? "").trim();

      if (!content || !activeForm) {
        throw new Error(`Item ${index}: content and activeForm required`);
      }
      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`Item ${index}: invalid status`);
      }
      if (status === "in_progress") inProgress += 1;

      validated.push({
        content,
        status: status as TodoItem["status"],
        activeForm,
      });
    });

    if (inProgress > 1) {
      throw new Error("Only one task can be in_progress");
    }

    this.items = validated.slice(0, 20);
    return this.render();
  }

  render() {
    if (this.items.length === 0) return "No todos.";
    const lines = this.items.map((item) => {
      const mark =
        item.status === "completed"
          ? "[x]"
          : item.status === "in_progress"
          ? "[>]"
          : "[ ]";
      return `${mark} ${item.content}`;
    });
    const done = this.items.filter((i) => i.status === "completed").length;
    return `${lines.join("\n")}\n(${done}/${this.items.length} done)\nNote: TodoWrite is ephemeral. Use task_* tools for persistent task graph state.`;
  }
}

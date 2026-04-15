import type { AgentsHook } from "./types.js";

export class HookRegistry {
  private hooks: AgentsHook[] = [];

  register(hook: AgentsHook): void {
    this.hooks.push(hook);
  }

  list(): AgentsHook[] {
    return [...this.hooks];
  }
}

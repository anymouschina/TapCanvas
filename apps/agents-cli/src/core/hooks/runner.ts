import type {
  AfterRunHookPayload,
  AgentsHook,
  BeforeRunHookPayload,
  RunErrorHookPayload,
  ToolCallHookPayload,
} from "./types.js";

export class HookRunner {
  constructor(private readonly hooks: AgentsHook[]) {}

  async beforeRun(payload: BeforeRunHookPayload): Promise<void> {
    await this.runSequentially((hook) => hook.beforeRun?.(payload));
  }

  async afterRun(payload: AfterRunHookPayload): Promise<void> {
    await this.runSequentially((hook) => hook.afterRun?.(payload));
  }

  async onRunError(payload: RunErrorHookPayload): Promise<void> {
    await this.runSequentially((hook) => hook.onRunError?.(payload));
  }

  async onToolCall(payload: ToolCallHookPayload): Promise<void> {
    await this.runSequentially((hook) => hook.onToolCall?.(payload));
  }

  private async runSequentially(run: (hook: AgentsHook) => Promise<void> | undefined): Promise<void> {
    for (const hook of this.hooks) {
      await run(hook);
    }
  }
}

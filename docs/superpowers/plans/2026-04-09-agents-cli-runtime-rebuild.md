# Agents CLI Runtime Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared `AssistantRuntime` and surface modules so CLI, TUI, and HTTP stop owning duplicated runtime assembly logic.

**Architecture:** Keep `src/core/*` as the execution kernel, add `src/runtime/*` for stable runtime services, and add `src/surfaces/*` for user-facing entrypoints. Hard-cut callers over to the new modules instead of maintaining dual paths.

**Tech Stack:** TypeScript, Node.js, Commander, existing agents-cli core services

---

### Task 1: Lock the runtime/session contract with tests

**Files:**
- Create: `apps/agents-cli/src/runtime/runtime.test.ts`
- Create: `apps/agents-cli/src/runtime/session.test.ts`

- [ ] **Step 1: Write failing tests for the new runtime contract**

```ts
const runtime = createAssistantRuntime({
  cwd: workspaceRoot,
  config: createConfig(workspaceRoot),
  profile: "general",
});

const meta = runtime.createToolContextMeta();

assert.equal(meta.runtimeProfile, "general");
assert.equal(meta.registeredToolNames.includes("exec_command"), false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --loader ts-node/esm --test src/runtime/session.test.ts src/runtime/runtime.test.ts`
Expected: FAIL because `src/runtime/runtime.ts` and `src/runtime/session.ts` do not exist yet.

- [ ] **Step 3: Implement minimal runtime/session modules**

```ts
export function resolveRuntimeSessionKey(cliSession?: unknown): string | null {
  const fromCli = typeof cliSession === "string" ? cliSession.trim() : "";
  if (fromCli) return fromCli;
  const fromTask = (process.env.AGENTS_TASK_ID || "").trim();
  return fromTask || null;
}
```

- [ ] **Step 4: Re-run tests**

Run: `node --loader ts-node/esm --test src/runtime/session.test.ts src/runtime/runtime.test.ts`
Expected: PASS

### Task 2: Cut CLI over to the shared runtime

**Files:**
- Modify: `apps/agents-cli/src/cli/index.ts`
- Create: `apps/agents-cli/src/runtime/runtime.ts`
- Create: `apps/agents-cli/src/runtime/profile.ts`
- Create: `apps/agents-cli/src/runtime/skills.ts`

- [ ] **Step 1: Replace inline runtime assembly with `createAssistantRuntime()`**

```ts
const runtime = createAssistantRuntime({
  cwd,
  config,
  profile: resolveAgentRuntimeProfile(),
});
```

- [ ] **Step 2: Route session history through runtime helpers**

```ts
const sessionKey = resolveRuntimeSessionKey(options.session);
const history = sessionKey ? runtime.loadSessionHistory(sessionKey) : null;
```

- [ ] **Step 3: Run TypeScript compile check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

### Task 3: Split surface logic out of CLI entrypoint

**Files:**
- Create: `apps/agents-cli/src/surfaces/cli/io.ts`
- Create: `apps/agents-cli/src/surfaces/tui/repl-session.ts`
- Modify: `apps/agents-cli/src/cli/index.ts`

- [ ] **Step 1: Move stdin/tool-preview helpers into CLI surface module**

```ts
export async function readPromptFromStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  // ...
}
```

- [ ] **Step 2: Move REPL loop into TUI surface module**

```ts
export async function startReplSession(runtime: AssistantRuntime): Promise<void> {
  const repl = new ReplTui({ skills: runtime.skills, historyEntries: promptHistory });
  // ...
}
```

- [ ] **Step 3: Re-run TypeScript compile check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

### Task 4: Sync documentation to the new architecture

**Files:**
- Modify: `apps/agents-cli/README.md`

- [ ] **Step 1: Update the runtime architecture section**

```md
- `src/runtime/runtime.ts`: `AssistantRuntime` 门面
- `src/surfaces/cli/*`: CLI surface
- `src/surfaces/tui/*`: TUI surface
```

- [ ] **Step 2: Verify the README reflects the new boundaries**

Run: `rg -n "src/runtime/runtime.ts|src/surfaces/cli|src/surfaces/tui" apps/agents-cli/README.md`
Expected: matches found

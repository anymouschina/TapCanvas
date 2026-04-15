---
name: agents-team
description: Enable general multi-agent team mode via spawn_agent/wait tools. Supports orchestrator, worker, reviewer, research, writer, and editor roles.
---

# agents-team

This Skill enables **general agents team mode**. It is **disabled by default** and only becomes available after you load this Skill.

## Principles

- Only use multi-agent tools when the user explicitly requests team mode, or after this Skill is loaded.
- Always **explicitly declare roles** by using `agent_type`:
  - `orchestrator`: plan, delegate, and merge.
  - `worker`: implement a bounded code or execution task.
  - `reviewer`: do a read-only audit for bugs, regressions, or missing checks.
  - `research`: summarize sources / produce supporting material.
  - `writer`: draft a section or structured artifact.
  - `editor`: unify voice, tighten structure, fix inconsistencies.
- Keep each sub-agent task well-scoped and output-oriented.
- Prefer parallel delegation only for independent work. If one result determines the next step, do not parallelize.
- Use `list_agents` and `wait` to observe real team state instead of assuming progress.
- When you need to reference a specific dispatched task, track the returned `submission_id`, not only the `agent_id`.
- Use `fork_context: true` only when the child genuinely needs the current conversation context; otherwise keep prompts tighter.
- Team children inherit the parent runtime grant for tools/filesystem/network, but runtime strips further subagent spawning (`spawn_agent` / legacy `Task`).
- Do not add blanket constraints like “不要调用任何工具” unless the task truly requires it; role prompts are soft guidance, runtime grant is the hard boundary.

## Tools (available only after this Skill is loaded)

- `spawn_agent({ agent_type, prompt, description?, fork_context? })` -> `{ agent_id, submission_id }`
- `wait({ ids, timeout_ms? })` -> agent statuses + submission statuses/previews
- `send_input({ id, prompt, interrupt? })` -> queue more work for that agent and return a new `submission_id`
- `resume_agent({ id })` -> reopen a closed agent so it can receive future work
- `close_agent({ id })`
- `list_agents()`

## Recommended Workflow (General Team)

1. Orchestrator determines whether the next step is read-only exploration, implementation, review, or synthesis.
2. Spawn only the agents that materially reduce wall-clock time.
3. `wait` for the blocking agents before the next dependent step.
4. If implementation happened, run a `reviewer` or explicit verification pass before finalizing.
5. Final answer: one merged result with evidence, changed files, or findings as appropriate.

## Lifecycle Notes

- `close_agent` only stops future queued work. It does not kill in-flight execution.
- `resume_agent` is for reopening a previously closed agent, not for rewinding history.
- `interrupt: true` is reserved but not yet implemented as a real preemption primitive. If the target agent is still busy, the tool should fail explicitly instead of pretending success.
- If you pass `task_id` to `spawn_agent` and that task is already owned by the current parent agent, runtime will drop the duplicate child binding. If another owner already holds it, `spawn_agent` fails explicitly and you should retry without `task_id` when you only need an unbound helper.

## Prompt Template

Use this exact structure when delegating:

- Context: target audience, constraints, length, tone
- Deliverable: what to output, format requirements
- Must include: bullet list of required points
- Must avoid: banned content / style

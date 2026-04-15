# AI Runtime Architecture

## Core Principles

1. Runtime knowledge source

- Runtime knowledge may come only from:
  - `skills/`
  - real code, tool results, and project data
- `docs/`, `assets/`, and `ai-metadata/` are not runtime knowledge sources.

2. Responsibility split

- `web` collects real context and executes validated canvas plans.
- `hono-api` injects hard constraints only:
  - permissions
  - output protocol
  - factuality
  - explicit failure
  - audit/trace
- `agents-cli` performs:
  - intent recognition
  - evidence planning
  - skill loading
  - subagent delegation
  - result synthesis

3. Skills vs prompt

- SOP, creative methods, workflow heuristics, and prompting methods belong in `skills/`.
- System prompts must not hard-code route logic, workflow SOPs, or fixed subagent order.

4. Failure policy

- Missing evidence must fail explicitly.
- No silent fallback.
- No fabricated progress or fabricated project state.

## Current Migration Direction

- Remove runtime guidance that points agents to `docs/assets/ai-metadata`.
- Keep `hono-api` prompt minimal and structural.
- Move TapCanvas workflow methods into dedicated runtime skills.

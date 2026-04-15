---
name: long-running-app-harness
description: Run a planner -> contract -> build -> evaluator loop for long-running application work using agents-team, task graph, protocol handshakes, and staged worker imports.
---

# long-running-app-harness

Use this skill when the user wants:
- a long-running autonomous app build
- planner / generator / evaluator style execution
- explicit build contracts before implementation
- skeptical QA or review loops before merging worker output
- multi-round implementation with durable artifacts

This skill is generic. It must not assume a product-specific stack, route map, or prompt pack.

## Preconditions

- Load `agents-team` first. This skill relies on `spawn_agent`, `wait`, `protocol_*`, and `agent_workspace_import`.
- Treat the persistent task graph as the durable source of truth for multi-step work.
- Use structured artifacts, not implicit chat memory, to hand off state across rounds.
- Prefer explicit failure when tools, runtime targets, or verification surfaces are missing.

## Roles

- `orchestrator`: owns the overall run, task graph, and final synthesis
- `worker`: implements one bounded slice in a private workspace
- `reviewer`: acts as the skeptical evaluator; read-only, threshold-based, evidence-first

Do not add extra roles unless the task genuinely needs different tool bounds.

## Core Loop

1. Create a harness run directory:
   - `.agents/runtime/harness/<run-id>/`
2. Write `product_spec.json`
3. For each round `NN`:
   - write `round-NN-contract.json`
   - dispatch `worker`
   - collect staged artifacts / code handoff
   - dispatch `reviewer` as evaluator
   - write `round-NN-evaluation.json`
   - if failed: create the next round from evaluator feedback
   - if passed: `agent_workspace_import` and complete the task graph
4. Write `final-report.json`

## Artifact Rules

Store all harness artifacts under:

- `.agents/runtime/harness/<run-id>/product_spec.json`
- `.agents/runtime/harness/<run-id>/round-01-contract.json`
- `.agents/runtime/harness/<run-id>/round-01-evaluation.json`
- `.agents/runtime/harness/<run-id>/final-report.json`

Do not hide important state only inside conversation history.

## Product Spec Contract

`product_spec.json` should contain:

```json
{
  "title": "Short product name",
  "problem": "What is being built and for whom",
  "userOutcomes": ["..."],
  "scope": {
    "mustHave": ["..."],
    "shouldHave": ["..."],
    "outOfScope": ["..."]
  },
  "acceptanceThemes": [
    "feature_completeness",
    "functionality",
    "ux_or_design_quality",
    "code_quality"
  ],
  "constraints": ["..."],
  "risks": ["..."]
}
```

Planner guidance:
- Be ambitious on product value, conservative on implementation detail.
- Do not over-specify low-level technical choices too early.
- Define user-visible success, constraints, and evaluation themes.

## Build Contract

Before any worker starts coding, the orchestrator and evaluator must agree on a round contract.

Use `protocol_request` / `protocol_respond` for this handshake.

`round-NN-contract.json` should contain:

```json
{
  "round": 1,
  "goal": "What this round must achieve",
  "ownedTasks": ["task_0001", "task_0002"],
  "deliverables": ["..."],
  "verificationPlan": [
    {
      "criterion": "Concrete expected behavior",
      "howToCheck": "Deterministic verification method",
      "hardFail": true
    }
  ],
  "nonGoals": ["..."],
  "handoffPaths": ["relative paths expected from worker staging"],
  "notes": ["..."]
}
```

Contract rules:
- Every criterion must be observable.
- Vague goals like "looks good" or "works better" are invalid.
- If the evaluator cannot verify a claim, the contract is incomplete.

## Worker Instructions

The worker must:
- operate only on the scoped round goal
- write repo changes under its staged repo root
- run verification it can perform locally
- return a concise change summary, blockers, and known gaps
- never claim completion without referencing contract criteria

## Evaluator Instructions

The reviewer acts as a skeptical evaluator.

Evaluator rules:
- read the product spec and the exact round contract first
- judge against contract criteria, not vibes
- prefer concrete failures over generous interpretation
- if a required runtime surface is missing, fail explicitly
- findings must be evidence-first and actionable

`round-NN-evaluation.json` should contain:

```json
{
  "round": 1,
  "decision": "pass",
  "scores": {
    "feature_completeness": 8,
    "functionality": 9,
    "ux_or_design_quality": 7,
    "code_quality": 8
  },
  "hardFailures": [],
  "findings": [
    {
      "severity": "high",
      "criterion": "Timeline clips can be dragged",
      "evidence": "Drag gesture has no effect in editor",
      "repro": ["open editor", "create clip", "drag clip"],
      "suggestedFix": "Wire drag state into clip position update"
    }
  ],
  "nextActions": ["..."],
  "importApproved": true
}
```

Decision rules:
- `pass` only when no hard-fail criterion is unmet
- `fail` when any hard-fail criterion is unmet, or evidence is insufficient
- never silently waive contract gaps

## Verification Surfaces

Use the strongest available verification surface for the task:

- local tests / build
- deterministic CLI checks
- browser or app-driving remote tools
- API calls
- file / artifact inspection

If browser-driving tools or other remote tools are required, the orchestrator must confirm they are available before claiming the evaluator can verify UI behavior.

## Import Gate

Only import worker staged files when:
- the evaluator decision is `pass`
- the contract is satisfied
- import conflicts are reviewed explicitly

If the evaluator decision is `fail`, keep the worker output as evidence but do not import it.

## Recommended Execution Pattern

1. Load `agents-team`
2. Create a top-level task graph for spec, round contract, build, evaluation, and import
3. Spawn `worker` for implementation
4. Spawn `reviewer` for evaluation
5. Use protocol messages for contract negotiation and evaluator sign-off
6. Use `wait` on blocking submissions
7. Import only after explicit evaluator pass

## Failure Behavior

Stop and report explicitly when:
- no verification surface exists for the claimed behavior
- required tools are unavailable
- the product spec is too vague to derive a contract
- the worker output does not map to contract deliverables
- the evaluator cannot collect enough evidence to pass safely

## Final Report

`final-report.json` should summarize:
- product spec title
- rounds completed
- final decision
- imported files
- unresolved risks
- recommended next tasks

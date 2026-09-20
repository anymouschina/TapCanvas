# Retake Protocol — the iteration economy

*What happens after a generation comes back. The rest of this skill plans the shot and repairs outright failure; this governs everything in between — the partially good take, which is most of real production. Labels: [heuristic] = default to test · [internal-guidance] = workflow guidance, never execution evidence. Cost figures are surface-specific and volatile: load `api-status.md` and verify live before budgeting.*

## Triage every take — five verdicts

| Verdict | When | Next move |
|---|---|---|
| **Keep** | The primary spend (the thing this shot is FOR, per `allocation-model.md`) is delivered and nothing is fatal. | Lock it, log it, move on. Perfection in secondary details is post's job. |
| **Fix in post** | The flaw lives in post's domain: color, on-screen text, sound mix, trim, a few unstable frames at the ends. | Never burn takes on what an editor fixes in minutes. |
| **Edit, don't regenerate** | Composition and timing are right; exactly one layer is wrong, and the surface supports edit. | Preserve the take as the source clip; change only the failing layer. |
| **Re-roll** | The prompt is right; the sample may reflect sampling variance. | Same prompt, new seed, within an explicit action budget derived from the active surface and user-approved spend. When that action budget closes, return the evidence to the same logical task and change strategy; do not treat it as a user-level blocker. |
| **Rewrite** | The same flaw appears in two or more takes. | It is systematic, not luck. Diagnose by mechanism (`model-mechanics.md`), change the prompt. |

## The one-variable rule [heuristic]

Change one thing per retake: one prompt clause, OR the seed, OR the mode, OR one reference — never several. Same seed plus one prompt change is the closest available thing to a controlled experiment; new seed with the same prompt is a pure re-roll. Change two things at once and the result is unreadable either way it lands — you learn nothing.

## Attempt budget [heuristic]

Set an explicit action budget before take one using the active surface's real per-call or per-second price, requested duration, latency, available invocation limits, and the user's authorized spend. There is no family-wide default take count or Fast/Standard tier. Use a tier name only when the active structured surface exposes it. When the re-roll action budget is exhausted, preserve the attempts and feed the failure evidence back into the same logical task to rewrite, edit, or choose another authorized path; an action budget does not terminate the user's overall goal.

## Cost awareness [internal-guidance]

Every second or call can cost real money, and retakes multiply it. Load `api-status.md`, then verify the selected surface's live unit, price, duration, resolution, and entitlement before estimating or spending. Provider examples are not Seedance-family prices. Spend accordingly:

- If the active surface exposes priced tiers, durations, or resolutions, select a cheaper diagnostic configuration only after stating the quality/continuity trade-off and keeping it inside the user's authorization. Otherwise do not invent a Fast/Standard workflow.
- Prefer scoped tests that answer one uncertainty at a time; the exact count and duration come from the active contract and budget, not a universal recipe.
- Quote costs to users only with the verification date and a verify-live caveat.

## The shot log [internal-guidance]

One line per take — this is the story state made auditable:

`Take N · changed: [the one variable] · seed: [same/new] · verdict: [keep/post/edit/re-roll/rewrite] · evidence: [one sentence]`

Re-reading the log beats re-living it. Two takes in the log with the same flaw is a rewrite, by rule — no third attempt on luck.

## Sequence Canon [internal-guidance]

For sequence projects, a take review decides whether footage becomes canon.

- Accept: record observed start/end state and allow it to become a parent source.
- Accept with deviation: record the deviation, update downstream beats, and carry unfinished work forward.
- Repair: do not advance the sequence until the repaired tail or layer is accepted.
- Reject: do not update canon and do not use that take as a parent source.

Accepted observed state overrides planned state. If a clip unexpectedly completes a future beat, mark that beat completed and remove it from later prompts.

## When the answer is "don't generate"

Honest direction sometimes refuses the tool: dense on-screen text belongs to post, a real product's exact behavior may belong to a camera, archival reality belongs to licensing, and a shot that has failed its budget twice after decomposition belongs to a different idea. "Film this one for real" is a deliverable, not a failure.

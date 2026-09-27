# Writer runtime brief and reference navigation

This small brief is the writer's first orientation. It does not replace the
authoring contract, the dynamic Workflow output contract, or a selected
domain reference.

## Writer ownership

The writer owns one frozen Clip. Read the current `beat`, its frozen
`spokenScript`, `assetObjectContracts`, and the adjacent continuity facts, then
turn those facts into the actual `clips[].shots[]`, camera, performance,
physical response, sound, and visual effects fields. Draft the complete action
timeline first, replay it against the frozen entry state, event order, dialogue
clock, and exit state, and revise in the same author context before returning
the structured result. The writer does not create assets, alter the parent
BeatSheet, or start a second workflow.

Keep source text, canonical names, object responsibilities, spatial relations,
speech text, and causal results at their supplied information density. A
continuity window may contain only the current Clip and its immediate
neighbours; the scope object tells you its total Clip count and the exact
parent artifact read operation for a farther frozen fact. A window is a
projection boundary, not permission to invent, summarize away, or complete a
later event.

## Contract and reference navigation

The runtime injects the current Workflow IR facts and the typed output schema.
Treat those fields as the source of truth for names, timing, allowed handles,
and the required JSON shape; do not restate or recreate a chapter schema in
the prompt. `authoring-contract-v1.json` remains the authoritative shared
authoring dimensions and review method. Read it with `Skill.resource` when the
current Clip needs its detailed method or a review dimension. Read
`user-gold-standard-2026-09.md` only when an example or quality pattern is
useful to the current facts. Domain references are likewise read on demand
when the frozen plan exposes a relevant method gap.

Knowledge and prompt-example search results are receipts. They do not contain
trusted body text until the matching read tool succeeds. Keep the full
candidate set reachable through its receipt and read operation; choose by
current information gain rather than a fixed count. Retrieval failure or no
useful evidence is a diagnostic and never a reason to stop the Clip.

Before returning, perform the writer's own factual replay: every frozen event
has a visible carrier, every speech line has one complete timed event, every
shot has a causal change and a carry state, and the final shot reaches the
frozen Clip exit. Fix the actual draft in this same chain; this replay is
authoring work, not a host quality gate.

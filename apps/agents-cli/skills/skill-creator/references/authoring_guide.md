# Skill Authoring Guide

Use this reference when drafting or substantially revising a skill. Keep `SKILL.md` focused on the operating core and use this file for deeper authoring guidance.

## What Belongs Where

Use this split aggressively:

- Put in `SKILL.md`:
  - the role
  - the main workflow
  - decision rules
  - hard boundaries
  - the review loop
- Put in `references/`:
  - style examples
  - deep background knowledge
  - long taxonomies
  - extended case libraries
  - schemas and specs
- Put in `scripts/`:
  - deterministic transforms
  - repeated scoring or packaging logic
  - data extraction or comparison utilities
- Put in `assets/`:
  - templates
  - starter files
  - previews or HTML review surfaces

## Teach Taste, Not Just Steps

If the skill is about writing, design, strategy, research judgment, or any output where quality is not mostly mechanical, the skill must teach taste.

That usually means including:

- what makes the output feel excellent instead of merely correct
- what fake-looking, generic, or overly structured output looks like
- how to detect when the work has lost "life"
- what kind of specificity, evidence, or texture raises the quality bar

Without this, style-heavy or judgment-heavy skills usually collapse into bland competence.

## Anti-Patterns To Avoid

These are common reasons skills feel weak:

- describing tasks only at a high level with no concrete operating rules
- bloating the skill with reminders that do not change behavior
- copying examples into the main skill body until the real instructions are buried
- confusing output format with quality
- specifying structure but not decision criteria
- demanding unrealistic certainty from the model instead of defining escalation points
- using many absolute commands where a well-explained heuristic would work better
- writing a universal skill that never states what it should decline or hand back to the user

When reviewing a draft, actively remove these smells.

## Skill Draft Template

Use this as a starting scaffold when the user does not already have a better structure:

```markdown
---
name: my-skill
description: What this skill does. Include strong trigger guidance, concrete contexts, and near-obvious situations where this skill should be used.
---

# Skill Title

## Mission
State who the model is, what standard it should uphold, and what kind of outcome it is trying to create.

## Success Bar
Describe what a great result looks like in user terms, not just file-format terms.

## Workflow
1. Intake and frame the task
2. Gather the minimum context required
3. Choose the right pattern or branch
4. Produce the output
5. Review and refine before returning

## Decision Rules
Explain how to choose among the main options this skill will face.

## Boundaries
State what requires user input, what must not be fabricated, and when to stop or escalate.

## Common Failure Modes
List the signs of a weak result.

## Final Review
Give a short checklist or rubric the model should run before finishing.

## References
Point to `references/...` files only when needed.
```

## Quality Gate Before You Call The Draft Done

Run this check on every serious skill draft or revision.

### Q1 Trigger Clarity

- Is it obvious when this skill should be used?
- Does the description include realistic trigger contexts, not just a category label?
- Are near-miss cases implicitly or explicitly accounted for?

### Q2 Structural Integrity

- Does the skill have a clear operating flow?
- Are decisions and branch points explained?
- Is the main `SKILL.md` readable, with supporting bulk moved elsewhere?

### Q3 Boundary Sharpness

- Does it say what not to do?
- Does it distinguish model work from human-owned judgment where needed?
- Does it prevent the most likely hallucinations or shallow shortcuts?

### Q4 Quality Depth

- Does it define what excellent output feels like?
- Does it include anti-patterns or failure modes?
- Does it include a revision or self-check loop?

### Q5 Reusability

- Will this still work on the fiftieth prompt, not just the first one?
- Did you avoid overfitting to examples?
- Are repeated deterministic tasks bundled into scripts where appropriate?

If any of these checks fail, revise before moving on to evals. Evals catch behavior. This gate catches weak design.

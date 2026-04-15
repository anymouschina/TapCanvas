# Skill Quality Bar

Use this document when you need to diagnose why a skill feels strong, weak, generic, brittle, or hard to trigger.

## The Difference Between A Valid Skill And A Strong Skill

A valid skill has the right files and some usable instructions.

A strong skill does more:

- it gives the model a role with a point of view
- it narrows ambiguity at the moments that matter
- it defines what good looks like beyond format
- it identifies what should not be done
- it creates a repeatable review loop before the model stops

If a skill only describes a workflow, it is usually incomplete.

## Seven Layers Of A Strong Skill

### 1. Identity

The skill should clarify the stance the model should take.

Examples:
- editor, not stenographer
- investigator, not guesser
- art director, not template filler
- operator, not theorist

Identity matters because it changes decisions the model makes under uncertainty.

### 2. Quality Bar

The skill should define what distinguishes excellent from merely acceptable output.

Good quality bars talk about:

- specificity
- taste
- evidence
- user value
- texture
- completeness
- restraint

Weak quality bars only talk about formatting or length.

### 3. Workflow

The model needs an execution order. Strong skills usually make intake, branching, production, and review explicit.

Signs the workflow is too weak:

- the skill reads like a pile of advice
- steps could be performed in any order
- the model is told to "do a good job" without knowing how to get there

### 4. Decision Rules

Any skill that has more than one reasonable path needs decision criteria.

Examples:

- when to ask the user for more input
- when to use one structure versus another
- when to use a script instead of manual work
- when to reject shallow source material and reframe the task

Without decision rules, outputs become inconsistent.

### 5. Boundaries

Strong skills define what remains outside the skill.

Common boundaries:

- do not fabricate first-hand experience
- do not proceed without required source files
- do not take destructive action without confirmation
- do not claim certainty where verification is required

Boundaries protect both quality and trust.

### 6. Anti-Patterns

Strong skills name the recurring failure modes that make outputs obviously worse.

Examples:

- generic openings
- empty corporate language
- fake examples
- over-structuring
- keyword-stuffed descriptions
- verbose but behaviorally weak guidance

Anti-patterns are often more actionable than broad advice.

### 7. Review Loop

The skill should include a final inspection pass before returning output.

The review loop can be:

- a checklist
- a layered rubric
- a style scan
- a deterministic validator
- a human handoff rule

If the skill never teaches the model how to catch its own weak output, quality will drift.

## Smells Of A Weak Skill

If you see several of these together, the skill probably needs redesign:

- the description is short but non-specific
- the body is long but mostly motivational
- examples do all the real work because the instructions are thin
- nothing states what should be avoided
- the skill contains many commands but few reasons
- the skill is trying to cover too many domains at once
- the evaluation plan exists, but the quality bar does not

## A Practical Rewrite Method

When upgrading a weak skill, do this in order:

1. Rewrite the description so triggering is concrete.
2. Write one paragraph defining the role and success bar.
3. Turn the body into a clear workflow.
4. Add 3-7 decision rules for the important branches.
5. Add explicit boundaries and anti-patterns.
6. Add a final review loop.
7. Move long examples and deep background into `references/`.
8. Bundle repeated deterministic work into `scripts/`.

## How To Learn From A Great Exemplar

Do not just copy its tone.

Extract:

- what it optimizes for
- what it refuses to do
- how it teaches judgment
- how it turns vague taste into concrete heuristics
- how it protects against the obvious low-quality failure modes

Then restate those structural moves in the new domain.

## Final Question

Before shipping a skill, ask:

If a capable model used only this skill and no extra handholding, would it reliably produce work that feels intentional?

If the answer is no, the skill is not ready.

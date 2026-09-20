---
name: seedance-25
description: Create, revise, compress, translate, diagnose, and production-plan prompts for Dreamina/Seedance 2.5. Use when the user mentions Seedance 2.5, Dreamina 2.5, text/image/video/audio-to-video, multimodal references, videos up to 30 seconds, multi-clip long-form production, timestamps, first/last frames, multiple keyframes, video editing, forward/backward extension, one-click video, seamless transitions, storyboard grids, blockout or clay rendering, dialogue/audio control, character consistency, or a failed Seedance 2.5 generation. Do not apply Seedance 2.0 numeric limits to 2.5 or claim current API, price, region, quota, or surface availability without live verification.
---

# Seedance 2.5 Director

Compile ideas, scripts, and multimodal assets into production-ready Seedance 2.5 prompts. Choose the task mode and reference roles first, then design visible events, continuity, camera, light, performance, and sound. Do not substitute adjective stacks for directorial decisions.

## Truth Boundary

- Treat only capabilities and values stated in official sources as officially supported. Read [capabilities-and-limits.md](references/capabilities-and-limits.md) before stating reference counts, durations, resolutions, or locked parameters.
- Treat Dreamina Web, Jimeng, CapCut, APIs, and third-party providers as separate surfaces. Recheck current official documentation before stating entry points, model IDs, prices, regions, quotas, API fields, or operation availability.
- Never carry Seedance 2.0 numeric limits into 2.5. Reuse directing, reference-role, continuity, and repair methods only after replacing every platform fact with a verified 2.5 fact.
- Never claim to have viewed, heard, measured, or verified an attachment that the active client cannot inspect. Label user descriptions as user-reported and direct observations as observed.
- The copied official guides omit embedded images and finished-video comparisons. Do not describe those example results as visually verified.

## Workflow

### 1. Build the Minimum Production Brief

Extract the following fields from information already supplied. Ask one short question only when a missing answer would materially change the result; otherwise use a conservative default and disclose the assumption.

- Goal: what the viewer should see, understand, or feel.
- Surface and task mode: text-only, multimodal reference, first-frame, first/last-frame, edit, extend, multi-clip production, one-click video, transition, storyboard, or blockout rendering.
- Duration, aspect ratio, and resolution: return configurable values as generation settings instead of prompt prose.
- Assets: what each image, video, and audio clip can actually contribute.
- Must preserve versus may change: identity, wardrobe, product structure, prop ownership, geography, camera, motion, and audio.
- Audio: dialogue language or accent, speaker, delivery, ambience, sound effects, music, or silence.
- Rights: whether likenesses, voices, brands, music, and source assets are owned, licensed, or otherwise authorized.

### 2. Select the Task Path

| User intent | Path | Primary constraint |
|---|---|---|
| Clear standalone shot | Basic generation | One primary visible event and one primary camera move |
| Image, video, or audio references | Multimodal reference | Give each asset a defined role and exclusions |
| Several events within 30 seconds | Staged generation | One primary state change and a visible end state per stage |
| More than 30 seconds | Multi-clip production plan | Split the work into independently generated clips of no more than 30 seconds |
| Modify existing footage | Video edit | Declare one master video, edit scope, and preserved content |
| Continue existing footage | Forward or backward extension | Ground the prompt in the observed boundary frame and open motion |
| Two endpoints or several states | First/last frame or keyframes | Define every anchor independently and connect them with continuous action |
| Storyboard sketch or panel grid | Storyboard reference | State reading order, shot roles, and excluded line-art traits |
| 3D gray model or blockout | Coarse or fine blockout | Decide whether it controls motion structure or complete geometry |
| Fast video from several images | One-click video | Define asset order, motion amount, edit rhythm, packaging, and sound |
| Bridge two clips | Seamless transition | Define trigger, motion continuity, arrival state, and audio transition |
| Failed or partly correct output | Diagnose and retry | Identify the root cause, then change one variable |

Read only the matching section of [task-patterns.md](references/task-patterns.md). Do not load or output every template.

### 3. Build the Reference Role Map

Complete reference binding before writing creative prose:

1. Preserve every platform-inserted reference token exactly, including language, spacing, capitalization, and numbering. Never translate, reorder, or normalize a token.
2. Assign each asset one primary role: identity, wardrobe, product geometry, environment, first frame, last frame, motion, camera, pacing, audio, or style.
3. Add exclusions, such as: “Use the choreography only; do not transfer the performer, wardrobe, room, or logo.”
4. Name and bind every important character, product, and prop individually. Avoid vague mappings such as “Images 1–4 correspond to four people respectively.”
5. Select references by scene instead of requiring every asset to appear at once.
6. When several views depict one subject, say so explicitly and lock the output count.
7. Resolve conflicts in this order: safety and rights → verified surface limits → explicit user must-haves → reference contracts → continuity → action legibility → camera logic → decorative style.

### 4. Direct Before Compiling

Choose one intention for each shot. Make action, camera, light, performance, and sound serve that intention. Compile in this order:

`Reference roles → Generation goal → Subject and primary event → Scene or stage progression → Camera → Light and visual treatment → Audio → Continuity and exclusions`

Apply these rules:

- Put the subject and primary action first. Replace empty words such as “premium,” “stunning,” and “cinematic” with observable choices.
- Give each action an initial state, trigger, change, and visible end state. For interaction-heavy shots, identify the owner of each action, prop, and endpoint.
- Default to one primary camera move. State its start, tracked subject, direction, speed change, and endpoint. Explain ambiguous terms as visible frame changes.
- Name a physical light source, direction, and effect on the subject instead of saying only “beautiful lighting.”
- Translate abstract emotion into two to four visible or audible cues: gaze, brow tension, mouth movement, breathing, hands, posture, or delivery.
- When a reference already controls motion or camera accurately, state only what to inherit. Do not restate a competing choreography.
- Keep duration, aspect ratio, and resolution outside prompt prose when they are generation-page settings. Include time only when it controls event pacing or task boundaries.
- Prefer stages for ordinary narrative. Use exact seconds only for a critical handoff, entrance, exit, transition, or beat. Keep time ranges consecutive and non-overlapping.
- Recommend prepared reference material and post-production when subtitles, formulas, logos, specifications, or frame-accurate timing must be exact.

### 5. Apply Mode-Specific Protections

- Edit: declare one source video as the sole editing master; define the object, region, time range, or audio category to change; say “change only”; list everything to preserve.
- Forward extension: describe the observed final frame and open motion before adding new content. Make the extension’s first frame directly continue the source video’s last frame.
- Backward extension: describe the preceding event, then define the source video’s first frame as the extension’s explicit final state. Prevent characters, props, or effects that belong later from appearing early.
- First/last frame: define first and last images separately; use matching aspect ratios; prevent supplemental references from overriding endpoint composition.
- Multiple keyframes: define each image’s order and key state. Require ordered arrival, not frame-by-frame reproduction.
- Blockout: let a coarse blockout control paths, blocking, camera, cuts, light changes, and rhythm; let a fine blockout control geometry, action, space, camera, and cuts before re-rendering materials, characters, environment, and style.
- Continuation: use only accepted footage or its observed boundary frame as continuity truth. Never substitute a planned endpoint for the actual generated endpoint.

### 6. Run Quality Checks

For complex prompts, multiple time ranges, edits, or extensions, run:

```bash
python3 scripts/lint_prompt.py PROMPT.txt --mode auto --duration 30
```

Read from standard input with `python3 scripts/lint_prompt.py - --mode edit`. Treat warnings as review signals, not model or platform guarantees.

Before delivery, confirm:

- Every asset has a role and exclusions; every subject has an unambiguous mapping.
- Every stage has one primary change and a visible end state.
- Character count, identity, wardrobe, prop ownership, screen direction, geography, and audio remain continuous.
- Camera does not hide the decisive action; style does not override identity or continuity.
- An edit defines the sole master, scope, target count, and preserved content.
- An extension defines boundary state, motion vector, camera phase, and audio continuity.
- One direct generation does not exceed 30 seconds; longer work is split into independently generated clips.
- Time ranges are consecutive, non-overlapping, and not overloaded.
- No unverified surface feature or value is presented as certain.

Read [quality-and-repair.md](references/quality-and-repair.md) when evaluating a returned take, choosing among keep/post/edit/re-roll/rewrite, or producing a conservative retry.

## Output Contract

Respond in the user’s requested output language while keeping all skill instructions and bundled documentation in English. Deliver:

1. `Task mode and generation settings`: mode, duration, aspect ratio, resolution, and assumptions; call out automatically locked values.
2. `Reference role map`: only when references exist; list what to use and what not to use for every asset.
3. `Final prompt`: one directly copyable code block. Preserve platform reference tokens exactly and omit internal reasoning.
4. `Risks or next step`: only one to three items that materially affect success, such as reference conflict, excessive event density, or text that belongs in post.

When the user asks for one short prompt, omit the explanation and return only the mode or essential assumption plus the final prompt. For films, campaigns, or long-form work, return the scene or stage plan before the prompt for the current generation. Do not replace a production plan with one overloaded prompt.

For diagnostics, return: `Verdict → Evidence → One changed variable → Repaired prompt`. If the primary objective succeeded and the defect belongs in post, do not default to full regeneration.

## Rights and Safety

- Do not treat uploaded material as proof of authorization. Confirm rights or rewrite to an original equivalent when a request involves a real person, voice, brand, character, song, or protected work.
- Preserve the creative function while removing unnecessary protected identity. Replace exact imitation with an original character, broad type, era, material language, action rhythm, or emotional function.
- Do not use another language, altered spelling, or euphemism to bypass platform restrictions.
- Follow higher-level safety requirements. This skill never provides moderation-evasion methods.

## Reference Routing

- Counts, durations, resolutions, modes, locked parameters, or known limitations: read [capabilities-and-limits.md](references/capabilities-and-limits.md).
- Multimodal work, 30-second or multi-clip long-form video, edits, extensions, first/last frames, keyframes, storyboards, blockouts, one-click video, transitions, audio syntax, multi-stage performance, or professional camera terminology: read the matching section of [task-patterns.md](references/task-patterns.md).
- Failed output, partial success, identity drift, camera jumps, audio-video issues, or retry budgets: read [quality-and-repair.md](references/quality-and-repair.md).

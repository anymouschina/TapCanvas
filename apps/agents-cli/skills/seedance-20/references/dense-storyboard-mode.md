# Dense Storyboard Mode

Use this reference when a request contains many panels, storyboard beats, animation boards, or multi-shot descriptions.

## Classifier

Choose `dense_multishot` only when the user wants cuts inside one generation and the verified active profile supports that structure. Choose `phased_single_take` when the action should remain continuous. Do not combine "single continuous take" with hard shot labels.

For Seedance 2.5 requests above 15 seconds or using one ordered multi-panel reference, load `seedance-25-longform-storyboard.md`. Do not inherit Seedance 2.0's 15-second ceiling or short-shot budget after the 2.5 profile is verified.

## Dense Multishot Rules

- Use shot labels.
- Give each shot one action and one endpoint.
- Keep continuity locks visible across shot boundaries.
- Size locations, large actions, dialogue turns, and character changes to the verified duration and reference budget. A 30-second profile allows more coverage, not unlimited simultaneous obligations.
- Later generation prompts remain provisional until the previous accepted clip is reviewed.

## Ordered Whole-Board Reference

An ordered multi-panel board can be one temporal/composition reference when the active Seedance 2.5 surface accepts it in a reference role. It is not automatically a literal first frame and it is not a slide deck to reproduce cell by cell.

- Declare the board's reading order.
- Bind identity, scene, prop, VFX, motion, and audio to separate reference roles when those assets exist.
- Translate panel-to-panel changes into causal motion, reaction, environment, and sound bridges.
- Keep the whole board intact unless the active execution surface cannot transport it or the user explicitly requests per-cell generation.
- Do not add mandatory outline/storyboard confirmation pauses; revise planning inside the same agent chain.

Current TapCanvas Keyframe BeatSheet v2 structurally accepts only a normal single-state image or a clip-scoped 1–3 state board. Do not relabel or bypass a larger planning board. Direct whole-board execution requires a future explicit schema/transport change; until then this section is prompt/workflow knowledge, not proof that TapCanvas submitted the asset.

## Continuous Take Rules

Use Beginning / Then / Finally. Do not use shot labels or hard cuts. Describe phases of one camera path, one geography, and one physical action chain.

## 2D Animation

For 2D, anime, or cel work, use animation-layout vocabulary: layers, parallax, holds, smear frames, impact frames, cel shadow, line boil, background pan, and compositing. Avoid photographic sensor, lens, bokeh, ISO, and shallow-focus language unless the user explicitly wants a hybrid simulated-camera style.

## Endpoint Discipline

Every dense storyboard beat must leave a visible state that the next beat can consume. A non-final action-out may remain in motion, but its position, direction, ownership, damage, light, and sound residue must be explicit; an invisible endpoint cannot be inherited safely.

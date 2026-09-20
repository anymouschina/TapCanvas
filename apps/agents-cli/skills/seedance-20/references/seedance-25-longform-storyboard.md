# Seedance 2.5 — 30-Second Storyboard Profile

last_verified: 2026-08-03

Use this profile when the active model or surface is explicitly verified as Seedance 2.5, or when the user asks for a conditional Seedance 2.5 prompt/workflow. It extends the general Seedance 2.x craft rules; it does not replace surface contracts, reference limits, safety rules, or the current executor schema.

This file is the distilled runtime knowledge source. The offline corpus used to derive it lives under a repository `assets/` directory and must not be loaded into an agent prompt at runtime. Do not ask a runtime agent to reopen those templates, images, or videos; use the evidence-ranked rules below.

## Evidence Ladder

### Confirmed public model facts

ByteDance's public Seedance 2.5 page states that the model is built for 30-second storytelling, can create up to 30 seconds in one generation, can be extended twice, and improves reference understanding and editing. It also names white-model control and green-screen editing as professional-production capabilities. The page presents a multi-panel storyboard example controlling overall shot structure, shot scale, and camera rhythm; that is a product example, not a published API transport schema, panel-count guarantee, or proof that every surface accepts the same board input.

Source: https://seed.bytedance.com/en/seedance2_5, verified 2026-08-03.

### Current TapCanvas ARK profile — internal contract and volatile

The repository's current ARK registration maps public key `doubao-seedance-2.5` to upstream `doubao-seedance-2-5-260628`. The checked-in model contract exposes 4–30 second duration choices, 480p/720p, multimodal references, first/last frame, editing, extension, timestamp prompting, native audio, and per-surface reference limits.

This is a current implementation fact, not a universal Seedance 2.5 promise. Before execution, consume the live structured model catalog and generation contract. Do not infer the profile from the user's wording or silently substitute 2.5 when another model is selected.

Repository evidence: `apps/new-api/patches/2026-07-31/005-add-seedance-2-5.sql` and the dynamic model-catalog tests.

### Local paired observations — n=1 per workflow shape

The source corpus was fully inventoried. Complete video streams were inspected, visuals were reviewed through sampled contact sheets and scene changes, and the paired prompts/references were read; dialogue audio was not transcribed and no frame-by-frame semantic score was performed. The two pairs represent different workflow shapes:

- a three-character dramatic scene generated as a 30.08-second, multi-cut clip with native audio present;
- a 4×4 black-and-white combat storyboard used as one ordered reference for a single 30.08-second, multi-cut result, while separate role and scene descriptions preserved the intended cast and environment.

The dramatic workflow has one paired observation, and the intact whole-board workflow has one paired observation. Label direct claims from either case `single-observation`, not `field-observed`: n=1 can justify a testable method, never a reliability estimate or universal transport claim. Dialogue audio was not transcribed, exact lip-sync was not measured, and frame-by-frame compliance was not scored. Rules synthesized from these cases remain `internal-guidance` unless separately supported by a public model fact or current execution contract.

The single-image combat template had no paired finished output in the corpus. Its useful mechanics are hypotheses supported by general I2V practice, not validation of its hard quotas, default enemies, styles, or timing claims.

### Offline evidence identity — provenance only

These hashes make the distilled observations auditable without turning the source assets into runtime knowledge inputs:

- dramatic reference image: `sha256:31f6953d2579312cd1dd8905f6880f02c832b3c7d0b1feea37bf26e312cfd48f`;
- dramatic final prompt: `sha256:c70a8f65b8170a57c79b253b321559bd2d75f2152c573d4f189afc9772c73d30`;
- dramatic output: `sha256:f68bccef5fa29a966814ec35f40f7323f8083a02125cc26c3adac290a5ebc5eb`;
- combat 4×4 board: `sha256:5e222ed5716eda2cca4ce30e12eb84738c4b6b0c02cb45458237eca344124575`;
- combat final prompt: `sha256:5b5aab947481dcc221b84d9e6281d7f2e55ff3739073265e3f49907db35cff6c`;
- combat output: `sha256:a7f8d2dc1cf4e82c8439b5bb9743e3fc4dd19826c594c27ceb38c3f19a170487`;
- dramatic, multi-board action, and single-image action templates: `sha256:b5e1534552a3c5429b19e83de9c534d863ad7cdbf2ded260d60c30facf9404bc`, `sha256:3e530263a4bd47be2d8aa7059bef519b8dc6435f045f6397d385937b04fc96a3`, and `sha256:2d1172556b0fec64d010818335f3840292b8da258d41c09fe0e35fecd052a95c`.

Operating-system metadata files were excluded from the content corpus.

## Activation Contract

For an executable request, activate this profile only from structured facts such as the exact selected model identity, its duration options, supported reference modes, and real asset limits. User prose may request Seedance 2.5, but it is not execution evidence by itself.

If the active surface is unknown, write a conditional production plan and state what must be verified. Do not default to a 2.0 route, silently split into 15-second calls, or claim that a 30-second submission is ready.

A coherent 16–30 second scene may remain one generation when all of the following are true in the agent's directing judgment:

- the active profile exposes the requested duration;
- the references and prompt fit its actual input contract;
- one continuous dramatic objective can organize the full duration;
- the user wants a single generated piece rather than separately editable clips.

Use a sequence when the story, locations, time jumps, editability requirement, asset limits, accepted-take continuity, or active surface truly requires multiple generations. Density alone is not an automatic split signal on a verified 30-second profile.

## Reference Roles

Assign one primary job to every asset and state what must not transfer.

| Reference | Primary job | Must not silently become |
|---|---|---|
| Ordered multi-panel storyboard | temporal order, shot scale, blocking milestones, action endpoints, transition intent | literal first frame, identity master, or a set of unrelated slides |
| Character image | identity, wardrobe, silhouette, authorized likeness | source pose, source background, or storyboard timing |
| Scene image | geography, architecture, light direction, palette | cast identity or a fixed camera for every shot |
| Prop/VFX image | geometry, material, ownership, effect morphology | a new character, weapon class, or unrelated environment |
| Video reference | only the declared motion, camera, timing, or accepted-state role | unauthorized identity, wardrobe, scene, or audio transfer |
| Audio reference | only the declared rhythm, ambience, music phase, or authorized voice role | a replacement for visible action timing or speaker assignment |

An ordered board belongs in a reference/storyboard role. Do not send it through a provider field that treats the image as the literal first frame unless the first panel truly is the intended full-frame opening and the surface documents that behavior.

## Whole-Board Compilation

When the active surface accepts an ordered storyboard as one reference, keep the board intact by default. Splitting or cropping every cell into separate generations is a different workflow and requires a real execution reason or an explicit user request.

Compile in this order:

1. **Global lock once:** authorized identities, scene, props, aspect ratio, overall light/weather, audio policy, and non-transfer boundaries.
2. **Reading order:** state the board's exact row/column order or explicit panel labels. Never assume a nonstandard layout.
3. **Role map:** bind each named role, scene, prop, and effect to its own reference responsibility.
4. **Temporal skeleton:** describe the ordered functional shots or phases. Timestamps are planning hints when the active profile supports them, not frame-accurate guarantees.
5. **Causal bridges:** make panel N's velocity, force, gaze, prop state, environmental change, or sound cue cause the entry into panel N+1. Do not narrate “now panel two” or hold on every cell.
6. **Shot execution:** for each functional shot, state visible action, camera purpose, reaction/consequence, and sound. Static look already carried by references is not repeated per shot.
7. **Exit state:** preserve the final positions, ownership, injuries, open motion, environment damage, light, and sound residue needed by the next edit or generation.

The board is a temporal plan, not a demand that the output reproduce every drawing literally or use exactly the same number of cuts. The local combat example used sixteen panels and a roughly sixteen-part timeline; that is evidence for one working shape, not a quota.

## 30-Second Dramatic Coverage

For dialogue and emotional scenes, organize the duration around causal coverage rather than an emotion-word library:

- establish geography and relationships before close coverage makes them ambiguous;
- keep a complete utterance in one shot when the assigned duration and speaking-rate contract can carry it and the performance benefits from continuity;
- when the active surface provides no speaking-rate contract, keep dialogue capacity conditional: explicitly identify the shot duration, available speaking rate, intended pauses or breaths, and performance/editorial purpose as facts still requiring verification. Do not infer capacity from Chinese character count or promise complete lip-sync;
- split an utterance only for real capacity, reaction coverage, or a motivated editorial purpose, then preserve the text exactly across shots;
- keep the current speaker visibly assigned and lip-synced; listeners remain closed-mouth unless they actually speak;
- use over-the-shoulder/reverse coverage without breaking the 180-degree axis, and give listeners visible reactions rather than turning them into background figures;
- express emotional change through gaze, breath, posture, distance, hand hesitation, prop contact, and silence; do not paste a generic facial-muscle catalogue into every shot;
- give one important prop an explicit state path: owner, location, contact, transfer, orientation/open state, and final position.

The reviewed dramatic prompt contained a missing shot number yet still produced a coherent result. That proves only that the model can sometimes survive prompt defects; it does not make numbering gaps an accepted authoring rule.

## Whole-Board Action Guidance — official example + local n=1 + internal guidance

The official 2.5 product page demonstrates multi-panel storyboard control, and the local combat pair observes one coherent 30.08-second result from one intact 4×4 board. That combination supports testing the following compiler choices; it does not establish reliability, exact panel adherence, or universal board transport:

- connect cuts on the same action vector, screen direction, momentum, and follow-through;
- move through real geography instead of returning to the opening “home” position after every exchange;
- make impact readable as approach/contact → defender response → attacker reaction → material or environmental aftermath;
- preserve accumulated damage, wetness, debris, displaced props, and sound residue across later shots;
- use VFX, shake, and flash as consequences or accents, never as substitutes for missing body mechanics.

## Single-Image Action Hypotheses — template-only plus general I2V guidance

The offline single-image action template had no paired output. Keep these points as hypotheses to test, not Seedance 2.5 facts:

- when the active workflow treats an image as a literal first frame, begin from its actual pose, contacts, held objects, and momentum rather than resetting to a neutral stance;
- keep incidental held objects classified as props unless the story makes them weapons or tools; if a prop leaves frame or changes owner, show the release path, landing, or transfer;
- contrast low-amplitude preparation with decisive motion, and express force through body mechanics before adding effects.

Use the existing combat/action references for detailed choreography. This profile adds the 30-second and whole-board carrier rules; it is not a second combat system.

## Rules Not Promoted From the Offline Templates

Do not turn any of these into runtime gates or defaults:

- mandatory user confirmation after an outline or storyboard;
- fixed 16/20/25/50-shot or action-node quotas;
- minimum prompt-character requirements or visible quality scores;
- universal 0.5-second cut limits or a fixed 15/25/28-second duration copied from a template;
- default enemy tiers, invented powers, or compulsory environment destruction;
- named studios, franchises, characters, songs, or copyrighted style imitation;
- exact timestamp compliance, exact lip-sync, or exact cut-count promises based on one successful sample.

If a first draft is weak, revise it inside the same agent execution chain. Do not convert these craft checks into a user-visible block, a Hono/Web semantic gate, or a request for the user to retry.

## Current TapCanvas Execution Boundary

TapCanvas Keyframe BeatSheet v2 currently accepts a normal single-state image or a clip-scoped 1–3 state storyboard as a video reference and structurally rejects larger planning boards. This profile does not authorize bypassing that contract, renaming a 4×4 board to evade validation, or silently decomposing it.

The 4×4 whole-board method is therefore available as Seedance 2.5 prompt/workflow knowledge, but direct TapCanvas execution needs an explicit future schema and transport change before agents may claim that the board was submitted. Until that contract exists, report the capability gap honestly and preserve the user's board unchanged.

## Same-Chain Self-Check

Before delivery, verify:

- the active profile evidence and requested duration are real;
- every reference has one primary role and a non-transfer boundary;
- the board reading order is explicit;
- each functional shot changes action, information, relationship, or state;
- transitions consume prior momentum, gaze, prop, environment, or sound state;
- dialogue fits its shot-level pace and speaker assignment;
- timestamps and panel counts are expressed as plans, not guarantees;
- no template quota, mandatory approval gate, copyrighted default, or silent model fallback was introduced.

This is an internal revision checklist, not a completion gate.

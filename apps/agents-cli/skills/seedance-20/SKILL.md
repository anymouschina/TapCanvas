---
name: seedance-20
description: "This skill should be used when creating, improving, or troubleshooting Seedance 2.x video across Dreamina, Jimeng, CapCut, Doubao, Volcengine/Ark, BytePlus, Runway's Seedance route, fal, or third-party provider/router surfaces. It covers Seedance 2.0 and the verified public Seedance 2.5 30-second profile, but treats 2.5 as executable only where the selected structured surface explicitly exposes it. Use for text/image/video/reference-to-video prompts, ordered storyboard references, first/last frame, dialogue, lip-sync and audio, IP-safe rewrites, API, pricing and model-ID questions, and zh/ja/ko/es/ru prompt work. Not for non-Seedance models (Sora, Veo, Kling, Runway's own Gen models) or image-only prompting."
license: MIT
user-invocable: true
tags: [seedance]
metadata:
  version: "6.7.0"
---

# seedance-20

Seedance 2.x operating loop for agent-directed video work. Use this root skill to select a verified model/surface profile, check facts, protect references, and keep prompts proportional to the requested duration before loading specialized sub-skills.

## Soul

This skill exists so that a person who arrives with a feeling leaves with a film. Three principles govern everything below:

1. **Hear the intent behind the words.** Users describe outcomes ("make it feel like home"), not parameters. Every gate and sub-skill translates feeling into craft; none of them may hand the translation work back to the user.
2. **Keep the story alive.** Hold a story state across the conversation: subject, mode, look, references, decided constraints, and what failed before. Every skill reads it before asking anything and updates it after acting. A user should never have to repeat a decision, and a new request inherits the world already built.
3. **Evolve with the user.** Speak plainly to a beginner and in director language to a professional - and notice when the same user grows from one into the other across a project. The register adapts; the standards never do.

## Fast Lane

Most requests are one short clip from someone who just wants to see their idea. Do not run the full gate loop on them. Take the fast path when the request is a single standalone clip, from a non-expert, with no IP/likeness/brand/real-person or safety flag and no platform-fact question (API, pricing, model ID, limits, region):

1. Go straight to `[skill:seedance-interview-short]` - or write the brief immediately if the idea is already clear - then `[skill:seedance-prompt-short]`.
2. Apply craft inline from memory: one visible beat, one motivated camera move, one motivated light source, sound intent, and the directing coherence rule (name one intention; make camera, light, and performance serve it). Load `[ref:directing-engine]`, `[ref:capability-map]`, `[ref:allocation-model]`, and the source or professional gates only when something actually invokes them.
3. Treat it as one clip: do not ask sequence or continuation questions yet. Raise "should this be a series, part two, or longer" only after the first draft, or when the user says continue, extend, next part, or longer.
4. Keep the single-clip prompt compact (about 40-110 words) unless the active surface is a verified stricter API, and keep director language (blocking, directorial voice, shot contracts) inside the internal brief - speak to the user in plain words.

An explicitly named or selected Seedance 2.5 request always loads `[ref:seedance-25-longform-storyboard]` for its profile and evidence boundaries; a user label activates conditional planning, while execution still requires structured surface facts. Loading the profile alone does not leave the fast lane. Leave the fast lane when a 2.5 request exceeds 15 seconds, uses an ordered multi-panel board, requests editing/extension, or otherwise needs long-form planning. Also leave for IP/likeness/brand/safety risk (step 9), a platform-fact question, a film/client/delivery request, or a connected multi-generation story/continuation. When in doubt about safety, leave the fast lane. The Operating Loop below is the full procedure - the fast lane is the default for the common case, and every gate it skips stays one signal away.

## Model Profile Rule

Duration, reference modes, limits, and prompt grammar come from the active structured model/surface contract, not from a local keyword, a generic “Seedance” label, or a remembered family default.

- For verified Seedance 2.0 work, use the existing 4–15 second and surface-specific rules.
- For verified Seedance 2.5 work, load `[ref:seedance-25-longform-storyboard]` before deciding whether 16–30 seconds or an ordered whole-board reference belongs in one generation.
- When the selected model or surface is unknown, keep execution claims conditional and identify the facts that must be checked. Never silently choose 2.0, 2.5, Fast, Mini, another provider, or a shorter-duration fallback.

## Surface Reference Token Rule

Literal tags such as `@Image1`, `@Image2`, `@Video1`, `@Audio1`, `@图片1`, `@视频1`, and `@音频1` anywhere in descendant skills or references are versioned Seedance 2.0 surface examples, not Seedance-family defaults. Emit a reference token only when the user supplied that exact tag or the active structured surface contract exposes it. For Seedance 2.5 without an explicit token mapping, use the structured reference fields for execution or neutral asset-role names in a conditional prompt plan; never invent prompt tags, counts, or field mappings from an example.

## Operating Loop

1. Intake: identify the user's goal, production phase, target surface, mode, duration, aspect ratio, references, audio needs, deliverables, and safety/IP risks. If intake surfaces a clear safety, IP, likeness, or evasion risk, jump straight to the safety gate (step 9) before any planning.
2. Source gate: before platform claims, load `[ref:api-status]` and `[ref:source-registry]`. For Runway, Volcengine, fal, provider/router, or China-facing surface specifics, also load `[ref:platform-surface-matrix]`.
3. Professional gate: if the user asks for film, ad, campaign, client, delivery, localization, color, sound, subtitle, post, QC, or multi-shot work, load `[ref:pro-filmmaking-standards]` before drafting.
4. Sequence Gate: classify the request as `standalone_clip` or `sequence_project` before the Mode Gate. Use `sequence_project` for connected clips, continuation/extend/next-part requests, campaigns, separately editable deliverables, or any idea whose beats cannot clearly fit inside one verified active-surface generation. Dense action or dialogue is not by itself a split trigger on a verified Seedance 2.5 30-second profile; use the active duration/reference contract and the agent's directing judgment. For sequence work, load `[skill:seedance-sequence]`, `[ref:sequence-project-state]`, `[ref:continuation-handoff]`, and `[ref:prompt-compiler]`; for continuation, repair-tail, or re-anchor requests, also load `[skill:seedance-continuation]`.
5. Mode gate: choose T2V, I2V, V2V, R2V, FLF2V, edit, native extend when verified for that surface, or troubleshoot before writing prose.

   Mode availability is surface-specific: edit and extend exist on Dreamina and Ark routes; fal has no dedicated extend endpoint - to continue a clip on fal, prefer reference-to-video with the previous clip as a video reference (keeps motion and audio context). Chaining image-to-video from its last frame is an explicit alternative only when the active surface supports it and the continuity trade-off has been stated; never switch paths silently. Provider/router surfaces can rename the same job type, hide fields, or expose only selected modes; recheck their current docs before implementation.

6. Capability check: when planning any shot, mode, or budget, load `[ref:capability-map]` to design into model strengths and around known limits, and `[ref:allocation-model]` to decide where the prompt spends its fidelity budget before drafting.
7. Reference map: assign every asset one primary role: identity, first frame, last frame, product, environment, motion, camera, timing, audio, or style. State what must not transfer.
8. Multilingual gate: if the prompt uses Chinese, Russian, Japanese, Korean, Spanish, or code-mixed wording, load `[ref:multilingual-community-examples]` and preserve reference tags exactly. For native Chinese, Japanese, or Korean example-driven requests, route to `[skill:seedance-examples-zh]`, `[skill:seedance-examples-ja]`, or `[skill:seedance-examples-ko]`.
9. Safety gate: route IP, likeness, voice, brand, real-person, graphic, or evasion-like wording through `[skill:seedance-copyright]` or `[skill:seedance-filter]`.
10. Direction: before drafting any scene, name one intention and make camera, lens, light, blocking, performance, and sound serve it instead of picking a "cinematic look" - apply this coherence rule inline. Load `[ref:directing-engine]` only when scenes need distinct treatment, one directorial voice must hold across many clips, or the right setup is genuinely unclear.
11. Prompt build: route to `[skill:seedance-interview]`, `[skill:seedance-prompt]`, `[skill:seedance-prompt-short]`, `[skill:seedance-sequence]`, `[skill:seedance-continuation]`, or a domain skill for camera, motion, lighting, audio, characters, VFX, style, recipes, or pipeline.
12. Quality pass: run anti-slop and the directing coherence test, then check that every functional shot has a distinct visible job and motivated camera purpose sized to the verified profile. Also check physically motivated light, sound intent, continuity anchors, constraints, delivery caveats, and source-date caveats. A short single-beat clip may have one move; a verified 30-second multi-shot scene is not compressed to that short-clip shape.
13. Repair loop: when a take returns, triage it with `[ref:retake-protocol]` (keep / fix in post / edit / re-roll / rewrite, one variable per retake, inside an attempt budget); if it fails outright, diagnose root cause before adding adjectives via `[skill:seedance-troubleshoot]`.

## Sequence Gate

For a sequence project, do not write Clip 01 until these are known: story objective, final story outcome, ordered major beats grouped into scenes, active surface or conservative surface assumption, clip budget, current clip narrative job and felt intent, and current clip completed endpoint.

Do not write a continuation prompt until the previous accepted clip or its actual final frame has been reviewed and its observed end state recorded.

Sequence invariants:

- every sequence prompt has `project_id` and `clip_id` lineage;
- accepted observed state overrides planned state;
- rejected footage is excluded from canon and cannot become a continuation source;
- future prompts remain provisional until the preceding accepted take is reviewed;
- exact reference tags survive every clip unchanged;
- seamless continuation stays inside a scene; a scene boundary opens from canonical references and resets `extension_depth`;
- completed beats cannot replay and reserved future beats cannot leak early;
- continuity state must be updated after each accepted take;
- final Seedance prompts remain natural language unless the user explicitly asks for structured output.

## Load Map

| Situation | Load |
|---|---|
| Seedance 2.5, a requested 16–30 second single generation, an ordered whole-board reference, or 2.5 editing/extension guidance | `[ref:seedance-25-longform-storyboard]`, then the relevant prompt/camera/motion/audio references |
| Vague idea or missing brief | `[skill:seedance-interview]` or `[skill:seedance-interview-short]` |
| Connected clips, campaign sequence, separately editable deliverables, or a prompt that exceeds the verified active generation | `[skill:seedance-sequence]`, `[ref:sequence-project-state]`, `[ref:prompt-compiler]` |
| Continue, extend, next part, repair tail, bridge known states, or re-anchor drift from accepted footage | `[skill:seedance-continuation]`, `[ref:continuation-handoff]`, `[ref:continuity-qc]` |
| Review a generated take and update canon before the next prompt | `[ref:retake-protocol]`, `[ref:sequence-project-state]`, `[ref:continuation-handoff]` |
| First multi-clip project, or how the sequence loop actually runs end to end | `[ref:sequence-worked-trace]` |
| Dense animation storyboard or multi-shot prompt | `[ref:dense-storyboard-mode]`, `[ref:multishot-grammar]`, and `[ref:seedance-25-longform-storyboard]` when the verified profile is 2.5; add `[ref:2d-anime-grammar]` for 2D/cel work |
| Production prompt | `[skill:seedance-prompt]`, `[ref:quick-ref]`, `[ref:prompt-examples]` |
| Planning any shot, mode, or budget | `[ref:capability-map]` |
| Where the prompt spends fidelity: identity vs motion vs scene density | `[ref:allocation-model]`, `[ref:intent-vs-precision]` |
| Multi-shot prompt, cuts inside one clip, or shots-per-duration budget | `[ref:multishot-grammar]` |
| 2D, anime, or cel-style motion | `[ref:2d-anime-grammar]`, `[skill:seedance-style]` |
| Professional film, commercial, campaign, or delivery workflow | `[ref:pro-filmmaking-standards]`, `[ref:shot-list-continuity]`, `[ref:delivery-qc]` |
| Compact prompt or Chinese compression | `[skill:seedance-prompt-short]`, language vocab reference |
| Choosing the right camera, light, blocking, performance, and voice for a scene, keeping every choice motivated, or holding one directorial style across a long story | `[ref:directing-engine]` |
| Camera, lens, blocking, shot contract | `[skill:seedance-camera]`, `[ref:cinematography-shot-language]` |
| Image reference / first frame | `[ref:i2v-guide]`, `[ref:reference-workflow]`; for 2.5 also load `[ref:seedance-25-longform-storyboard]`, and take tag syntax, reference counts, and request fields only from the active structured surface contract |
| First and last frame | `[ref:first-last-frame-guide]` |
| API, Runway, Volcengine, fal, provider/router surfaces, China-facing surfaces, workflow, pricing, model IDs | `[skill:seedance-pipeline]`, `[ref:api-workflow]`, `[ref:model-name-map]` |
| Color, ACES, HDR/SDR, aspect ratio, subtitles, audio post, or QC | `[ref:color-pipeline-aces]`, `[ref:aspect-ratio-delivery]`, `[ref:subtitles-localization]`, `[ref:audio-post-delivery]`, `[ref:delivery-qc]` |
| Genre template, examples, or a worked directing example in a specific genre | `[skill:seedance-recipes]`, `[ref:examples-by-mode]`, `[ref:genre-guides]`, `[ref:directing-engine-genre-library]` |
| Chinese examples or safe Chinese rewrites | `[skill:seedance-examples-zh]`, `[skill:seedance-vocab-zh]`, `[ref:vocab/zh]` |
| Japanese examples or safe Japanese rewrites | `[skill:seedance-examples-ja]`, `[skill:seedance-vocab-ja]`, `[ref:vocab/ja]` |
| Korean examples or safe Korean rewrites | `[skill:seedance-examples-ko]`, `[skill:seedance-vocab-ko]`, `[ref:vocab/ko]` |
| Russian/Spanish or mixed-language examples | `[skill:seedance-vocab-ru]`, `[skill:seedance-vocab-es]`, `[ref:multilingual-community-examples]` |
| Slop-heavy or filter-tripping English wording | `[skill:seedance-vocab-en]`, `[skill:seedance-antislop]` |
| Bad result | `[skill:seedance-troubleshoot]` |
| A take came back: keep, fix in post, edit, re-roll, or rewrite | `[ref:retake-protocol]` |
| Why a rule works, or a novel case no rule covers | `[ref:model-mechanics]` |

Preserve reference tags exactly, keep prompts proportional to the verified duration and active surface contract, and never convert field-observed community tricks into official platform guarantees. For professional filmmaker requests, deliver the workflow object the role needs: shot list, shot contract, continuity ledger, prompt, post handoff, localization plan, or QC checklist.

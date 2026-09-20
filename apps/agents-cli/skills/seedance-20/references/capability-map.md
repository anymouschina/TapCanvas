# Capability Map — Seedance 2.x profiles

*What the verified Seedance 2.x profile is best at, how to extract each strength, and what to design around. Load before prompt planning. Labels: [official] = ByteDance or active provider docs · [internal-contract] = current structured TapCanvas surface contract · [single] = one paired observation for this exact workflow · [field] = repeated output/practitioner evidence · [heuristic] = default to test. Last verified 2026-08-03. The mechanics behind these rows live in `model-mechanics.md`.*

## Select the profile before planning

| Profile | Public capability frame | Planning consequence |
|---|---|---|
| Seedance 2.0 | Official launch material describes 4–15 second audio-video generation, multi-shot output, and mixed text/image/video/audio references. | Keep the existing short-clip budget and verify the active surface before using first/last frame, edit, extend, resolution, or provider fields. |
| Seedance 2.5 | ByteDance's public page describes up to 30 seconds in one generation, two extensions, stronger reference understanding, editing, white-model control, and green-screen editing. | Load `seedance-25-longform-storyboard.md`; do not auto-split a coherent 16–30 second request merely because 2.0 capped at 15 seconds. |

The exact model identity and live duration/reference options are execution facts. Never infer the profile from prompt wording, duration alone, or a generic “Seedance 2” label.

## Design INTO these

| Capability | Extraction move |
|---|---|
| Multi-shot in one call [official/field] | Use a surface-appropriate shot/timeline skeleton · one functional change and camera purpose per shot · size density to the verified duration rather than a universal cut quota |
| 30-second storytelling [official, 2.5] | Keep one coherent dramatic objective across the full generation; use 16–30 seconds only when the active contract exposes it |
| Multi-panel / ordered whole-board reference [official 2.5 product example + single local output, n=1] | Assign the board only temporal/composition duties; state reading order and causal transitions; keep identity, scene, prop, and audio roles separate. The official example supports broad storyboard control, while the local pair supports testing one intact 4×4 workflow; neither establishes a universal transport schema, exact reading-order behavior, or repeated reliability. |
| Native synced audio [official] | name specific sounds; dialogue as a natural quoted line on-screen; short lines; clean front face ref; SFX>music>dialogue — test dialogue first |
| Role-separated references [official] | per-asset role **+ exclusion** ("motion only, no appearance") |
| Motion transfer via a video reference [official 2.0/field; surface-specific] | Use a donor clip for choreography/camera rhythm plus a separate identity image only when the active reference schema exposes those roles; preserve its exact supplied tokens instead of assuming `@Video`/`@Image` syntax. |
| Audio-as-clock [field; surface-specific] | Bind timing to an audio reference only when the active surface exposes that role; do not assume an `@Audio1` token on 2.5. |
| First/last frame [official 2.0; internal-contract on current TapCanvas 2.5] | Lock endpoints and prompt initiate→travel→resolve only when the selected surface exposes distinct first/last-frame roles; do not infer FLF fields from the family name. |
| Literal camera verbs [official] | one motivated move per shot |
| Physics [official claim] | physical verbs & consequences, not pose adjectives |
| Slow motion [official 2.0; tier is surface-specific] | Use it on one key action. Select a named Standard/Fast tier only when the active surface contract exposes that tier; do not inherit a 2.0 provider tier name into 2.5. |
| Transformation [field] | endpoint states + the persisting carrier; hard cases → FLF decomposition |
| 2D/anime [field] | medium grammar: cel over painted bg, sakuga vs held frames, impact frames/speed lines/smears; no lens/DOF talk — full grammar in `[ref:2d-anime-grammar]` |
| Aspect and automatic duration [official 2.0; surface-specific] | Use only ratios and automatic-duration controls exposed by the active surface. Neither `21:9` nor `auto` is a family-wide 2.5 request default. |
| Multilingual [official/field] | zh anchors for texture/mood; keep reference tags exact |

## Design AROUND these

For connected generations, design around continuity drift by keeping each generation scoped to one coherent objective, recording accepted observed state, preserving exact reference roles, and re-anchoring on schedule at the scene's chain-depth cap instead of waiting for visible drift. “Small” is profile-relative: a verified 2.5 surface may carry a coherent 30-second scene, while a 2.0 surface may require multiple calls. This is workflow guidance, not a deterministic platform guarantee.

Surface duration caps are active-surface facts, not universal Seedance facts; audio is not continuous across separate calls, so score in post when needed [official] · on-screen text → post [official] · negation summons — exclude compositionally [field] · tiny detail (distant faces, hands, logos) degrades [field] · facial micro-acting weakest — stage emotion in body/staging, ration CUs [heuristic] · visible drift after repeated chained generations — re-anchor original refs [field] · character↔prop physics fragile in multi-person shots — keep contact simple or off-screen, use the three-tier action hierarchy [field] · Fast tier behavior is surface-specific [field] · seed = stabilizer, not lock [official].

## Competitive Context *(2026-06-14)*

Native audio is no longer a Seedance-unique differentiator — as of mid-2026 Veo 3.1, Sora 2, Kling 3.0, Runway Gen-4.5, Hailuo 2.3, and Vidu Q3 all ship it [tech-press]. Lead with what is still distinctive in combination — single-pass multimodal references (text+image+video+audio together), multi-shot from one prompt, and multilingual lip-sync — rather than selling native audio as a headline. Public 480p/720p native-resolution evidence applies to Seedance 2.0; the current TapCanvas Seedance 2.5 ARK profile also exposes 480p/720p as an `internal-contract` fact. Neither statement establishes a family-wide resolution default, and 1080p remains surface-specific (see `api-status.md`).

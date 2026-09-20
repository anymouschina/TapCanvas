# Multi-Shot Grammar — real cuts inside one generation

*Seedance 2.x can create genuine editorial cuts inside one generation. The available duration and useful shot density are profile- and surface-specific. Labels: [official] = ByteDance/provider docs · [internal-contract] = current structured TapCanvas surface contract · [single] = one paired observation for the exact workflow · [field] = repeated output/practitioner evidence. Last verified 2026-08-03.*

## The grammar [official]
Label every cut explicitly — `Shot 1:` / `Shot 2:` / `Shot 3:` — in plain prose. The labels are what give the model cut points; long unlabeled prompts tend to render as one continuous take. Per shot: **one primary action + one camera move**, plus its sound. Order inside each shot: subject + action → camera → sound.

## The budget

Shots cost seconds, but there is no universal shot quota. Give each functional shot enough time for its visible action, reaction, dialogue, and endpoint; a requested cut that has no distinct job only consumes attention.

| Verified profile | Duration frame | Planning use |
|---|---|---|
| Seedance 2.0 [official] | 4–15 seconds on the official model line; exact surface choices vary | The established 2–3 functional-shot shape remains a reliable starting point for 10–15 seconds. |
| Seedance 2.5 [official/internal-contract] | ByteDance states up to 30 seconds in one generation; TapCanvas's current ARK profile exposes 4–30 seconds | A coherent scene can carry substantially more coverage. Allocate by causal function and speaking/action capacity instead of copying a fixed 16/20-shot template. |

Use `duration: auto` only when the active surface actually exposes it. When the edit or TapCanvas generation contract gives an exact duration, honor that value.

## Requirements [official + field]
- **Non-fast tier [field, 2.0 provider-specific].** Official fal docs give its fast endpoints the same schema and multi-shot support, but field reports say those fast tiers do not reliably honor multi-shot (or slow-motion or dolly moves) on the first try. This is fal/2.0 guidance, not a `Standard` field or tier to send to Seedance 2.5 unless the active surface exposes it.
- **Profile-aware duration.** Short multi-shot requests can starve their beats; a verified 2.5 profile can extend the available canvas to 30 seconds. Never assume 2.0, 2.5, `auto`, or a Fast tier without active-surface evidence.

## Timestamps: secondary on Western surfaces, primary on Chinese surfaces [official + field]
Prefer `Shot N:` labels as the structure — clear and portable across surfaces. fal's reference-to-video docs additionally accept timestamp pacing phrases ("At 5 seconds…", "Cut scene to…"); use them sparingly as *hints inside* a labeled shot, never as bracketed `[0-6s]` blocks replacing the labels.

Surface exception [field]: on Dreamina/Jimeng, Chinese practice structures longer prompts with a bracketed timeline as the primary skeleton — `【时间轴】0-3s: … / 3-6s: … / 6-10s: …` — each segment carrying its own 画面/镜头/音效 (frame, camera, sound). A reviewed Seedance 2.5 field sample also used a detailed timeline across one 30-second generation. Match the convention of the active surface; timestamps are planning guidance rather than frame-accurate guarantees, and one prompt should not carry two competing skeletons.

## Seedance 2.5 whole-board carrier [official duration + single observation, n=1]

When a verified Seedance 2.5 surface accepts an ordered multi-panel board as a reference, the board can carry shot order, scale, blocking milestones, and action endpoints for the whole generation. Text should state the reading order, bind other references by role, and explain the causal motion between panels. Do not crop every panel or turn it into a separate generation by default, and do not describe the board as a literal first frame unless the provider field really has that role.

Load `seedance-25-longform-storyboard.md` for the evidence boundary, prompt compilation order, dialogue rules, and current TapCanvas execution limitation.

## Dialogue & audio placement [official + field]
A spoken line goes inside the shot where the speaker is on-screen, written naturally in quotes. Keep a complete utterance in one shot when its assigned duration and speaking-rate contract can carry it; split only for real capacity, reaction coverage, or a motivated edit, then preserve the text exactly. Name each shot's specific sounds — they anchor the audio pass. Audio is generated per call, not across calls: multi-block pieces get their unifying score in post.

## The single-take alternative [official]
For an unbroken take, say so: "single continuous take, no cuts" — otherwise a long action description may get cut up.

## Worked shapes
*Three-shot commercial (≈15s):* Shot 1: extreme close-up of condensation sliding down a glass bottle, ice clinking. Shot 2: the bottle rises from crushed ice, camera tilting up into a backlit halo. Shot 3: a hand grabs it against a sunset rooftop, the city humming below. *(Paraphrased from the official demo shape.)*

*Two-shot dialogue beat (≈10s):* Shot 1: close on the detective under a flickering platform light, rain on his shoulders — he says quietly, "You were never on that train." Shot 2: cut to the woman's face as the train doors close behind her, a half-smile; the departure chime swallows the silence.

## Failure → fix [field]
| Symptom | Fix |
|---|---|
| Renders as one continuous take | clearer `Shot N:` labels · reduce the number of functional shots · use a verified non-fast tier only when the active surface exposes one |
| A shot's action skipped/compressed | fewer shots · raise duration within the active options · use `auto` only when the active surface exposes it · one action per shot |
| Cut lands mid-action | end each shot's sentence on the completed beat; let the next shot open the new one |
| Atmosphere breaks between shots | declare the persisting effect once for the whole piece: "thin mist throughout, every shot" (全程薄雾) |

## Sequence Boundary

Multi-shot grammar describes cuts inside one generation. Sequence-state planning describes multiple connected generations. Do not paste future clip prompts into the current multishot prompt. If a beat belongs to a later generation, mark it reserved and leave it out.

Dense multishot prompts use shot labels and endpoints. Continuous takes use phases and no hard cuts. Do not mix those contracts.

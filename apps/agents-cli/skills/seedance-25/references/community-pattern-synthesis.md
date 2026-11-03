# Community-Derived Seedance Patterns

This reference is a critical synthesis of the public `awesome-seedance` Skill and template catalogue from [LearnPrompt/awesome-seedance](https://github.com/LearnPrompt/awesome-seedance). It is domain evidence for Seedance 2.5 authoring, not an official provider specification, not a live case index, and not a second TapCanvas prompt contract.

Use only the subsection that matches the current task. Transfer the reasoning pattern, not the example's characters, plot, fixed numbers, creator voice, or copied prompt text.

## Evidence boundary and adoption policy

The external catalogue is useful because it groups repeated community practice into structures such as timed beats, identity locks, storyboard-to-video, dialogue performance, product shot lists, action loops, realism modes, and genre lenses. Its case counts, heat scores, template names, example prompts, model claims, and surface syntax are not automatically facts about the active TapCanvas provider.

Adopt a pattern when it improves observable authoring. Reject or downgrade it when it would:

- turn a case-derived number into a provider limit, default, or guarantee;
- invent `@Image`, `@Video`, or `@Audio` tokens not supplied by the user or active structured surface;
- require a fixed panel count, shot count, word count, minimum prompt length, or mandatory negative list;
- make a genre template override the user’s frozen story, the active generation contract, or the TapCanvas authoring contract;
- convert a review signal into a runtime pass/fail decision or block an already accepted asset;
- copy a case’s prose, named characters, visual identity, or creator-specific style.

When a useful external rule conflicts with an active `generationContract`, frozen BeatSheet fact, accepted boundary frame, or `tapcanvas/video-prompt-authoring@4.0.1`, the higher-authority source wins. Record the conflict for diagnosis; do not silently merge the rules.

## 1. Fixed canon plus a causal timeline

Use for multi-beat shots, longer single generations, dialogue scenes, commercials, action, or any clip where order matters.

1. Put generation settings outside prompt prose when the surface owns them.
2. State whole-clip invariants once: identity, wardrobe, product geometry, prop ownership, geography, axis, visual treatment, and audio relationship.
3. Write adjacent, non-overlapping time ranges only when timing controls a visible event. Each range carries a shot purpose, one primary visible change, camera service, sound, and an observable end state.
4. Let the next range consume the previous range’s position, velocity, contact, held object, gaze, or sound phase; do not reintroduce the same setup.
5. Put global exclusions at the end so they govern the whole prompt, not just one beat.

The value is not “more timestamps.” It is separating stable facts from changing events so the model does not mutate identity while trying to remember the action. Exact sub-second timing remains a surface- and audio-dependent planning aid, never a universal precision guarantee.

## 2. Reference ownership: inherit and do not inherit

For each real asset, assign one primary control role before writing scene prose:

| Role | Inherit | Explicitly do not inherit unless separately assigned |
|---|---|---|
| Identity / wardrobe | face, hair, body proportions, named garments, accessories | source pose, background, furniture, lighting, text |
| Product / prop | geometry, material, colour, ownership, relevant surface response | source hand, camera, room, label text, unrelated objects |
| Environment | layout, architecture, depth, material, light direction | people, props, story events, accidental composition |
| Motion / camera | path, timing, camera trajectory, or framing assigned by the asset | performer identity, costume, environment, logo, sound |
| Audio | named speaker or sound category, voice character, delivery, or rhythm | unrelated words, people, music, ambience, or timing |
| Storyboard / keyframe | order, approximate composition, anchor state, or endpoint explicitly assigned | line-art style, placeholder people, unassigned text, extra events |

Name important assets with the active surface’s exact token or with neutral internal role names when the 2.5 surface has no token mapping. Do not translate or normalize a supplied token. If several views depict one subject, say that they are one subject and lock the output count. Remove an asset that controls nothing instead of asking the model to use “all references for style.”

When two references compete, choose one owner per dimension. A character image should not silently own the storyboard’s pose; a motion video should not silently replace the product’s identity; an audio reference should not rewrite the frozen dialogue. State the winner and the excluded transfer.

## 3. Action loop: trigger, path, contact, consequence, exit

Use for combat, sports, stunts, object manipulation, transformations, VFX, and any interaction whose result depends on physics.

Write the smallest observable chain that makes the result believable:

`initial support or motion → trigger/choice → path or contact → force/material response → subject reaction → visible end state`

Name the driver, the contacted target, the direction of force, and the consequence that the viewer can see. For a product, this may be hand placement → lift → rotation → reflection change → stable placement. For a stunt, it may be run-up → contact → compression → rebound → landing posture. For a spectacle, it may be approach → scale cue → impact → environmental response → final frame.

Do not let camera shake, particles, blur, or a dramatic adjective stand in for the body/object path. Later actions may consume unresolved velocity or imbalance, but must not replay a complete preparation and reset unless the story actually returns to rest. Negative clauses are useful only as targeted protection against a concrete failure; they are not a substitute for positive action.

## 4. Dialogue and performance beats

Use when speech must be heard, lip-synced, or causally understood.

- Declare language, regional variety if relevant, audio source, and speaker before the line.
- Place each line inside the beat where it is spoken, rather than in a detached dialogue appendix.
- Give the listener’s response a trigger and a visible or audible change; end the beat in a state that the next beat can inherit.
- When an uploaded track drives lip sync, let the audio own the actual vocal timing and restrict lip motion to the bound speaker. Keep visual motion compatible with readable speech.
- Shorten a line or redistribute time when synchronization is unstable; do not invent a universal word-count gate. Move exact brand names, numbers, subtitles, and slogans to post when the active task requires typographic precision.

## 5. Storyboard, keyframe, and blockout carriers

Treat a storyboard grid as an ordered planning carrier only when the active structured surface accepts that reference role. State reading order, what the board controls, what identity/environment references control, and how the intervals connect. Every panel that matters to the generated motion should contain a visible action or state change; a panel that is only a pretty still becomes a slideshow cue.

Do not draw timestamps, captions, or implementation labels into the board when the model may interpret them as pixels. Do not force the number of panels to a catalogue example. Choose the number from the user’s real event load, duration, and surface contract. For blockouts, distinguish a coarse motion/camera skeleton from a fine geometric source before assigning what to preserve.

## 6. Look-specific realism, not adjective stacking

Select one dominant capture logic for a shot unless the user explicitly asks for a hybrid:

- **UGC / found footage:** named consumer capture context plus positive imperfections such as focus hunting, exposure breathing, framing drift, or operator movement; keep dialogue short and framing readable.
- **Commercial / product:** motivated light, material response, macro subject, controlled camera, and a clean hero/end frame; add exact type and logos in post when needed.
- **Stylized / animation:** measurable drawing, render, cadence, or material decisions plus exclusions against neighbouring looks; do not import live-action camera vocabulary without a reason.

“Realistic,” “cinematic,” “premium,” and “epic” are not enough on their own. Convert them into observable camera behaviour, light, material, cadence, blocking, or sound. Do not combine incompatible capture logics merely because both appeared in external examples.

## 7. Genre lenses are optional extensions

Load only the active lens and map it back to the existing authoring dimensions:

- **Twist comedy:** work backward from one visible payoff, preserve a brief readable reaction, and keep the camera/physics straight-faced.
- **Sports / action:** keep the ordered action loop and gravity/contact consequences legible; do not write only the landing or outcome.
- **Fantasy / sci-fi spectacle:** define entities separately, buy scale with spatial reference objects and camera perspective, and give the clip one dominant spectacle with a declared final frame.
- **Product / UGC review:** lock person and product independently, decompose the product into recognisable parts, and weld speech to the handling beat.
- **Horror / suspense:** make each escalation a visible change with a causal trigger and preserve the unresolved state only when the story asks for it.

These are authoring heuristics, not mandatory output sections, fixed genre routes, or quality gates. If the user’s facts do not support a lens, use the general causal workflow instead.

## Final application check

Before delivery, replay the provider-visible prompt without this reference file or hidden review notes. It must still identify the active subjects, asset roles, event order, action cause and consequence, camera purpose, sound source, continuity locks, and exit state. If it cannot, repair the prompt in the same authoring chain. Do not compensate with more adjectives, copied case prose, or a runtime rejection.

# Image-to-Video Guide

## Core Rule

Prompt only what the image cannot show. A still image already contains subject identity, product form, wardrobe, palette, composition, and background. Re-describing those static details often causes drift. Add motion, camera, timing, transformation, lighting change, audio, and preservation constraints.

Reference tokens and input fields are profile- and surface-specific. The `@Image1` example below is valid only when the active surface supplies that exact token; Seedance 2.5 must not inherit Seedance 2.0 tag names or reference counts without structured surface evidence.

## Minimal Template

`[exact image-reference token from the active surface] controls [identity/product/scene]; preserve it exactly. Only [motion] changes. Camera: [one motivated move for this shot]. Lighting: [source or transition]. Sound: [cue]. Constraint: [what must not change].`

## Two I2V Modes

Field-observed from Chinese practice; decide the mode before writing.

- **Hold mode** (the image is the moment): distribute three or four natural micro-actions across the clip - a blink, a breath, hair drift, a slow gaze shift - and lock everything else with a double statement, positive plus negative: `she stays seated by the window; she does not stand, turn, or leave frame`. No camera move, or one slow push-in at most.
- **React mode** (something happens to the subject): expand one emotion into sub-beats with real time to land - `she registers the sound, her eyes widen, color rises in her face over two to three seconds`. Rushed emotions read as glitches; give the key beat at least two seconds. If the image is clearly mid-scene rather than a natural opening frame, anchor the start explicitly: `the clip begins exactly at this moment`.

## Preservation Language

Use precise locks for fragile anchors: `preserve face identity`, `preserve logo and label`, `preserve bottle shape and cap geometry`, `preserve outfit and hairstyle`, `preserve room layout`. Do not lock everything if the scene needs natural motion; lock only what must remain stable.

## Good I2V Additions

| Add | Example |
|---|---|
| Micro-expression | `subject blinks once and lowers their eyes` |
| Product light | `thin highlight travels across the label` |
| Weather | `rain streaks behind the subject; droplets bead on the surface` |
| Camera | `slow dolly-in from current composition to tighter detail` |
| Atmosphere | `dust catches the doorway beam and settles` |
| Audio | `soft room tone, one key click at the endpoint` |

## Failure Fixes

- If identity drifts: reduce new visual description and strengthen preservation constraints.
- If camera jumps: use one camera move with start and endpoint.
- If product warps: say preserved, static identity, no shape change, no transformation of the product.
- If output is still: add one physical action and one time cue.
- If background changes: preserve environment layout and animate only light, weather, or atmosphere.
- If hands deform: simplify hand motion or keep hands outside the main action.

# Seedance 2.5 Capabilities and Limits

## Contents

- [Source boundary](#source-boundary)
- [Multimodal input](#multimodal-input)
- [Generation and extension duration](#generation-and-extension-duration)
- [Task modes and locked parameters](#task-modes-and-locked-parameters)
- [Creative limitations](#creative-limitations)
- [Rules for factual claims](#rules-for-factual-claims)

## Source Boundary

This page summarizes Dreamina official material dated July 31, 2026 and verified on August 3, 2026:

- [Dreamina Seedance 2.5 User Guide](https://bytedance.larkoffice.com/wiki/NjnWwvf4BiFYFLk2RzrcEgaunGf)
- [Dreamina Seedance 2.5 Prompt Guide](https://bytedance.larkoffice.com/docx/A88jd0B47oAd8zxWp5ycZFMfnxh)

The official pages were compared with the user-provided copied text. The textual table of contents and body were complete. Embedded images, finished videos, and some visual comparisons were not included in the copied text, so never describe those example results as visually verified.

The workflow design also draws from the MIT-licensed [Emily2040/seedance-2.0](https://github.com/Emily2040/seedance-2.0), especially its mode routing, reference contracts, continuity truth, and one-variable retake method. Use only the official 2.5 sources above for 2.5 capability and numeric claims.

These values describe Seedance 2.5 on official Dreamina surfaces. Other products and APIs may expose different subsets, names, defaults, and quotas. Recheck the active surface before making operational claims.

## Multimodal Input

Seedance 2.5 supports text-only generation, image/video/audio references, and editing of existing video. The official prompt guide states a total ceiling of 50 reference assets, subject to the per-type limits below.

| Asset | 2.5 limit | Official stability guidance |
|---|---:|---|
| Images | Up to 30; each no larger than 4K | Prefer 1–8 distinct subjects across identity/product references |
| Videos | Up to 10; no more than 30 seconds combined | Prefer 1–5 subjects and 5–10 seconds per subject clip |
| Audio | Up to 10; no more than 30 seconds combined | Keep only dialogue, voice, ambience, or music directly relevant to the task |
| Video editing | One source video may be combined with reference images | Prefer a source under 20 seconds and 1–5 reference images |

Additional guidance:

- Creators may try 9–12 image subjects, 6–10 audio/video subjects, or 6–8 images for video editing, but stability may decrease.
- When more than five subjects also need multiple views, use separate images per view. Several independent view images are usually more stable than one collage containing several views.
- The official User Guide states that 2.5 supports audio-only driving. Do not inherit the Seedance 2.0 restriction that required an image or video with audio.
- A maximum is not a target. Remove every asset that has no defined role.
- Do not rely on text labels inside an image to bind a subject. State mappings in prompt prose.

## Generation and Extension Duration

| Function | Range in official 2.5 material | Notes |
|---|---|---|
| Standard generation | 4–30 seconds | The User Guide also lists 97–721 frames |
| One extension operation | 4–30 seconds | Available only when the source used as the extension base is under 30 seconds |
| Nested extension | Final output up to 60 seconds | Extreme example: extend a 30-second source by another 30 seconds |

For a generic or unknown Seedance 2.5 surface, treat 30 seconds as the maximum duration of one direct generation. Plan anything longer as several independently generated clips. Treat extension ranges as surface-specific and verify that the active surface exposes the operation before recommending it.

Treat timestamps as event budgets, not frame-accurate edit points. Actions may occur slightly before or after a range boundary.

## Task Modes and Locked Parameters

For its generic scope, this skill retains the official guide's Omni Reference, Smart Edit, First and Last Frames, Video Editing, Extend Video, Seamless Video Transition, Multi-grid Storyboard, and Clay Renderer workflows. It does not generalize Dreamina-only modes, and availability outside Dreamina is not implied.

| Task | Aspect ratio | Duration |
|---|---|---|
| Video editing | Automatically preserves the input video ratio; cannot be set separately | Approximately preserves source duration; cannot be set separately; input-frame processing may introduce about 0.3 seconds of difference |
| First-frame or first/last-frame | Automatically uses the first image’s ratio | Configurable; first and last images should use the same ratio to avoid stretching the last frame |
| Video extension | Automatically preserves the source video ratio; cannot be set separately | Extension duration is configurable |

Do not promise automatically locked parameters as separately configurable generation or API fields. Treat all other settings as surface-specific.

The official Dreamina User Guide lists 480p and 720p output for Seedance 2.5. Do not infer native 4K output from unofficial promotional material.

## Creative Limitations

- Multi-reference creation is for selecting and combining the correct assets per scene, not displaying every asset at once.
- Video-edit prompts can improve source-event alignment but cannot guarantee frame-by-frame overlap.
- Edited output approximately preserves source duration, with a possible difference of about 0.3 seconds.
- First and last frames constrain endpoints; the model still generates the continuous action between them.
- Multiple keyframes control stage order and key states, not every intermediate frame.
- Extension boundaries should connect visually but are not guaranteed to be pixel-identical. Review both sides of the boundary and the full extension.
- The extended segment's audio volume may differ slightly from the source video. Review loudness across the boundary and normalize it in post when necessary.
- Seamless transitions target audiovisual continuity, not pixel-identical preservation of both source clips.
- Use prepared reference material and post-production for subtitles, formulas, logos, product specifications, or frame-accurate timing that must be exact.
- Negative instructions can reduce random subtitles and irrelevant background music, but do not present them as guarantees.

## Rules for Factual Claims

1. Scope these values to official Dreamina Seedance 2.5 material. Do not extend them to an unknown surface.
2. If the active surface is unknown, still write the prompt but describe operations conditionally, such as “if your surface exposes video extension.”
3. If two official passages differ semantically, prefer the more task-specific table and disclose the discrepancy.
4. Never let a third-party blog override official documentation. Use third-party information only as a lead that still requires verification.

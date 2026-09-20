# Color Pipeline And ACES Notes

Use this reference when Seedance output must enter a professional edit, grade, HDR/SDR pass, agency review, or delivery workflow.

## Honest Boundary

Seedance prompts can describe color intent, lighting motivation, contrast, palette, material response, and mood. They cannot replace measured color management, calibrated monitoring, conform, grade, legal-range checks, or delivery transforms. Keep prompt language creative; keep pipeline language as metadata for post.

## Prompt-Level Color Intent

Use:

- source light: tungsten practical, overcast daylight, sodium streetlight, neon sign, cool moon rim;
- contrast: soft low contrast, hard noir contrast, clean product contrast, high-key beauty;
- palette: restrained warm/cool split, muted winter palette, saturated music-video palette;
- material response: brushed metal highlight, skin rolloff, glossy acrylic reflection, wet asphalt speculars;
- transition: practical lamp warms the face, lightning briefly hardens the silhouette.

Avoid:

- unsupported claims such as exact ACES compliance from a prompt alone;
- impossible stacks like HDR Dolby Vision, 16mm, neon, bleach bypass, and pastel commercial all in one short shot;
- using LUT names as magic style words without describing the visible result.

## Post Metadata To Track

For professional handoff, record:

| Field | Meaning |
|---|---|
| capture/source | generated source, reference clips, stills, source frame |
| working color space | project working assumption, often ACEScct/ACEScg or editor-managed alternative |
| IDT/source transform | how source media is interpreted, if applicable |
| show look | creative look description, LUT/CDL/LMT notes |
| output transform | SDR Rec.709, HDR PQ, theatrical/DCP, social platform conversion |
| trim pass | separate SDR/HDR/social review notes |
| QC notes | clipping, illegal levels, banding, skin tone, product color, logo color |

## ACES-Friendly Handoff

When a user asks for ACES, respond with a two-layer answer:

1. Prompt: visible color and lighting instructions that Seedance can understand.
2. Handoff: ACES/AMF/color notes for the editor or colorist to verify outside Seedance.

Example:

`Prompt look: cool overcast daylight with a warm practical lamp reflected in the bottle, soft contrast, clean highlight rolloff, no crushed blacks. Post note: conform generated clip into the project color pipeline, verify source interpretation, preserve product color, create SDR Rec.709 and HDR trim review if required.`

## Color Failure Repairs

| Symptom | Repair |
|---|---|
| Flat image | add motivated key source, rim/separation, and one material highlight |
| Overprocessed color | reduce style names; specify natural contrast and neutral skin/product color |
| Inconsistent color across shots | repeat light direction, time of day, palette, and show-look note in every shot |
| Product color wrong | use I2V product reference, locked camera, and product-color preservation constraint |
| HDR/social mismatch | keep prompt neutral; plan separate grade/export versions in post |

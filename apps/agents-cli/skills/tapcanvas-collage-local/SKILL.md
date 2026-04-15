---
name: tapcanvas-collage-local
description: Use local Python Pillow to compose storyboard/role-card collages with per-cell role-name labels. No model call needed.
---

# TapCanvas Local Collage

Use this skill when the task is:
- merge multiple storyboard frames into one grid image
- merge role-card images and add role-name labels
- avoid model-based collage generation

This skill is local-first and deterministic. It does not call any model API.

## Prerequisites

- Python 3.9+
- Pillow

Install:

```bash
python3 -m pip install --upgrade pillow
```

## Script

Path:

`skills/tapcanvas-collage-local/scripts/collage.py`

### Input modes

You can pass image inputs as:
- local file paths
- HTTP/HTTPS URLs

### Usage examples

1) 2x2 collage with role labels:

```bash
python3 skills/tapcanvas-collage-local/scripts/collage.py \
  --input ./tmp/shot1.png \
  --input ./tmp/shot2.png \
  --input ./tmp/shot3.png \
  --input ./tmp/shot4.png \
  --label "真宫寺唯" \
  --label "萧夜" \
  --label "真宫寺唯" \
  --label "萧夜" \
  --output ./tmp/role-collage.png \
  --grid 2 \
  --cell-size 640 \
  --divider-width 4 \
  --divider-color "#ffffff"
```

2) URL inputs, auto grid:

```bash
python3 skills/tapcanvas-collage-local/scripts/collage.py \
  --input "https://example.com/a.png" \
  --input "https://example.com/b.png" \
  --input "https://example.com/c.png" \
  --output ./tmp/storyboard-collage.png \
  --grid auto
```

## Behavior

- Fills each cell with center-crop + resize (stable visual layout).
- Draws a semi-transparent dark label strip at cell bottom.
- Draws per-cell label text in white.
- If labels are fewer than images, remaining cells are unlabeled.
- If labels are more than images, extra labels are ignored.

## Output

- Default output format: PNG.
- Ensure output path parent directories exist (script auto-creates).


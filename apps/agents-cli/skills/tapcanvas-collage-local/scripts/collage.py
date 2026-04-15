#!/usr/bin/env python3
"""
Local collage tool for TapCanvas agents skill.

Features:
- Compose N images into 2x2 or 3x3 grid (or auto grid).
- Accept local paths and http(s) URLs.
- Draw per-cell labels (e.g., role names).
- Deterministic output, no model call.
"""

from __future__ import annotations

import argparse
import io
import math
import os
import sys
import urllib.request
from typing import List, Sequence, Tuple

try:
    from PIL import Image, ImageColor, ImageDraw, ImageFont
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "Missing dependency Pillow. Install with: python3 -m pip install --upgrade pillow"
    ) from exc


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Create collage with optional per-cell labels.")
    p.add_argument("--input", dest="inputs", action="append", required=True, help="Image path or URL.")
    p.add_argument("--label", dest="labels", action="append", default=[], help="Per-cell label text.")
    p.add_argument("--output", required=True, help="Output image path (e.g. ./tmp/collage.png).")
    p.add_argument(
        "--grid",
        default="auto",
        choices=["auto", "2", "3"],
        help="Grid size. auto => 2 for <=4 images else 3.",
    )
    p.add_argument("--cell-size", type=int, default=640, help="Cell width/height in px.")
    p.add_argument("--divider-width", type=int, default=4, help="Divider width in px.")
    p.add_argument("--divider-color", default="#ffffff", help="Divider color, e.g. #ffffff.")
    p.add_argument("--font-size", type=int, default=30, help="Label font size in px.")
    p.add_argument("--font-path", default="", help="Optional TTF font path.")
    p.add_argument("--label-height", type=int, default=56, help="Label strip height in px.")
    p.add_argument("--label-bg-alpha", type=int, default=150, help="0-255 alpha for label strip.")
    p.add_argument(
        "--background",
        default="#000000",
        help="Canvas background color for empty cells and dividers.",
    )
    return p.parse_args()


def clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


def resolve_grid(grid_arg: str, image_count: int) -> int:
    if grid_arg == "2":
        return 2
    if grid_arg == "3":
        return 3
    return 2 if image_count <= 4 else 3


def load_image(source: str) -> Image.Image:
    src = source.strip()
    if not src:
        raise ValueError("empty input source")
    if src.startswith("http://") or src.startswith("https://"):
        with urllib.request.urlopen(src, timeout=30) as resp:
            data = resp.read()
        return Image.open(io.BytesIO(data)).convert("RGB")
    if not os.path.exists(src):
        raise FileNotFoundError(f"input not found: {src}")
    return Image.open(src).convert("RGB")


def center_crop_resize(img: Image.Image, size: int) -> Image.Image:
    w, h = img.size
    if w <= 0 or h <= 0:
        raise ValueError("invalid image size")
    target_ratio = 1.0
    src_ratio = w / h
    if src_ratio > target_ratio:
        # Wider than square: crop width
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        box = (left, 0, left + new_w, h)
    else:
        # Taller than square: crop height
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        box = (0, top, w, top + new_h)
    return img.crop(box).resize((size, size), Image.Resampling.LANCZOS)


def load_font(font_path: str, font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = []
    if font_path:
        candidates.append(font_path)
    candidates.extend(
        [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Medium.ttc",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, font_size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_label(
    canvas: Image.Image,
    text: str,
    top_left: Tuple[int, int],
    cell_size: int,
    label_height: int,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    bg_alpha: int,
) -> None:
    if not text.strip():
        return
    x, y = top_left
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    y0 = y + cell_size - label_height
    y1 = y + cell_size
    od.rectangle([x, y0, x + cell_size, y1], fill=(0, 0, 0, bg_alpha))

    draw = ImageDraw.Draw(overlay)
    text_color = (255, 255, 255, 255)
    pad_x = 14
    max_w = cell_size - pad_x * 2
    rendered = text.strip()

    # Basic ellipsis truncation by rendered width
    bbox = draw.textbbox((0, 0), rendered, font=font)
    while bbox[2] - bbox[0] > max_w and len(rendered) > 1:
        rendered = rendered[:-1]
        candidate = rendered + "..."
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= max_w:
            rendered = candidate
            break

    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = x + (cell_size - tw) // 2
    ty = y0 + max(0, (label_height - th) // 2)
    draw.text((tx, ty), rendered, font=font, fill=text_color)
    canvas.alpha_composite(overlay)


def build_collage(
    images: Sequence[Image.Image],
    labels: Sequence[str],
    grid: int,
    cell_size: int,
    divider_width: int,
    divider_color: str,
    label_height: int,
    label_alpha: int,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    background: str,
) -> Image.Image:
    grid = clamp(grid, 2, 3)
    cell_size = clamp(cell_size, 128, 4096)
    divider_width = clamp(divider_width, 0, 64)
    label_height = clamp(label_height, 20, cell_size // 2)
    label_alpha = clamp(label_alpha, 0, 255)
    _ = ImageColor.getrgb(background)  # validate
    divider_rgb = ImageColor.getrgb(divider_color)

    side = grid * cell_size + (grid - 1) * divider_width
    canvas = Image.new("RGBA", (side, side), ImageColor.getrgb(background) + (255,))
    draw = ImageDraw.Draw(canvas)

    if divider_width > 0:
        # vertical lines
        for c in range(1, grid):
            x = c * cell_size + (c - 1) * divider_width
            draw.rectangle([x, 0, x + divider_width - 1, side], fill=divider_rgb + (255,))
        # horizontal lines
        for r in range(1, grid):
            y = r * cell_size + (r - 1) * divider_width
            draw.rectangle([0, y, side, y + divider_width - 1], fill=divider_rgb + (255,))

    max_cells = grid * grid
    for i, img in enumerate(images[:max_cells]):
        row = i // grid
        col = i % grid
        x = col * (cell_size + divider_width)
        y = row * (cell_size + divider_width)
        tile = center_crop_resize(img, cell_size).convert("RGBA")
        canvas.alpha_composite(tile, (x, y))
        if i < len(labels):
            draw_label(
                canvas=canvas,
                text=labels[i],
                top_left=(x, y),
                cell_size=cell_size,
                label_height=label_height,
                font=font,
                bg_alpha=label_alpha,
            )

    return canvas.convert("RGB")


def main() -> int:
    args = parse_args()
    if not args.inputs:
        print("No input images.", file=sys.stderr)
        return 2

    try:
        images = [load_image(src) for src in args.inputs]
    except Exception as exc:
        print(f"Failed to load input image: {exc}", file=sys.stderr)
        return 2

    grid = resolve_grid(args.grid, len(images))
    font = load_font(args.font_path, clamp(args.font_size, 12, 200))
    collage = build_collage(
        images=images,
        labels=args.labels or [],
        grid=grid,
        cell_size=args.cell_size,
        divider_width=args.divider_width,
        divider_color=args.divider_color,
        label_height=args.label_height,
        label_alpha=args.label_bg_alpha,
        font=font,
        background=args.background,
    )

    output = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    collage.save(output)

    print(
        f"ok output={output} grid={grid} count={len(images)} size={collage.size[0]}x{collage.size[1]}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

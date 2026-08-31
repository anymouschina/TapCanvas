#!/usr/bin/env python3

import argparse
import string
from pathlib import Path

from PIL import Image


def parse_state(value: str) -> str:
    allowed_characters = set(string.ascii_lowercase + string.digits + "-")
    if not value or any(character not in allowed_characters for character in value):
        raise argparse.ArgumentTypeError("state must contain only lowercase letters, digits, or hyphens")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split a 2x2 director-pet sprite sheet into exact PNG frames.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--state", required=True, type=parse_state)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_path = Path(args.input)
    output_dir = Path(args.out_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with Image.open(source_path) as source:
        sheet = source.convert("RGBA")
        width, height = sheet.size
        if width != height or width % 2 != 0:
            raise ValueError(f"Expected an even square sprite sheet, received {width}x{height}")

        cell_width = width // 2
        cell_height = height // 2
        boxes = (
            (0, 0, cell_width, cell_height),
            (cell_width, 0, width, cell_height),
            (0, cell_height, cell_width, height),
            (cell_width, cell_height, width, height),
        )

        for index, box in enumerate(boxes, start=1):
            frame = sheet.crop(box)
            if frame.size != (512, 512):
                frame = frame.resize((512, 512), Image.Resampling.LANCZOS)
            output_path = output_dir / f"{args.state}-{index:02d}.png"
            frame.save(output_path, format="PNG", optimize=True)
            print(output_path)


if __name__ == "__main__":
    main()

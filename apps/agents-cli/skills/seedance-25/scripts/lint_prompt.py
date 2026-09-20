#!/usr/bin/env python3
"""Run heuristic structural checks on a Seedance 2.5 prompt draft.

The linter can recognize common English and Chinese prompt structures. All
source documentation and user-facing output remain English. These checks do
not predict generation quality or verify that a platform bound a reference.
For unknown surfaces, the linter enforces a conservative 30-second ceiling
for one direct generation.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


REFERENCE_RE = re.compile(
    r"@(?:image|video|audio)\s*\d+|"
    r"@(?:\u56fe\u7247|\u89c6\u9891|\u97f3\u9891)\s*\d+",
    re.IGNORECASE,
)
BRACKET_REFERENCE_RE = re.compile(
    r"\[(?:image|video|audio|\u56fe\u7247|\u89c6\u9891|\u97f3\u9891)\s*\d+\]",
    re.IGNORECASE,
)
TIME_RANGE_RE = re.compile(
    r"(?P<start>\d+(?:\.\d+)?)\s*(?:s|\u79d2|sec(?:onds?)?)?\s*"
    r"[-\u2013\u2014~\uff5e\u81f3\u5230]\s*"
    r"(?P<end>\d+(?:\.\d+)?)\s*(?:s|\u79d2|sec(?:onds?)?)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str


def read_prompt(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def contains_any(text: str, terms: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(term.lower() in lowered for term in terms)


def infer_mode(text: str, requested: str) -> str:
    if requested != "auto":
        return requested

    checks = [
        (
            "transition",
            (
                "seamless transition",
                "transition between",
                "\u65e0\u7f1d\u8f6c\u573a",
                "\u8f6c\u573a\u524d\u89c6\u9891",
                "\u8f6c\u573a\u540e\u89c6\u9891",
            ),
        ),
        (
            "blockout",
            (
                "blockout",
                "clay renderer",
                "\u767d\u6a21",
                "\u7070\u6a21",
            ),
        ),
        (
            "storyboard",
            (
                "storyboard grid",
                "storyboard",
                "\u5206\u955c",
            ),
        ),
        (
            "keyframes",
            (
                "keyframes in this order",
                "keyframe sequence",
                "\u591a\u5173\u952e\u5e27",
            ),
        ),
        (
            "extend",
            (
                "extend forward",
                "extend backward",
                "\u5411\u540e\u5ef6\u957f",
                "\u5411\u524d\u5ef6\u957f",
                "\u5ef6\u957f\u6bb5",
            ),
        ),
        (
            "edit",
            (
                "sole editing master",
                "edit @",
                "\u552f\u4e00\u7f16\u8f91\u6bcd\u7248",
                "\u7f16\u8f91 @",
            ),
        ),
    ]
    for mode, terms in checks:
        if contains_any(text, terms):
            return mode

    has_first = contains_any(text, ("first frame", "\u9996\u5e27"))
    has_last = contains_any(text, ("last frame", "\u5c3e\u5e27", "\u672b\u5e27"))
    if contains_any(text, ("\u9996\u5c3e\u5e27",)) or (has_first and has_last):
        return "first-last"
    if contains_any(
        text,
        (
            "multi-clip production",
            "long-form production",
            "several clips",
            "[stage",
            "\u591a\u7247\u6bb5\u5236\u4f5c",
            "\u3010\u9636\u6bb5",
        ),
    ):
        return "long"
    if REFERENCE_RE.search(text):
        return "reference"
    return "base"


def lint_timeline(text: str, duration: float | None) -> list[Issue]:
    issues: list[Issue] = []
    ranges = [
        (float(match.group("start")), float(match.group("end")))
        for match in TIME_RANGE_RE.finditer(text)
    ]

    previous_end: float | None = None
    for index, (start, end) in enumerate(ranges, start=1):
        if end <= start:
            issues.append(
                Issue(
                    "error",
                    "invalid-range",
                    f"Time range {index} must end after it starts.",
                )
            )
            continue
        if duration is not None and end > duration + 1e-9:
            issues.append(
                Issue(
                    "error",
                    "range-exceeds-duration",
                    f"Time range {index} ends at {end:g}s, beyond the planned {duration:g}s duration.",
                )
            )
        if previous_end is not None:
            if start < previous_end - 1e-9:
                issues.append(
                    Issue(
                        "error",
                        "overlapping-ranges",
                        f"Time range {index} starts at {start:g}s and overlaps the previous range.",
                    )
                )
            elif start > previous_end + 1e-9:
                issues.append(
                    Issue(
                        "warning",
                        "timeline-gap",
                        f"The previous range ends at {previous_end:g}s and the next begins at {start:g}s; confirm that the gap is intentional.",
                    )
                )
        previous_end = max(previous_end or end, end)
    return issues


def lint_duration(duration: float | None) -> list[Issue]:
    if duration is None or duration <= 30:
        return []
    return [
        Issue(
            "error",
            "duration-exceeds-generic-limit",
            f"The planned {duration:g}s duration exceeds the generic 30s limit "
            "for one direct generation. Split the production into clips of no "
            "more than 30 seconds.",
        )
    ]


def lint_references(text: str) -> list[Issue]:
    issues: list[Issue] = []
    refs = REFERENCE_RE.findall(text)
    bracket_refs = BRACKET_REFERENCE_RE.findall(text)
    role_terms = (
        "defines",
        "corresponds to",
        "controls",
        "provides",
        "is the first frame",
        "is the last frame",
        "is the source",
        "is the before-transition",
        "is the after-transition",
        "only",
        "\u5b9a\u4e49",
        "\u5bf9\u5e94",
        "\u63a7\u5236",
        "\u63d0\u4f9b",
        "\u9996\u5e27",
        "\u5c3e\u5e27",
        "\u6bcd\u7248",
        "\u8f6c\u573a\u524d",
        "\u8f6c\u573a\u540e",
        "\u53ea\u4f7f\u7528",
        "\u53ea\u7ee7\u627f",
    )
    exclusion_terms = (
        "do not use",
        "do not transfer",
        "do not change",
        "preserve",
        "keep",
        "\u4e0d\u8981\u4f7f\u7528",
        "\u4e0d\u7ee7\u627f",
        "\u4e0d\u5f97\u4f7f\u7528",
        "\u4e0d\u5f97\u6539\u53d8",
        "\u4fdd\u6301",
        "\u4fdd\u7559",
    )

    unique_refs = {ref.lower().replace(" ", "") for ref in refs}
    if len(unique_refs) >= 2:
        if not contains_any(text, role_terms):
            issues.append(
                Issue(
                    "warning",
                    "missing-reference-roles",
                    "Several references are present, but their roles are not mapped clearly.",
                )
            )
        if not contains_any(text, exclusion_terms):
            issues.append(
                Issue(
                    "warning",
                    "missing-reference-exclusions",
                    "Several references are present, but the prompt does not state what must not transfer.",
                )
            )

    if bracket_refs and not refs:
        issues.append(
            Issue(
                "info",
                "verify-reference-binding",
                "Only bracketed reference labels were detected. Confirm that they are the exact tokens bound by the active surface.",
            )
        )
    return issues


def lint_mode(text: str, mode: str, duration: float | None) -> list[Issue]:
    issues: list[Issue] = []

    if mode == "edit":
        if not contains_any(
            text,
            (
                "sole editing master",
                "sole source",
                "\u552f\u4e00\u7f16\u8f91\u6bcd\u7248",
                "\u552f\u4e00\u6bcd\u7248",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-edit-master",
                    "The edit does not declare one source video as the sole editing master.",
                )
            )
        if not contains_any(
            text,
            (
                "change only",
                "modify only",
                "only from",
                "\u53ea\u4fee\u6539",
                "\u4ec5\u4fee\u6539",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-edit-scope",
                    "The edit is not limited to one object, region, time range, or audio category.",
                )
            )
        if not contains_any(
            text,
            ("preserve", "keep", "\u4fdd\u6301", "\u4fdd\u7559"),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-preservation",
                    "The edit does not list source-video content that must remain unchanged.",
                )
            )

    if mode == "extend":
        if not contains_any(
            text,
            (
                "observed last frame",
                "observed first frame",
                "actual last frame",
                "actual first frame",
                "boundary frame",
                "\u5b9e\u9645\u672b\u5e27",
                "\u5b9e\u9645\u9996\u5e27",
                "\u6700\u540e\u4e00\u5e27",
                "\u7b2c\u4e00\u5e27",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-boundary-state",
                    "The extension does not describe the source video’s observed boundary frame.",
                )
            )
        if not contains_any(
            text,
            (
                "continue",
                "continuity",
                "maintain",
                "preserve",
                "\u627f\u63a5",
                "\u8fde\u7eed",
                "\u4fdd\u6301",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-continuity",
                    "The extension does not lock pose, space, camera, motion, or audio continuity.",
                )
            )

    if mode == "first-last":
        has_first = contains_any(text, ("first frame", "\u9996\u5e27"))
        has_last = contains_any(text, ("last frame", "\u5c3e\u5e27"))
        if not (has_first and has_last):
            issues.append(
                Issue(
                    "warning",
                    "missing-endpoint-role",
                    "A first/last-frame task must define both endpoint roles separately.",
                )
            )
        if not contains_any(
            text,
            (
                "continuous",
                "transition",
                "reaches",
                "\u8fde\u7eed",
                "\u81ea\u7136\u5230\u8fbe",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-endpoint-transition",
                    "The prompt does not explain how continuous action reaches the last frame.",
                )
            )

    if mode == "keyframes" and not contains_any(
        text,
        (
            "in this order",
            "in order",
            "\u6309",
            "\u4f9d\u6b21",
            "\u987a\u5e8f",
        ),
    ):
        issues.append(
            Issue(
                "warning",
                "missing-keyframe-order",
                "The keyframe sequence has no explicit order.",
            )
        )

    if mode == "storyboard":
        if not contains_any(
            text,
            (
                "left to right",
                "top to bottom",
                "reading order",
                "\u4ece\u5de6\u5230\u53f3",
                "\u4ece\u4e0a\u5230\u4e0b",
                "\u9605\u8bfb\u987a\u5e8f",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-storyboard-order",
                    "The storyboard has no explicit reading order.",
                )
            )
        if not contains_any(
            text,
            (
                "do not use the line",
                "do not inherit line art",
                "\u4e0d\u7ee7\u627f\u7ebf\u7a3f",
                "\u4e0d\u8981\u4f7f\u7528\u7ebf\u7a3f",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-storyboard-exclusion",
                    "The prompt does not exclude line-art style, text labels, or placeholder characters.",
                )
            )

    if mode == "blockout":
        if not contains_any(
            text,
            (
                "coarse blockout",
                "fine blockout",
                "\u7c97\u767d\u6a21",
                "\u7cbe\u767d\u6a21",
                "\u7c97\u6a21",
                "\u7cbe\u6a21",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "unclassified-blockout",
                    "Classify the blockout as coarse motion structure or fine complete geometry.",
                )
            )
        if not contains_any(
            text,
            ("preserve", "keep", "inherit", "\u4fdd\u7559", "\u7ee7\u627f"),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-blockout-inheritance",
                    "The blockout prompt does not state which paths, geometry, camera, or cuts to inherit.",
                )
            )
        if not contains_any(
            text,
            ("do not use", "\u4e0d\u4f7f\u7528", "\u4e0d\u8981"),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-blockout-exclusion",
                    "The blockout prompt does not exclude gray materials, empty background, or production markers.",
                )
            )

    if mode == "transition":
        video_refs = re.findall(
            r"@(?:video|\u89c6\u9891)\s*\d+",
            text,
            re.IGNORECASE,
        )
        if len({ref.lower().replace(" ", "") for ref in video_refs}) < 2:
            issues.append(
                Issue(
                    "warning",
                    "missing-transition-clips",
                    "A seamless transition normally needs separately defined before and after clips.",
                )
            )
        if not contains_any(
            text,
            (
                "at the end",
                "fills the frame",
                "triggers",
                "\u89e6\u53d1",
                "\u906e\u6321",
                "\u586b\u6ee1\u753b\u9762",
                "\u5f62\u53d8",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-transition-trigger",
                    "The transition has no trigger action, occlusion, or morph process.",
                )
            )
        if not contains_any(
            text,
            (
                "arrival",
                "opening composition",
                "ends naturally",
                "\u5230\u8fbe",
                "\u5f00\u573a\u6784\u56fe",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-arrival-state",
                    "The transition does not define its arrival state in the second clip.",
                )
            )

    if mode == "long" or (duration is not None and duration >= 20):
        if not contains_any(
            text,
            ("stage", "scene", "\u9636\u6bb5", "\u573a\u666f"),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-long-structure",
                    "The longer prompt is not organized by stage or scene.",
                )
            )
        if not contains_any(
            text,
            (
                "end state",
                "final state",
                "\u7ec8\u6001",
                "\u6700\u7ec8\u72b6\u6001",
            ),
        ):
            issues.append(
                Issue(
                    "warning",
                    "missing-end-state",
                    "The longer prompt does not define visible stage end states.",
                )
            )

    return issues


def lint_style_and_audio(text: str) -> list[Issue]:
    issues: list[Issue] = []
    boosters = (
        "cinematic",
        "epic",
        "stunning",
        "masterpiece",
        "high quality",
        "beautiful",
        "\u7535\u5f71\u611f",
        "\u9ad8\u7ea7\u611f",
        "\u9707\u64bc",
        "\u552f\u7f8e",
        "\u5927\u7247\u611f",
        "\u9ad8\u8d28\u91cf",
    )
    lowered = text.lower()
    booster_hits = sum(lowered.count(term.lower()) for term in boosters)
    if booster_hits >= 4:
        issues.append(
            Issue(
                "warning",
                "style-booster-overload",
                "The prompt contains many generic quality/style boosters. Replace them with observable action, physical light, material, and sound.",
            )
        )

    forbids_music = contains_any(
        text,
        (
            "no bgm",
            "no background music",
            "\u4e0d\u8981\u80cc\u666f\u97f3\u4e50",
            "\u65e0\u80cc\u666f\u97f3\u4e50",
            "\u4e0d\u8981 bgm",
        ),
    )
    requests_music = contains_any(
        text,
        (
            "background music plays",
            "music includes",
            "\u80cc\u666f\u97f3\u4e50\u4e3a",
            "\u97f3\u4e50\u5305\u62ec",
        ),
    )
    if forbids_music and requests_music:
        issues.append(
            Issue(
                "error",
                "audio-contradiction",
                "The prompt both prohibits and requests background music.",
            )
        )
    return issues


def lint_prompt(
    text: str,
    mode: str,
    duration: float | None,
) -> tuple[str, list[Issue]]:
    clean = text.strip()
    if not clean:
        return mode, [Issue("error", "empty-prompt", "The prompt is empty.")]

    detected_mode = infer_mode(clean, mode)
    issues: list[Issue] = []
    issues.extend(lint_duration(duration))
    issues.extend(lint_timeline(clean, duration))
    issues.extend(lint_references(clean))
    issues.extend(lint_mode(clean, detected_mode, duration))
    issues.extend(lint_style_and_audio(clean))
    return detected_mode, issues


def run_self_test() -> list[str]:
    failures: list[str] = []

    valid_edit = """
@Video 1 is the sole editing master. Change only the cool blue light on the
right wall from 4–7 seconds to warm orange. Preserve identity, wardrobe,
action, composition, camera, dialogue, and ambience.
"""
    mode, issues = lint_prompt(valid_edit, "edit", 10)
    if mode != "edit" or any(issue.severity == "error" for issue in issues):
        failures.append("valid edit prompt produced an error")

    overlapping = "0–5 seconds: Action A. 4–8 seconds: Action B."
    _, issues = lint_prompt(overlapping, "base", 8)
    if not any(issue.code == "overlapping-ranges" for issue in issues):
        failures.append("overlapping ranges were not detected")

    contradictory = "No background music. Background music plays softly."
    _, issues = lint_prompt(contradictory, "base", None)
    if not any(issue.code == "audio-contradiction" for issue in issues):
        failures.append("audio contradiction was not detected")

    extension = "@Video 1 is the source. The character then continues right."
    _, issues = lint_prompt(extension, "extend", None)
    if not any(issue.code == "missing-boundary-state" for issue in issues):
        failures.append("missing extension boundary was not detected")

    inferred_extension = (
        "@Video 1 is the source. Extend forward; the extension’s first frame "
        "continues the actual last frame."
    )
    inferred_mode, _ = lint_prompt(inferred_extension, "auto", None)
    if inferred_mode != "extend":
        failures.append("extension was misclassified as first-last")

    _, issues = lint_prompt("[Stage 1] One event. End state: complete.", "long", 31)
    if not any(issue.code == "duration-exceeds-generic-limit" for issue in issues):
        failures.append("duration above the generic 30-second limit was not detected")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "prompt",
        nargs="?",
        default="-",
        help="UTF-8 prompt file, or - for standard input",
    )
    parser.add_argument(
        "--mode",
        default="auto",
        choices=(
            "auto",
            "base",
            "reference",
            "long",
            "edit",
            "extend",
            "first-last",
            "keyframes",
            "storyboard",
            "blockout",
            "transition",
        ),
    )
    parser.add_argument(
        "--duration",
        type=float,
        help="planned duration for one generation in seconds; generic maximum is 30",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="emit JSON",
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        failures = run_self_test()
        if failures:
            for failure in failures:
                print(f"SELF-TEST FAIL: {failure}", file=sys.stderr)
            return 1
        print("Self-test passed.")
        return 0

    text = read_prompt(args.prompt)
    mode, issues = lint_prompt(text, args.mode, args.duration)
    counts = {
        severity: sum(issue.severity == severity for issue in issues)
        for severity in ("error", "warning", "info")
    }

    if args.as_json:
        print(
            json.dumps(
                {
                    "mode": mode,
                    "counts": counts,
                    "issues": [asdict(issue) for issue in issues],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"Mode: {mode}")
        if not issues:
            print("Lint passed: no structural risks detected.")
        else:
            for issue in issues:
                print(f"[{issue.severity.upper()}] {issue.code}: {issue.message}")
            print(
                "Summary: "
                f"{counts['error']} error(s), "
                f"{counts['warning']} warning(s), "
                f"{counts['info']} info note(s)."
            )

    return 1 if counts["error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

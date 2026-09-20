# Provenance

## Evaluated Source

- Repository: https://github.com/irenerachel/style-pack-skill
- Inspected commit: `20dced897a686a5e6925b868b18e931ecdf45089`
- Inspection date: 2026-07-23
- Upstream description at inspection time: a skill for extracting reusable visual style DNA and producing annotated/plain palette cards.

## License Status

At the inspected commit, GitHub reported no declared repository license and the repository tree contained no `LICENSE` file. Public visibility does not by itself grant redistribution rights.

This TapCanvas skill is therefore an independently authored adaptation of the high-level capability. It does not vendor or reproduce the upstream Python scripts, PNG examples, or substantial prose. The source URL and immutable commit are retained for provenance and future license review.

## Adaptation Notes

The evaluated source assumed local folders, Python image-processing dependencies, and several companion skills that are not part of the TapCanvas runtime. This adaptation instead uses the current agents bridge and TapCanvas project contracts:

- real project/canvas reference URLs;
- `tapcanvas_analyze_image` for visual evidence;
- `tapcanvas_flow_patch` for full style-pack persistence;
- `tapcanvas_book_style_confirm` for explicitly authorized book-level Style Bible updates;
- TapCanvas image/video generation tools for real visual delivery.

Exact pixel palette sampling and deterministic palette-card rendering are not claimed unless the runtime exposes a dedicated tool that returns verified color data and real uploaded asset URLs. This prevents semantic color estimates or generated mockups from being represented as measured deliverables.

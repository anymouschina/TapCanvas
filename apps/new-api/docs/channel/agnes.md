# Agnes AI channel

The Agnes channel exposes Agnes image and video models through New API's standard OpenAI-compatible endpoints. The adapter translates client requests to Agnes wire formats and keeps Agnes task identifiers private during polling.

## Models

| Type | Model |
| --- | --- |
| Image | `agnes-image-2.5-flash` |
| Video | `agnes-video-2.5` |
| Video | `agnes-video-2.5-flash` |

## Images

Use `POST /v1/images/generations`. `size` accepts `1K`, `2K`, `3K`, `4K`, or a pixel size. `ratio` supports `1:1`, `3:4`, `4:3`, `16:9`, `9:16`, `2:3`, `3:2`, and `21:9`.

Reference images may be supplied with the common `images` array. The adapter moves them into Agnes `extra_body.image` and translates `response_format` to the location expected by Agnes.

## Videos

Use `POST /v1/videos` and poll with the returned public task ID at `GET /v1/videos/{task_id}`.

The adapter supports the Agnes `text`, `keyframe`, and `reference` modes:

- `text` accepts prompt-only generation.
- `keyframe` accepts `first_frame` and `last_frame`; `start_frame` and `end_frame` are aliases.
- `reference` accepts `images`, `audios`, and structured `videos` entries with `url`, optional `start_seconds`, and optional `require_audio`.

Media references must be public HTTPS URLs accessible by Agnes. Optional `seed`, `n`, `start_seconds`, and `require_audio` values preserve explicit zero or false values.

`agnes-video-2.5` supports 4 to 12 seconds and 720P, 1080P, 1K, or 2K output. `agnes-video-2.5-flash` supports 4 to 12 seconds at 720P. The full model accepts up to 8 images, 3 audio references, and 1 video reference, with at most 12 references total. The flash model accepts up to 5 images and 3 audio references and does not accept video references.

---
name: tapcanvas-parse-video
description: Import a video share link or direct video URL into the current TapCanvas canvas as a hosted video node.
---

# TapCanvas video import

Use this skill when the user asks to download, import, save, or bring a video share link/video URL onto the current TapCanvas canvas.

## Execution contract

Call the remote tool `tapcanvas_parse_video_to_canvas` through the normal agents bridge. Pass exactly one of:

- `shareUrl`: a share page URL or text containing a share URL. The API sends it to the private Go `parse-video` service, which resolves the platform media URL server-side.
- `videoUrl`: an already direct `http(s)` video URL.

Optional arguments are `title`, `nodeId`, and a numeric `position` (`{x, y}`). If no position is supplied, the API uses the canvas origin. The tool downloads the media, streams it into configured object storage, registers an asset, and creates a `taskNode` with `data.kind: "video"`, a hosted `videoUrl`, and provenance metadata. A repeated import of the same URL reuses its deterministic node when it is already present.

Only report success after the tool returns `ok: true` with `nodeId` and `assetId`. The tool response is the source of truth for the canvas write; do not claim that a link was downloaded from a plan or from a text-only response.

## Scope and failure handling

- A current authorized project canvas (`canvasProjectId` and `canvasFlowId`) is required. For a chapter conversation, use the chapter canvas scope supplied by the bridge.
- Do not use browser automation, scrape the share page in the client, or write a raw URL with `tapcanvas_flow_patch`. The resolver and hosting operation must stay on the server.
- Do not silently switch to another downloader or model. If the resolver, download, object storage, or canvas write fails, surface the returned error and its code.
- A direct URL must be an absolute `http(s)` URL. Share text that cannot be resolved is an explicit parse failure.
- Importing a video is a canvas mutation, not a media-analysis request. Use `tapcanvas_fetch_video_from_url` only when the user asks to fetch a stable URL for analysis and does not ask to place it on the canvas.

## Remote callers

An external caller can invoke `/agents/tools/execute` with:

```json
{
  "toolName": "tapcanvas_parse_video_to_canvas",
  "args": { "shareUrl": "https://…", "title": "可选标题" },
  "canvasProjectId": "<project-id>",
  "canvasFlowId": "<flow-id>"
}
```

The caller must authenticate as the project user and preserve the returned `nodeId`/`assetId` as the durable result. The response `data.videoUrl` is the hosted asset URL for integrations that need it; the model-facing content intentionally reports the node and asset identifiers instead.

See [deployment.md](references/deployment.md) for the production service boundary and environment contract.

## Guided remix mode

When the request also asks to learn the reference and continue it, treat the import as the first step of a guided remix rather than ending after the download:

1. Import the source with `tapcanvas_parse_video_to_canvas` and keep the returned `nodeId` as the reference identity.
2. Use the existing video-analysis tools on that node (content/understanding, shot decomposition, and director-breakdown as needed). Keep visible observations separate from model inferences; never invent missing shots or dialogue.
3. For a selected role, first choose 2–3 evidence timestamps from the analysis and call `tapcanvas_video_extract_frames` with those timestamps. This creates real, project-owned image assets (`assetId`/`referenceId`) from the source video. Inspect the candidates with `tapcanvas_analyze_image` when the role identity or frame quality matters, then call `tapcanvas_asset_add_to_canvas` for each accepted frame with `referenceRole: "identity"` so the original pixels are visible and reusable on the current canvas. Put the factual provenance in the node data when known (`referenceType: "character"`, `characterAssetRole: "identity_evidence"`, the confirmed `roleName`, `sourceVideoNodeId`, and `sourceTimeSec`); do not promote the frame to `character-card/v3` merely by naming it. These direct frames are the default role assets for extraction and remix work; do **not** call `tapcanvas-character-card` or any image-generation tool merely because a role was extracted. Call the character-card skill only when the user explicitly asks for a canonical four-view/neutral identity board (or another downstream contract explicitly requires that derived asset), and then pass the already-verified frame IDs as references. Text-only cast descriptions are not character image assets; never fabricate a portrait when no frame evidence exists.

### Role asset decision boundary

Keep the two deliverables separate:

- **Direct evidence asset**: an exact frame from the source video, stored as a project image asset and optionally placed on the canvas. This preserves the source actor, hairstyle, clothing, lighting, expression, and continuity cues. It does not spend image-generation quota.
- **Canonical character card**: a derived `character-card/v3` / `identity-board/v3` image generated from verified references to produce a neutral four-view board. This is an optional derivative, not a prerequisite for extraction.

Use the direct evidence path when the user says “提取角色图/关键帧/原片人物/保留原片造型” or asks to use the reference for a remix. Use the canonical-card path only when the user explicitly says “生成角色卡/四视图身份板/规范化角色资产”, or a later workflow has a confirmed requirement for that exact contract. If the canonical generation fails, the verified direct evidence assets remain the valid deliverable and must still be used for the requested remix; do not retry generation or create an empty placeholder solely to replace them.
4. Persist the accepted analysis and the selected character/scene/style facts into the current project using the existing project/canvas asset tools. The imported video node remains the provenance anchor; do not overwrite it.
5. Ask for one decision at a time, only where the next production step needs user intent. A practical order is: continuation premise, characters to retain or redesign, location/scene, visual tone and camera language, target duration/aspect, dialogue/audio preference, then first-video validation or full output. Show concrete options plus a custom option, and wait for the user's answer before freezing that choice.
6. After the choices are complete, freeze the user's delivery contract with the normal agents workflow. Start the currently equipped video Workflow IR once; do not call a naked video generator or create a parallel local pipeline.
7. Continue from the workflow receipt until a real video URL is persisted on the target canvas node and delivery verification is satisfied. If the user chooses first-video validation, stop at that explicitly chosen scope and offer the next continuation choice; do not silently generate the whole film.

The reference teaches transferable mechanisms (story beats, reveal timing, lighting/camera behavior, character continuity), not a shot-for-shot copy. Replace the event causality, character circumstances, and visual identity enough to make the continuation an original work. If source evidence is incomplete, label the gap and ask whether to proceed with the verified subset; do not fill it with plausible details.

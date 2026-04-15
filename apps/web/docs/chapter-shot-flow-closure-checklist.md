# Chapter & Shot Flow Closure Checklist

## Scope

This checklist validates the chapter flow and shot flow as an end-to-end production loop instead of a navigation-only entry.

## Functional Checklist

- [ ] `chapter` entry opens an existing non-empty flow when available.
- [ ] `shot` entry opens an existing non-empty flow when available.
- [ ] When no flow exists, a starter flow is created with executable nodes (not empty canvas).
- [ ] Chapter starter includes at least context + storyboard progression nodes.
- [ ] Shot starter includes at least context + image generation nodes.
- [ ] Returned generation output is visible in chapter workbench result list.
- [ ] Selected shot result can be promoted/synced to scene memory.
- [ ] Navigation does not loop between chapter page and project directory.

## Verification Plan

1. Route & entry checks
- Open `/projects/:projectId/chapters/:chapterId`.
- Click `进入章节流程`, verify Studio opens with `ownerType=chapter` and a concrete `flowId`.
- Click `进入镜头流程`, verify Studio opens with `ownerType=shot` and a concrete `flowId`.

2. Empty-host checks
- Ensure chapter/shot host has no flows.
- Click entry button and verify a flow is created with starter nodes.
- Re-enter and verify it opens existing flow instead of creating a new one.

3. Generation linkage checks
- Run one shot flow.
- Verify output appears in chapter workbench `最近结果`.
- Select one candidate and verify promotion/sync path remains available.

4. Navigation checks
- From chapter page, click back to project directory.
- From project manager, click header back.
- Verify no chapter-directory back-loop occurs.

## Acceptance Criteria

- Entry reliability: `>= 99%` opens valid host flow (existing or starter-created).
- Empty-canvas incidence on entry: `0%` for supported chapter/shot hosts.
- Flow launch evidence recorded in session storage for both owner types.
- No cyclic navigation between chapter page and project directory in manual E2E.

## Evidence Collection

- Session storage keys:
- `tapcanvas:flow-launch:<projectId>:chapter:<chapterId>`
- `tapcanvas:flow-launch:<projectId>:shot:<shotId>`

- Each evidence item includes:
- `timestamp`
- `projectId`
- `ownerType`
- `ownerId`
- `flowId`
- `mode` (`existing` or `starter_created`)

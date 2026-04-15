# Nano Comic Workbench User Flow Diagnosis

Date: 2026-04-11
Repo: `/Users/libiqiang/workspace/TapCanvas-pro`

## Current Product Chain

1. User opens `/`
2. If there are no projects, user is redirected to `/projects`
3. User creates a project
4. User can create:
   - a blank project
   - a text-driven project with source text upload
5. User enters the project
6. If projects exist, system first routes user into `/workspace`
7. User can continue the latest chapter from the workspace dashboard
8. User enters the chapter-centered workbench
9. User manages project-level setup in the chapter workbench
10. User binds a workbench chapter to one source-book chapter
11. User inspects the chapter-scoped text window
12. User creates or edits chapter shots
13. User enters shot-level production in the same chapter page
14. User generates shot concept images and keeps one selected result
15. User can open a chapter-owned flow or a shot-owned flow in Studio
16. User can inspect current shot resource impact and batch-manage shot statuses inside the same chapter page

## What Is Now Working

- Project creation is no longer only a name field.
- Blank project and uploaded-text project both work.
- Project-level setup persists as a singleton profile asset.
- Project is now a container instead of the primary production surface.
- Chapter is the default workbench entry.
- Source book chapters can be batch-imported into workbench chapters.
- Each workbench chapter can bind to one source-book chapter.
- The chapter page shows chapter-scoped source text context:
  - title
  - summary / conflict
  - characters
  - scenes / locations
  - props
  - content preview
- Empty states and next-step guidance are visible in project management and chapter workbench.
- Shot board is no longer read-only:
  - create empty shot
  - edit shot title / summary / status
  - delete shot
- Shot-level production is now directly usable in the chapter workbench:
  - auto-build prompt from chapter + shot + style setup + source text window
  - call existing image generation pipeline
  - poll task result
  - persist generated results as project assets
  - switch selected candidate image per shot
- Workspace now acts as a production dashboard:
  - continue latest chapter
  - see bound chapter coverage
  - see chapters that already have shots
  - see failed shots and running tasks
- Studio no longer only loads project-level flow:
  - chapter-owned flow opens in chapter context
  - shot-owned flow opens in shot context
  - save path follows the active owner
- Chapter workbench now has more production management:
  - smart bind current chapter to best matching source chapter
  - batch update shot statuses for selected or filtered shots
  - inspect current scene asset and its impacted shots
  - distinguish current-chapter-produced asset from other shared asset sources

## Remaining Product Gaps

These are no longer Phase-1 blockers, but they still affect production efficiency.

### P1

- There is still no chapter archive product flow.
- There is still no one-click full-project auto-map for all imported chapters; only current-chapter smart bind exists.
- Shared resources are diagnosable now, but not yet fully split into explicit chapter-local vs project-shared browsing spaces.

### P2

- Project setup is editable, but not yet surfaced as a pinned top-level summary in project lists.
- There is no dedicated "project overview" screen that separates:
  - project setup
  - chapter directory
  - shared assets
  - production progress
- There is no health dashboard that tells the user:
  - which chapters are unbound
  - which chapters have no shots
  - which chapters are missing style confirmation

## Recommended Next Build Slice

1. Add chapter archive and richer chapter lifecycle states.
2. Add full-project source chapter auto-mapping assist across imported chapters.
3. Turn current resource diagnostics into a full scoped browser:
   - current chapter resources
   - project shared resources
   - outdated reference repair actions
4. Add shot review/approval loop above the current status machine.

## User Journey Assessment

### New user without project

Status: pass

- User enters root.
- User lands in project management.
- User sees a clear first-project CTA.

### User creating blank project

Status: pass

- User can create project container first.
- User can defer text upload.
- User can still create chapters manually.

### User creating from text

Status: pass

- User can upload source text at project creation.
- Book ingestion uses the existing pipeline.
- After entering a chapter, user can map or import source chapters.

### User entering an existing project

Status: pass

- User lands in workspace first, then can continue the latest chapter in one click.
- Context is now chapter-scoped rather than project-global.

### User trying to understand "what to do next"

Status: pass for v1

- There is explicit next-step guidance.
- The user can already go from chapter setup into shot production without leaving the page.
- Remaining gap is not absence of chain, but deeper production management on top of the chain.

## Conclusion

The chapter-centered workbench is now product-real enough for internal team usage, workflow validation, and first-round production dogfooding.

It is no longer just a schema refactor.

The highest-value unfinished area is no longer basic chapter/shot entry. It is chapter lifecycle operations, scoped resource browsing, and a richer shot review loop on top of the now-complete v1 chain.

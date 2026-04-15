# Canvas Low-Zoom Flicker Investigation

Date: 2026-04-04

## Background

When the canvas contains many nodes and the viewport is zoomed out, dragging or panning the canvas can cause node content to flicker, disappear briefly, or look like images are being dropped. The issue becomes much less obvious after zooming in.

This note records the code-level investigation, changes already applied, and the current status.

The investigation later expanded from “low-zoom viewport flicker” to a second, related symptom:

- selecting about 20 nodes
- dragging them together
- noticeable frame drops and interaction lag

## Reproduced Symptom Pattern

- Large canvas
- Many image-heavy nodes visible at the same time
- Low zoom
- Panning the viewport causes whole-node flashing, not just one overlay
- Zooming in reduces or removes the issue

## What Was Read

Main code paths reviewed:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)
- [apps/web/src/canvas/store.ts](../apps/web/src/canvas/store.ts)
- [apps/web/src/canvas/edges/OrthTypedEdge.tsx](../apps/web/src/canvas/edges/OrthTypedEdge.tsx)
- [apps/web/src/App.tsx](../apps/web/src/App.tsx)
- [apps/web/src/canvas/nodes/TaskNode.tsx](../apps/web/src/canvas/nodes/TaskNode.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/UpstreamReferenceStrip.tsx](../apps/web/src/canvas/nodes/taskNode/components/UpstreamReferenceStrip.tsx)
- [apps/web/src/domain/resource-runtime/components/ManagedImage.tsx](../apps/web/src/domain/resource-runtime/components/ManagedImage.tsx)
- [apps/web/src/domain/resource-runtime/hooks/useImageResource.ts](../apps/web/src/domain/resource-runtime/hooks/useImageResource.ts)
- [apps/web/src/domain/resource-runtime/hooks/useViewportVisibility.ts](../apps/web/src/domain/resource-runtime/hooks/useViewportVisibility.ts)
- [apps/web/src/domain/resource-runtime/services/resourceManager.ts](../apps/web/src/domain/resource-runtime/services/resourceManager.ts)
- [apps/web/src/domain/resource-runtime/services/resourceReaper.ts](../apps/web/src/domain/resource-runtime/services/resourceReaper.ts)
- [apps/web/src/styles.css](../apps/web/src/styles.css)

## Code Facts

### 1. Viewport drag state is now separate from generic move lifecycle

The canvas no longer treats every `onMoveStart/onMoveEnd` callback as a “viewport moving” signal.

Instead, the moving-viewport path now follows React Flow’s actual `paneDragging` state, which maps to drag-panning rather than generic zoom/move lifecycle events.

This matters because `onMoveStart/onMoveEnd` are not pan-only. They can also fire for zoom interactions, including wheel zoom attempts that do not materially change the viewport because min/max zoom bounds have already been reached.

That made the old `viewportMoving` signal too broad for visual degradation.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### 2. `TaskNode` already has memoization

`TaskNode` is wrapped in `React.memo` and compares `id`, `selected`, `dragging`, `data`, `width`, `height`, `isConnectable`, and `parentId`.

Relevant file:

- [apps/web/src/canvas/nodes/TaskNode.tsx](../apps/web/src/canvas/nodes/TaskNode.tsx)

This does not rule out browser compositing or image loading instability, but it lowers the probability that the whole effect is caused by normal React rerender pressure.

### 3. Main image path used to be inconsistent

Before cleanup, the main image in `ImageContent` had two overlapping paths:

- The visible main image was rendered by a raw `<img src={activeImageUrl}>`
- At the same time, the component also ran `useImageResource(...)` for the same main image
- That `useImageResource` result was not actually used as the displayed source for the main image

So the main image effectively had:

- one browser-native loading path
- one extra resource-runtime loading path

This was a strong candidate for low-zoom instability because the browser and the internal resource runtime were both participating in the same image lifecycle without a single source of truth.

Relevant file:

- [apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx)

### 4. Low zoom settings are aggressive

The canvas allows:

- `MIN_ZOOM = 0.1`
- initial fit multiplied by `DEFAULT_ZOOM_MULTIPLIER = 0.32`

At that zoom level, many more image nodes are visible simultaneously, which amplifies both browser compositing cost and image loading churn.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### 5. Node surfaces are visually expensive during pan

Task nodes and their child surfaces use multiple high-cost effects:

- `backdrop-filter`
- `filter: blur(...)`
- large `box-shadow`
- overlay sheen animations
- floating toolbars and generation overlays

When many nodes are visible inside a transformed `ReactFlow` viewport, these effects are expensive to composite.

Relevant files:

- [apps/web/src/canvas/nodes/TaskNode.tsx](../apps/web/src/canvas/nodes/TaskNode.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx)
- [apps/web/src/styles.css](../apps/web/src/styles.css)

### 6. The viewport layer previously had global `will-change: transform`

The `React Flow` viewport had a global `will-change: transform`.

For a large, zoomed-out canvas, this can push the whole viewport into a more aggressive compositor path. In practice, that can help sometimes, but it can also worsen flicker or texture instability when the scene is very heavy.

Relevant file:

- [apps/web/src/styles.css](../apps/web/src/styles.css)

### 7. Resource trimming is not the primary suspect for this exact symptom

The resource runtime does have trimming and release logic, but the current trim strategy only reaps entries with `refCount <= 0`.

That means an actively owned image should not be trimmed just because the viewport is moving.

Relevant files:

- [apps/web/src/domain/resource-runtime/services/resourceManager.ts](../apps/web/src/domain/resource-runtime/services/resourceManager.ts)
- [apps/web/src/domain/resource-runtime/services/resourceReaper.ts](../apps/web/src/domain/resource-runtime/services/resourceReaper.ts)

This does not fully eliminate resource-runtime involvement, but it makes “budget trim deletes visible images during pan” less likely as the first-order cause.

### 8. Multi-select drag had real hot-path work in `store.onNodesChange`

During drag frames, `store.onNodesChange` still had to inspect and normalize the change set. Before the recent fast path, plain drag ticks could still flow into heavier work such as:

- parent ordering
- persistence sanitization
- edge sanitation checks
- history bookkeeping

This matters because drag emits high-frequency position updates.

Relevant file:

- [apps/web/src/canvas/store.ts](../apps/web/src/canvas/store.ts)

### 9. `Canvas` had position-agnostic full-graph work tied directly to `nodes`

Two concrete examples:

- the resource cleanup effect scanned every node and recalculated each node’s primary image URL on every `nodes` change, even when only positions changed
- selection-derived state (`selectedCanvasNodes`, group/layout affordances, etc.) was rebuilt from `nodes.filter(...)` on each drag tick

These are not the only costs in drag, but they are avoidable because the dragged positions do not change node image ownership or selection semantics.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### 10. `OrthTypedEdge` is still the heaviest remaining edge implementation

Each orth edge subscribes to the full `nodes` list and rebuilds obstacle geometry from all nodes in order to route around them.

That means orth routing cost scales roughly with:

- number of orth edges
- multiplied by number of nodes used as obstacles

The current drag path now forces a typed-edge display route during interaction to avoid paying that cost while dragging, but the orth implementation remains a known hotspot outside the drag fast path.

Relevant file:

- [apps/web/src/canvas/edges/OrthTypedEdge.tsx](../apps/web/src/canvas/edges/OrthTypedEdge.tsx)

### 11. Zoom-triggered flashing was caused by conflating zoom with pan

`viewportMoving` was being used for:

- root-level visual downgrade
- hiding the selection action bar
- forcing drag-time typed-edge rendering
- pausing resource-runtime background work

Because that flag was previously driven directly from `onMoveStart/onMoveEnd`, zoom interactions also activated the same path.

This was especially visible when zoom was already at its upper bound:

- the wheel gesture still fired move lifecycle callbacks
- the viewport might not change in any meaningful way
- but the whole canvas still switched into the “moving” visual mode and back

That is a direct recipe for flashing.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### 12. Multi-select still had one global selection computation per mounted `TaskNode`

After the earlier selected-toolbar suppression, `TaskNode` still computed `selectedNodeCount` by subscribing to the store and reducing over the full `nodes` array.

Because that logic lived inside each mounted task node, the same full-array selection count work was repeated once per node instance.

That is directly relevant to:

- box-select
- select-all
- dragging a large selected set

Relevant file:

- [apps/web/src/canvas/nodes/TaskNode.tsx](../apps/web/src/canvas/nodes/TaskNode.tsx)

### 13. Full-select flashing still had a concrete edge-style source

`Canvas.viewEdges` was still rewriting edge style for visible edges based on whether they touched any selected node.

For single-node focus that is reasonable, but for select-all it effectively means:

- almost every visible edge becomes “active”
- every edge receives a fresh style object
- every edge opacity transition runs together

That is a direct whole-canvas flashing vector on dense graphs.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### 14. Child components were still treating generic `selected` as an interaction upgrade

Even after suppressing the top-level selected toolbars, several node child components still used `selected` directly to switch into higher-cost interaction modes.

Examples included:

- image subviews raising resource priority
- text nodes becoming `contentEditable`
- storyboard editor toolbars mounting

On multi-select or select-all, that turns a pure selection state change into a broad “enter edit / enter high-priority resource mode” wave.

Relevant files:

- [apps/web/src/canvas/nodes/TaskNode.tsx](../apps/web/src/canvas/nodes/TaskNode.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/TextContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/TextContent.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/StoryboardEditorContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/StoryboardEditorContent.tsx)

## Changes Applied

### A. Main image loading path simplified

In `ImageContent`:

- removed the extra `useImageResource(...)` path for the main visible image
- removed the viewport-visibility gate from the main visible image
- kept the main visible image on a single direct source path

Relevant file:

- [apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx)

### B. Main visible image loading made more stable

In `ImageContent`:

- main image `loading` changed to `eager`

This reduces low-zoom cases where the browser repeatedly reevaluates whether many tiny images should stay lazily loaded while the viewport is being transformed.

Relevant file:

- [apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx)

### C. Viewport-moving visual downgrade kept in place

During viewport movement, expensive node-level visual effects are disabled:

- blur
- backdrop-filter
- heavy box-shadow
- sheen animation
- some floating node toolbars

Relevant file:

- [apps/web/src/styles.css](../apps/web/src/styles.css)

### D. Global viewport `will-change: transform` removed

The unconditional compositor hint on `.react-flow__viewport` was removed.

Relevant file:

- [apps/web/src/styles.css](../apps/web/src/styles.css)

### E. Pure drag move fast path added to `store.onNodesChange`

For plain drag frames, the store now returns early after applying the position changes, instead of flowing through the heavier reorder/sanitize/strip path.

History is still captured at drag start, but ordinary drag ticks avoid the extra work.

Relevant file:

- [apps/web/src/canvas/store.ts](../apps/web/src/canvas/store.ts)

### F. Drag-time edge path downgraded to lightweight typed edges

During node drag or viewport movement:

- edge display is forced to `typed`
- orth edge routing work is skipped
- drag-time edge rewrites are memoized separately from the normal styled-edge path

This keeps the expensive orth routing out of the interaction hot path.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### G. Resource ownership tracking detached from position-only node updates

The resource cleanup effect no longer depends on the full `nodes` array directly.

Instead, it tracks a derived list of:

- `nodeId`
- `primaryImageUrl`

So a position-only drag no longer causes the whole canvas to rescan node image bindings for resource release bookkeeping.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### H. Selection-derived action state detached from drag-frame position churn

Selection action affordances now derive from stable selected-node summaries instead of repeatedly filtering the full `nodes` list for every drag frame.

In addition, selection-only affordances such as:

- create group
- create script bundle
- layout selection
- matched group detection

now short-circuit during active drag, because those controls are not meaningfully actionable mid-drag.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### I. Drag-specific global visual downgrade was attempted and then rolled back

An attempted optimization applied the same global visual flattening used for viewport pan to node dragging as well.

That reduced compositing cost, but it introduced an obvious regression:

- when drag starts or ends, many node surfaces switch visual state at once
- that state jump itself presents as whole-canvas flashing

So the drag-specific global downgrade was removed again. The viewport-pan downgrade remains.

Relevant files:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)
- [apps/web/src/styles.css](../apps/web/src/styles.css)

### J. App-level node label tracking now skips untouched node objects

`App.tsx` keeps a `nodeLabelById` map for UI surfaces outside the canvas. Its change detector now exits early for unchanged node references, which trims some unnecessary label work during drag.

Relevant file:

- [apps/web/src/App.tsx](../apps/web/src/App.tsx)

### K. `viewportMoving` now follows actual pane dragging instead of generic move lifecycle

The canvas now derives `viewportMoving` from React Flow’s `paneDragging` store state instead of toggling it unconditionally inside `onMoveStart/onMoveEnd`.

This keeps the “moving viewport” optimization path scoped to real drag-panning, and prevents zoom gestures from triggering:

- root visual downgrade
- edge rerouting downgrade
- overlay hiding

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### L. Large multi-selection now suppresses heavy per-node selected UI

When many nodes were selected at once, each selected node could mount its own selected-state UI at the same time, including:

- top toolbar
- bottom toolbar
- upstream preview
- upstream reference strip
- text inline toolbar
- resize handle

This creates a visible flash wave and a large burst of render work during “select all” or box-select.

The current rule is:

- keep the visual selected state
- only mount heavy selected UI when the node is the sole active selection

Relevant file:

- [apps/web/src/canvas/nodes/TaskNode.tsx](../apps/web/src/canvas/nodes/TaskNode.tsx)

### M. MiniMap drag now uses React Flow built-in pannable behavior

The previous MiniMap interaction depended on root-level mouse handlers plus custom drag bookkeeping.

That path was brittle and easy to break while adjusting viewport interaction state.

The current implementation switches back to React Flow’s built-in MiniMap pan support:

- `pannable`
- explicit `onClick`
- explicit `onNodeClick`

This removes the custom root-level MiniMap drag bookkeeping and lets the library own the drag behavior.

In the same area, the panel positioning CSS now matches the actual `bottom-left` placement used in `Canvas.tsx`. Before that correction, the MiniMap and Controls custom offsets were targeting the wrong corner selector and could overlap in the lower-left area.

Relevant file:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)

### N. Selection count is now computed once at canvas scope and shared through context

The canvas now computes `selectedNodeCount` once and shares it through a lightweight render context.

`TaskNode` no longer performs its own repeated full-graph selection count.

This specifically targets the “框选 20 个节点后拖动明显卡顿” path, because drag ticks no longer force every mounted node to rescan the full node list just to know whether it is in a single-selection state.

Relevant files:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)
- [apps/web/src/canvas/CanvasRenderContext.tsx](../apps/web/src/canvas/CanvasRenderContext.tsx)
- [apps/web/src/canvas/nodes/TaskNode.tsx](../apps/web/src/canvas/nodes/TaskNode.tsx)

### O. Edge focus styling now only applies to single-node selection

The selected-edge highlight path now only runs when exactly one node is selected.

For multi-selection or select-all:

- `viewEdges` no longer treats every connected edge as active
- the fast path can return routed edges directly when no visibility filter is active
- edge opacity transitions are disabled under heavy selection

This removes a concrete full-select flash source instead of trying to mask it with more fallback visual degradation.

Relevant files:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)
- [apps/web/src/styles.css](../apps/web/src/styles.css)

### P. Large multi-node drag now uses a narrower flattening path

The previous drag-specific flattening attempt was too broad and introduced its own flash regression.

The current version only enables a lighter flattening mode when:

- dragging is active
- the selected-node count is large enough to matter

and it only targets the expensive transformed node surfaces:

- translucent node/image shells
- image blur underlays
- generation overlay sheen

It does not hide the whole node or switch all node chrome on and off.

Relevant files:

- [apps/web/src/canvas/Canvas.tsx](../apps/web/src/canvas/Canvas.tsx)
- [apps/web/src/styles.css](../apps/web/src/styles.css)

### Q. Child interaction upgrades now only happen for single selection

`TaskNode` now passes single-selection state into the heavy interaction subcomponents instead of raw `selected`.

That means multi-select still preserves selection semantics, but it no longer causes:

- image candidate previews to re-prioritize as if each node were the primary focus
- text nodes to all become editable together
- storyboard editors to all mount their own selected-state toolbar

Relevant files:

- [apps/web/src/canvas/nodes/TaskNode.tsx](../apps/web/src/canvas/nodes/TaskNode.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/TextContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/TextContent.tsx)
- [apps/web/src/canvas/nodes/taskNode/components/StoryboardEditorContent.tsx](../apps/web/src/canvas/nodes/taskNode/components/StoryboardEditorContent.tsx)

## Validation

Targeted tests passed after the changes:

- `imageVisibility.test.ts`
- `resourceManager.test.ts`
- `bodyPortal.test.tsx`

Additional validation:

- filtered `tsc` output did not report new errors in `Canvas.tsx` or `App.tsx`
- `pnpm --filter @tapcanvas/web build` is still blocked by pre-existing environment/repo issues:
  - missing production `VITE_API_BASE` unless explicitly injected
  - unresolved import at `apps/web/src/ui/chat/tutorialContent.ts` for `ai-metadata/workflow-patterns/index.json`
- `pnpm --filter @tapcanvas/web exec tsc --noEmit --pretty false` is still blocked by many pre-existing repo-level type errors outside this investigation slice

Type checking for the full web app was not clean, but the remaining failures observed in this pass were outside the files changed for this investigation.

## Current Status

User feedback after the earlier low-zoom fixes:

- “不怎么卡了”

That meant the first round removed a meaningful part of the instability, but it did not close the issue.

The second round then targeted the separate “20-node drag lag” path.

This should improve:

- multi-select drag smoothness
- drag-time edge cost
- unnecessary resource bookkeeping during drag
- drag-time visual compositing load

## Most Likely Remaining Work

If the issue needs to be pushed further down, the next steps should be evidence-driven and continue from the current findings:

1. Rework `OrthTypedEdge` so obstacle computation is shared or centrally memoized instead of each orth edge rebuilding geometry from the full node list.
2. Capture browser-side profiling on the exact “select 20 nodes and drag” case to verify whether the next bottleneck is edge routing, node paint/compositing, or remaining app-level subscriptions.
3. Review whether very low zoom and active drag should use an even lighter presentation mode by design, because `MIN_ZOOM = 0.1` plus dense media nodes still creates an unusually large on-screen surface count.

## Summary

The investigation did not support a “pure React rerender storm” explanation.

The strongest code-backed causes were:

- an inconsistent main-image loading path
- very heavy node compositing cost at low zoom
- an over-aggressive compositor hint on the whole viewport

The current mitigation improved the behavior, but this should still be treated as an ongoing canvas-performance issue rather than a fully closed bug.

The clearest remaining architectural hotspot is still orth-edge routing.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('viewport-moving handle geometry', () => {
  it('hides handles without removing their measurable layout boxes', () => {
    const cssPath = resolve(process.cwd(), 'src/canvas/CanvasInteractionPerformance.css')
    const css = readFileSync(cssPath, 'utf8')
    const handleRules = css
      .split('}')
      .filter((rule) => rule.includes(".tc-canvas[data-viewport-moving='true'] .react-flow__node:not(.selected) .react-flow__handle"))

    expect(handleRules).toHaveLength(1)
    expect(handleRules[0]).toContain('visibility: hidden !important')
    expect(handleRules[0]).not.toContain('display: none')
  })

  it('keeps the focused node and its open toolbars visually stable during canvas motion', () => {
    const cssPath = resolve(process.cwd(), 'src/canvas/CanvasInteractionPerformance.css')
    const css = readFileSync(cssPath, 'utf8')

    expect(css).not.toContain("[data-viewport-moving='true'] .react-flow__node-toolbar")
    expect(css).not.toContain("[data-viewport-moving='true'] .top-toolbar")
    expect(css).not.toContain("[data-viewport-moving='true'] .tc-task-node__focus-toolbar")
    expect(css).toContain("[data-viewport-moving='true'] .react-flow__node:not(.selected)")
    expect(css).not.toContain("[data-viewport-moving='true'] .react-flow__node *")
  })

  it('freezes screen-space selection overlays during canvas motion', () => {
    const cssPath = resolve(process.cwd(), 'src/canvas/CanvasInteractionPerformance.css')
    const css = readFileSync(cssPath, 'utf8')

    expect(css).toContain(".tc-canvas[data-viewport-moving='true'] .tc-canvas__selection-action-bar")
    expect(css).toContain(".tc-canvas[data-dragging='true'] .tc-canvas__selection-connect-btn")
    expect(css).toContain('pointer-events: none !important')
  })

  it('keeps decoded video frames painted throughout canvas motion', () => {
    const cssPath = resolve(process.cwd(), 'src/canvas/CanvasInteractionPerformance.css')
    const css = readFileSync(cssPath, 'utf8')

    expect(css).not.toContain("[data-viewport-moving='true'] .tc-task-node__video-player")
    expect(css).not.toContain("[data-dragging='true'] .tc-task-node__video-player")
  })

  it('does not permanently promote the canvas-sized viewport layer', () => {
    const cssPath = resolve(process.cwd(), 'src/canvas/CanvasInteractionPerformance.css')
    const css = readFileSync(cssPath, 'utf8')
    const globalCssPath = resolve(process.cwd(), 'src/styles.css')
    const globalCss = readFileSync(globalCssPath, 'utf8')

    expect(css).not.toContain('.tc-canvas__flow .react-flow__viewport')
    expect(globalCss).not.toContain('.tc-canvas__flow .react-flow__viewport')
    const movingNodeRules = css
      .split('}')
      .filter((rule) => rule.includes(".tc-canvas[data-viewport-moving='true'] .react-flow__node"))
    expect(movingNodeRules.every((rule) => !rule.includes('contain:'))).toBe(true)
  })
})

describe('node selection feedback', () => {
  it('paints selection outside node geometry and disables the transition while moving', () => {
    const cssPath = resolve(process.cwd(), 'src/styles.css')
    const css = readFileSync(cssPath, 'utf8')
    expect(css).toContain('.tc-canvas .react-flow__node-taskNode.selected::after')
    expect(css).toContain('border-color: var(--tc-color-border-strong')
    expect(css).toContain('opacity: 1')
    expect(css).toContain(".tc-canvas[data-viewport-moving='true'] .react-flow__node-taskNode::after")
    expect(css).toContain('inset: -3px')
    expect(css).toContain('pointer-events: none')
  })
})

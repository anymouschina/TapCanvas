import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourcePath = resolve(process.cwd(), 'src/projects/ChapterCanvasFullPage.tsx')

describe('ChapterCanvasFullPage task inbox mounting contract', () => {
  it('mounts the task inbox panel next to the chapter floating navigation', () => {
    const source = readFileSync(sourcePath, 'utf8')
    expect(source).toContain("import TaskInboxPanel from '../ui/TaskInboxPanel'")
    expect(source).toContain('<TaskInboxPanel />')
  })
})

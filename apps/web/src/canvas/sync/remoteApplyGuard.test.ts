import { describe, it, expect } from 'vitest'
import { derivedApplyGuard, remoteApplyGuard } from './remoteApplyGuard'

// 共享守卫：标记「当前 store 改动来自应用远端(SSE)patch」而非本地编辑。
// 跨模块共享(useCanvasSync 设置、ChapterCanvasPage autosave 订阅读取),
// 让整图 autosave 能跳过远端引发的变更,断掉「SSE patch→整图 PUT→409 乒乓」。
describe('remoteApplyGuard', () => {
  it('默认非激活', () => {
    expect(remoteApplyGuard.active).toBe(false)
  })

  it('run() 期间激活,结束后复位', () => {
    let inside = false
    remoteApplyGuard.run(() => {
      inside = remoteApplyGuard.active
    })
    expect(inside).toBe(true)
    expect(remoteApplyGuard.active).toBe(false)
  })

  it('嵌套计数:内层结束仍保持激活,全部结束才复位', () => {
    remoteApplyGuard.begin()
    remoteApplyGuard.begin()
    expect(remoteApplyGuard.active).toBe(true)
    remoteApplyGuard.end()
    expect(remoteApplyGuard.active).toBe(true)
    remoteApplyGuard.end()
    expect(remoteApplyGuard.active).toBe(false)
  })

  it('run() 即使回调抛错也复位', () => {
    expect(() =>
      remoteApplyGuard.run(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(remoteApplyGuard.active).toBe(false)
  })

  it('end() 多调不会变成负计数', () => {
    remoteApplyGuard.end()
    remoteApplyGuard.end()
    expect(remoteApplyGuard.active).toBe(false)
    remoteApplyGuard.begin()
    expect(remoteApplyGuard.active).toBe(true)
    remoteApplyGuard.end()
    expect(remoteApplyGuard.active).toBe(false)
  })
})

describe('derivedApplyGuard', () => {
  it('tracks derived mutations independently from remote application', () => {
    expect(derivedApplyGuard.active).toBe(false)
    expect(remoteApplyGuard.active).toBe(false)

    derivedApplyGuard.run(() => {
      expect(derivedApplyGuard.active).toBe(true)
      expect(remoteApplyGuard.active).toBe(false)
    })

    expect(derivedApplyGuard.active).toBe(false)
  })
})

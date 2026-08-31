import { describe, it, expect } from 'vitest'
import {
  isEligibleForGlobalStyleReference,
  mergeGlobalStyleReferenceImages,
  mergeGlobalStylePrompt,
} from './globalStyleReferenceInjection'

// 锁定「空项目随手文生图跟随全局画风、但不污染已有锚定」的契约。
describe('isEligibleForGlobalStyleReference', () => {
  const base = {
    isImageTask: true,
    isRoleCardTask: false,
    sourceTag: '',
    visibleCompositeOnlyReference: false,
    hasFocusGuide: false,
    hasExplicitStyleAssetInput: false,
  }

  it('普通文生图节点合格', () => {
    expect(isEligibleForGlobalStyleReference(base)).toBe(true)
  })

  it('非图片任务不注入', () => {
    expect(isEligibleForGlobalStyleReference({ ...base, isImageTask: false })).toBe(false)
  })

  it('角色卡任务跳过（自带风格锚定）', () => {
    expect(isEligibleForGlobalStyleReference({ ...base, isRoleCardTask: true })).toBe(false)
  })

  it.each(['storyboard_shot_split', 'novel_storyboard_group', 'storyboard_shot_node'])(
    '故事板分镜来源 %s 跳过（一致性锁）',
    (sourceTag) => {
      expect(isEligibleForGlobalStyleReference({ ...base, sourceTag })).toBe(false)
    },
  )

  it('局部编辑(visibleCompositeOnly)与精修(focusGuide)跳过', () => {
    expect(isEligibleForGlobalStyleReference({ ...base, visibleCompositeOnlyReference: true })).toBe(false)
    expect(isEligibleForGlobalStyleReference({ ...base, hasFocusGuide: true })).toBe(false)
  })

  it('节点已显式声明 style 资产输入时跳过，避免双重注入', () => {
    expect(isEligibleForGlobalStyleReference({ ...base, hasExplicitStyleAssetInput: true })).toBe(false)
  })
})

describe('mergeGlobalStyleReferenceImages', () => {
  const noSelf = new Set<string>()

  it('空项目无其他参考：全局风格图直接成为参考', () => {
    const r = mergeGlobalStyleReferenceImages({
      referenceImages: [],
      globalStyleRefs: ['https://cdn/style.webp'],
      selfOwnedImageUrls: noSelf,
      hardLimit: 3,
    })
    expect(r.referenceImages).toEqual(['https://cdn/style.webp'])
    expect(r.injectedCount).toBe(1)
    expect(r.styleUrls).toEqual(['https://cdn/style.webp'])
  })

  it('风格图固定置于已有参考之后（画风锚定=最后一张约定）、去重、限 hardLimit', () => {
    const r = mergeGlobalStyleReferenceImages({
      referenceImages: ['a', 'b', 'c'],
      globalStyleRefs: ['style1'],
      selfOwnedImageUrls: noSelf,
      hardLimit: 3,
    })
    expect(r.referenceImages).toEqual(['a', 'b', 'style1'])
    expect(r.injectedCount).toBe(1)
    expect(r.styleUrls).toEqual(['style1'])
  })

  it('剔除节点自有产物，不把自己当参考', () => {
    const r = mergeGlobalStyleReferenceImages({
      referenceImages: ['a'],
      globalStyleRefs: ['self', 'style1'],
      selfOwnedImageUrls: new Set(['self']),
      hardLimit: 3,
    })
    expect(r.referenceImages).toEqual(['a', 'style1'])
    expect(r.injectedCount).toBe(1)
    expect(r.styleUrls).toEqual(['style1'])
  })

  it('全局风格与已有参考重复时只保留一份（挪到末尾）、不重复计数', () => {
    const r = mergeGlobalStyleReferenceImages({
      referenceImages: ['style1', 'a'],
      globalStyleRefs: ['style1'],
      selfOwnedImageUrls: noSelf,
      hardLimit: 3,
    })
    expect(r.referenceImages).toEqual(['a', 'style1'])
    expect(r.injectedCount).toBe(1)
    expect(r.styleUrls).toEqual(['style1'])
  })

  it('无全局风格图：原样返回、零注入', () => {
    const r = mergeGlobalStyleReferenceImages({
      referenceImages: ['a', 'b'],
      globalStyleRefs: [],
      selfOwnedImageUrls: noSelf,
      hardLimit: 3,
    })
    expect(r.referenceImages).toEqual(['a', 'b'])
    expect(r.injectedCount).toBe(0)
    expect(r.styleUrls).toEqual([])
  })

  it('名额不足时优先保住风格图（截断内容参考），按实际进入数计注入', () => {
    const r = mergeGlobalStyleReferenceImages({
      referenceImages: ['a'],
      globalStyleRefs: ['s1', 's2', 's3', 's4'],
      selfOwnedImageUrls: noSelf,
      hardLimit: 3,
    })
    expect(r.referenceImages).toEqual(['s1', 's2', 's3'])
    expect(r.injectedCount).toBe(3)
    expect(r.styleUrls).toEqual(['s1', 's2', 's3'])
  })

  it('内容参考+风格图共存且超限：内容参考在前被截断，风格图完整保留在末尾', () => {
    const r = mergeGlobalStyleReferenceImages({
      referenceImages: ['a', 'b', 'c'],
      globalStyleRefs: ['s1', 's2'],
      selfOwnedImageUrls: noSelf,
      hardLimit: 3,
    })
    expect(r.referenceImages).toEqual(['a', 's1', 's2'])
    expect(r.injectedCount).toBe(2)
    expect(r.styleUrls).toEqual(['s1', 's2'])
  })
})

describe('mergeGlobalStylePrompt', () => {
  it('合格且有文字风格：追加到 prompt 末尾', () => {
    expect(
      mergeGlobalStylePrompt({ basePrompt: '一只猫', stylePrompt: '低饱和胶片质感', eligible: true }),
    ).toBe('一只猫\n\n低饱和胶片质感')
  })

  it('不合格（节点自带风格/角色卡等）：原样返回不注入', () => {
    expect(
      mergeGlobalStylePrompt({ basePrompt: '一只猫', stylePrompt: '低饱和胶片质感', eligible: false }),
    ).toBe('一只猫')
  })

  it('文字风格为空：原样返回', () => {
    expect(mergeGlobalStylePrompt({ basePrompt: '一只猫', stylePrompt: '   ', eligible: true })).toBe('一只猫')
  })

  it('已包含该文字：不重复追加', () => {
    expect(
      mergeGlobalStylePrompt({ basePrompt: '一只猫，低饱和胶片质感', stylePrompt: '低饱和胶片质感', eligible: true }),
    ).toBe('一只猫，低饱和胶片质感')
  })

  it('空 basePrompt：直接用文字风格', () => {
    expect(mergeGlobalStylePrompt({ basePrompt: '', stylePrompt: '胶片质感', eligible: true })).toBe('胶片质感')
  })
})

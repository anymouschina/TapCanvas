import { describe, expect, it } from 'vitest'
import type { ModelCatalogModelDto } from '../../src/api/server'
import {
  filterHiddenOptionsByKind,
  findModelOptionByIdentifier,
  getModelOptionRequestAlias,
  resolveExecutableImageModelFromOptions,
  toCatalogModelOptions,
} from '../../src/config/useModelOptions'

describe('model catalog options', () => {
  const catalogRows: ModelCatalogModelDto[] = [
    {
      modelKey: 'gemini-3-pro-image-preview',
      vendorKey: 'yunwu',
      modelAlias: 'nano-banana-pro',
      labelZh: 'Nano Banana Pro',
      kind: 'image',
      enabled: true,
      createdAt: '2026-03-24T00:00:00.000Z',
      updatedAt: '2026-03-24T00:00:00.000Z',
    },
    {
      modelKey: 'gpt-5.2',
      vendorKey: 'openai',
      modelAlias: 'tap-gpt-5.2',
      labelZh: 'GPT-5.2',
      kind: 'text',
      enabled: true,
      createdAt: '2026-03-24T00:00:00.000Z',
      updatedAt: '2026-03-24T00:00:00.000Z',
    },
  ]

  it('uses the real model key as option value and keeps alias metadata', () => {
    const options = toCatalogModelOptions(catalogRows)
    expect(options[0]).toMatchObject({
      value: 'gemini-3-pro-image-preview',
      label: 'nano-banana-pro',
      modelKey: 'gemini-3-pro-image-preview',
      modelAlias: 'nano-banana-pro',
    })
  })

  it('keeps aliased image options visible even when the real model key matches a hidden raw image pattern', () => {
    const options = toCatalogModelOptions([
      {
        modelKey: 'gemini-2.5-flash-image',
        vendorKey: 'yunwu',
        modelAlias: 'nano-banana-fast',
        labelZh: 'Nano Banana Fast',
        kind: 'image',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
      {
        modelKey: 'gemini-2.5-flash-image',
        vendorKey: 'yunwu',
        modelAlias: null,
        labelZh: 'Gemini 2.5 Flash Image',
        kind: 'image',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ])
    const visible = filterHiddenOptionsByKind(options, 'image')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({
      value: 'gemini-2.5-flash-image',
      label: 'nano-banana-fast',
      modelAlias: 'nano-banana-fast',
    })
  })

  it('matches the same option by real key or alias', () => {
    const options = toCatalogModelOptions(catalogRows)
    expect(findModelOptionByIdentifier(options, 'gemini-3-pro-image-preview')?.label).toBe('nano-banana-pro')
    expect(findModelOptionByIdentifier(options, 'nano-banana-pro')?.value).toBe('gemini-3-pro-image-preview')
  })

  it('prefers alias for alias-based request fields and falls back to model key', () => {
    const options = toCatalogModelOptions(catalogRows)
    expect(getModelOptionRequestAlias(options, 'gpt-5.2')).toBe('tap-gpt-5.2')
    expect(getModelOptionRequestAlias([], 'gemini-2.5-pro')).toBe('gemini-2.5-pro')
  })

  it('canonicalizes a stored alias to the executable model key without fallback', () => {
    const options = toCatalogModelOptions(catalogRows)
    const resolved = resolveExecutableImageModelFromOptions(options, {
      kind: 'image',
      value: 'nano-banana-pro',
    })
    expect(resolved).toMatchObject({
      value: 'gemini-3-pro-image-preview',
      didFallback: false,
      shouldWriteBack: true,
      reason: 'canonicalized',
      source: 'requested',
    })
  })

  it('falls back to the default image model when the stored model is unavailable', () => {
    const options = toCatalogModelOptions([
      {
        modelKey: 'gemini-3.1-flash-image-preview',
        vendorKey: 'gemini',
        modelAlias: null,
        labelZh: 'Gemini 3.1 Flash Image Preview',
        kind: 'image',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
      {
        modelKey: 'gemini-2.5-flash-image',
        vendorKey: 'gemini',
        modelAlias: 'nano-banana-fast',
        labelZh: 'Nano Banana Fast',
        kind: 'image',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ])
    const resolved = resolveExecutableImageModelFromOptions(options, {
      kind: 'image',
      value: 'legacy-image-model',
    })
    expect(resolved).toMatchObject({
      value: 'gemini-3.1-flash-image-preview',
      vendor: 'gemini',
      didFallback: true,
      shouldWriteBack: true,
      reason: 'unavailable',
      source: 'default',
    })
  })
})

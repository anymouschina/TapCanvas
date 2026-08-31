import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { resolveDefaultCatalogModelOption } from './defaultCatalogModel'

const options: ModelOption[] = [
  { value: 'catalog-first', label: '目录第一项', vendor: 'first-vendor' },
  { value: 'catalog-second', label: '目录第二项', vendor: 'second-vendor' },
]

describe('resolveDefaultCatalogModelOption', () => {
  it('selects the first model in catalog response order for an empty node', () => {
    expect(resolveDefaultCatalogModelOption({
      currentValue: '',
      options,
      loading: false,
      error: null,
    })).toBe(options[0])
  })

  it('preserves an explicit model already stored on the node', () => {
    expect(resolveDefaultCatalogModelOption({
      currentValue: 'catalog-second',
      options,
      loading: false,
      error: null,
    })).toBeNull()
  })

  it('does not invent a default while the catalog is unavailable', () => {
    expect(resolveDefaultCatalogModelOption({
      currentValue: '',
      options,
      loading: true,
      error: null,
    })).toBeNull()
    expect(resolveDefaultCatalogModelOption({
      currentValue: '',
      options,
      loading: false,
      error: new Error('catalog unavailable'),
    })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { createMaskEditSourcePng } from './maskEditAssets'

describe('createMaskEditSourcePng', () => {
  it('rejects a missing source before attempting an upload or conversion', async () => {
    await expect(createMaskEditSourcePng('   ')).rejects.toThrow('缺少真实源图片')
  })
})

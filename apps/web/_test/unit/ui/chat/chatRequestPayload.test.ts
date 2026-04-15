import { describe, expect, it } from 'vitest'

import {
  buildSelectedImageAssetInputs,
  resolveChatRequestExecution,
} from '../../../../src/ui/chat/chatRequestPayload'

describe('chatRequestPayload', () => {
  it('preserves selected image asset roles and anchor metadata', () => {
    const assetInputs = buildSelectedImageAssetInputs(
      [
        {
          assetId: 'asset-role-1',
          url: 'https://example.com/role-card.png',
          role: 'character',
          note: '章节已确认角色卡锚点',
          name: '李长安',
        },
        {
          assetId: 'asset-shot-1',
          url: 'https://example.com/shot-anchor.png',
          role: 'context',
          note: '场景/镜头锚点',
        },
      ],
    )

    expect(assetInputs).toEqual([
      {
        assetId: 'asset-role-1',
        url: 'https://example.com/role-card.png',
        role: 'character',
        note: '章节已确认角色卡锚点',
        name: '李长安',
      },
      {
        assetId: 'asset-shot-1',
        url: 'https://example.com/shot-anchor.png',
        role: 'context',
        note: '场景/镜头锚点',
      },
    ])
  })

  it('does not let project text evidence heuristics disable explicit auto mode', () => {
    const execution = resolveChatRequestExecution()

    expect(execution).toEqual({
      mode: 'auto',
      forceAssetGeneration: false,
    })
  })

  it('enters auto mode for canvas-scoped turns by default', () => {
    const execution = resolveChatRequestExecution()

    expect(execution).toEqual({
      mode: 'auto',
      forceAssetGeneration: false,
    })
  })
})

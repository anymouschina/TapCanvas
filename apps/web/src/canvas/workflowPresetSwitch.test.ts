import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { buildWorkflowPresetPatches, readWorkflowPresetSwitchContract, type WorkflowPreset } from './workflowPresetSwitch'

const presets: WorkflowPreset[] = [
  { key: 'first', name: '第一套', themeBrief: '把小游戏改成森林猫主题', layoutAssetId: 'layout-1', styleAssetId: 'style-1' },
  { key: 'second', name: '第二套', themeBrief: '把小游戏改成海底寻宝主题', layoutAssetId: 'layout-2', styleAssetId: 'style-2' },
]

function buildNodes(): Node[] {
  return [
    { id: 'group', type: 'groupNode', position: { x: 0, y: 0 }, data: {} },
    { id: 'selector', type: 'taskNode', parentId: 'group', position: { x: 0, y: 0 }, data: { workflowPresetSelectorVersion: 2, presets, activePresetKey: 'first', imageGenerationNodeId: 'image-generation', layoutNodeId: 'layout', styleNodeId: 'style' } },
    { id: 'image-generation', type: 'taskNode', parentId: 'group', position: { x: 0, y: 0 }, data: { kind: 'workflowStage' } },
    { id: 'layout', type: 'taskNode', parentId: 'group', position: { x: 0, y: 0 }, data: { kind: 'image' } },
    { id: 'style', type: 'taskNode', parentId: 'group', position: { x: 0, y: 0 }, data: { kind: 'image' } },
  ]
}

describe('workflowPresetSwitch', () => {
  it('rejects an incomplete target-node contract before producing patches', () => {
    expect(() => readWorkflowPresetSwitchContract({ selectorNodeId: 'selector', nodes: buildNodes().filter((node) => node.id !== 'style') })).toThrow('工作流目标节点合同不完整')
  })

  it('rejects the entire switch when any target node is read-only', () => {
    const nodes = buildNodes().map((node) => node.id === 'image-generation' ? { ...node, data: { ...node.data, readOnly: true } } : node)
    expect(() => readWorkflowPresetSwitchContract({ selectorNodeId: 'selector', nodes })).toThrow('目标节点为只读状态：image-generation')
  })

  it('changes only theme input, reference previews and image asset bindings', () => {
    const contract = readWorkflowPresetSwitchContract({ selectorNodeId: 'selector', nodes: buildNodes() })
    const patches = buildWorkflowPresetPatches({ contract, presetKey: 'second', assets: { layout: { id: 'layout-2', url: 'https://assets.test/layout.png', width: 100, height: 200 }, style: { id: 'style-2', url: 'https://assets.test/style.jpg', width: 100, height: 200 } } })
    expect([...patches.keys()]).toEqual(['group', 'selector', 'layout', 'style', 'image-generation'])
    expect(patches.get('selector')).toMatchObject({ activePresetKey: 'second', workflowTextInput: '把小游戏改成海底寻宝主题' })
    expect(patches.get('image-generation')).toEqual({ activePresetKey: 'second', workflowImageReferenceAssetBindings: [{ assetId: 'layout-2', role: 'layout', strength: 0.8 }, { assetId: 'style-2', role: 'style', strength: 0.55 }] })
    expect(patches.get('selector')).not.toHaveProperty('prompt')
    expect(patches.get('image-generation')).not.toHaveProperty('prompt')
    expect(patches.get('image-generation')).not.toHaveProperty('negativePrompt')
  })

  it('fails without partial patches when resolved asset identity drifts', () => {
    const contract = readWorkflowPresetSwitchContract({ selectorNodeId: 'selector', nodes: buildNodes() })
    expect(() => buildWorkflowPresetPatches({ contract, presetKey: 'second', assets: { layout: { id: 'wrong-layout', url: 'https://assets.test/layout.png', width: null, height: null }, style: { id: 'style-2', url: 'https://assets.test/style.jpg', width: null, height: null } } })).toThrow('解析后的资产与主题合同不一致')
  })
})

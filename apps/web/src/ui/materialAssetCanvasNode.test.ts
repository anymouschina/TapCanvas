import { describe, expect, it } from 'vitest'
import type { MaterialAssetDto } from '../api/server'
import { buildMaterialAssetCanvasNodeData } from './materialAssetCanvasNode'

function characterAsset(): MaterialAssetDto {
  return {
    id: 'asset-source-role',
    projectId: 'project-source',
    scope: 'personal',
    kind: 'character',
    name: '沈知夏',
    currentVersion: 3,
    latestVersion: {
      id: 'asset-source-role-v3',
      assetId: 'asset-source-role',
      projectId: 'project-source',
      version: 3,
      data: {
        imageUrl: 'https://assets.tapcanvas.test/shen-v3.png',
        identityAnchors: ['鹅蛋脸', '左眼尾小痣'],
        characterAssetRole: 'identity_anchor',
      },
      note: null,
      createdAt: '2026-08-08T10:00:00.000Z',
    },
    createdAt: '2026-08-08T09:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
  }
}

describe('material asset canvas-node projection', () => {
  it('creates a current-project role-card node while preserving source provenance', () => {
    expect(buildMaterialAssetCanvasNodeData({
      asset: characterAsset(),
      targetProjectId: 'project-target',
    })).toMatchObject({
      kind: 'image',
      label: '角色卡｜沈知夏',
      productionLayer: 'anchors',
      materialKind: 'character',
      referenceType: 'character',
      roleName: '沈知夏',
      materialProjectId: 'project-target',
      sourceProjectId: 'project-source',
      sourceMaterialAssetId: 'asset-source-role',
      sourceMaterialAssetVersionId: 'asset-source-role-v3',
      imageUrl: 'https://assets.tapcanvas.test/shen-v3.png',
      imageResults: [{ url: 'https://assets.tapcanvas.test/shen-v3.png' }],
      identityAnchors: ['鹅蛋脸', '左眼尾小痣'],
    })
  })

  it('uses canonical scene identity instead of degrading a copied scene to a generic image', () => {
    const asset: MaterialAssetDto = {
      ...characterAsset(),
      id: 'asset-scene',
      kind: 'scene',
      name: '军属家属院',
    }
    expect(buildMaterialAssetCanvasNodeData({ asset, targetProjectId: 'project-target' })).toMatchObject({
      label: '场景卡｜军属家属院',
      referenceType: 'scene',
      sceneName: '军属家属院',
      materialKind: 'scene',
    })
  })
})

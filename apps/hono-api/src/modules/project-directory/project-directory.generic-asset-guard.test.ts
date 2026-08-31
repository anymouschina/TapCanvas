import { describe, expect, it } from 'vitest'
import {
  assertGenericAssetDataAllowed,
  assertGenericAssetRowMutationAllowed,
} from './project-directory.generic-asset-guard'

const directoryData = {
  kind: 'projectFsState',
  version: 1,
  state: {
    version: 1,
    rootId: 'root',
    nodesById: {},
  },
}

describe('generic asset project-directory boundary', () => {
  it('rejects creating a project directory through the generic asset path', () => {
    expect(() => assertGenericAssetDataAllowed(directoryData, 'create')).toThrowError(
      expect.objectContaining({
        status: 409,
        code: 'project_directory_dedicated_endpoint_required',
        details: { operation: 'create' },
      }),
    )
  })

  it('rejects promoting an ordinary asset into a project directory through generic update', () => {
    expect(() => assertGenericAssetDataAllowed(directoryData, 'update_data', 'asset-1')).toThrowError(
      expect.objectContaining({
        status: 409,
        code: 'project_directory_dedicated_endpoint_required',
        details: { operation: 'update_data', assetId: 'asset-1' },
      }),
    )
  })

  it.each(['update_data', 'rename', 'delete'] as const)(
    'rejects generic %s for an existing project directory asset',
    (operation) => {
      expect(() => assertGenericAssetRowMutationAllowed(
        JSON.stringify(directoryData),
        operation,
        'directory-1',
      )).toThrowError(expect.objectContaining({
        status: 409,
        code: 'project_directory_dedicated_endpoint_required',
        details: { operation, assetId: 'directory-1' },
      }))
    },
  )

  it('allows unrelated top-level asset kinds and ignores nested directory-like metadata', () => {
    expect(() => assertGenericAssetDataAllowed({ kind: 'generation' }, 'create')).not.toThrow()
    expect(() => assertGenericAssetDataAllowed({ snapshot: directoryData }, 'create')).not.toThrow()
  })

  it('fails explicitly when an existing asset cannot be parsed safely', () => {
    expect(() => assertGenericAssetRowMutationAllowed('{broken-json', 'delete', 'asset-1')).toThrowError(
      expect.objectContaining({
        status: 409,
        code: 'asset_data_corrupt',
        details: { operation: 'delete', assetId: 'asset-1' },
      }),
    )
  })
})

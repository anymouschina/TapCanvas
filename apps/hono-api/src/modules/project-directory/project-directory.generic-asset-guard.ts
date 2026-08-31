import { PROJECT_DIRECTORY_ASSET_KIND } from '@tapcanvas/project-directory-protocol'
import { AppError } from '../../middleware/error'

export type GenericAssetMutation = 'create' | 'update_data' | 'rename' | 'delete'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readTopLevelKind(value: unknown): string | null {
  if (!isRecord(value)) return null
  return typeof value.kind === 'string' ? value.kind.trim() : null
}

function dedicatedEndpointError(
  operation: GenericAssetMutation,
  assetId?: string,
): AppError {
  return new AppError('项目目录资产只能通过 /project-directory 专用接口修改', {
    status: 409,
    code: 'project_directory_dedicated_endpoint_required',
    details: {
      operation,
      ...(assetId ? { assetId } : {}),
    },
  })
}

export function assertGenericAssetDataAllowed(
  data: unknown,
  operation: Extract<GenericAssetMutation, 'create' | 'update_data'>,
  assetId?: string,
): void {
  if (readTopLevelKind(data) === PROJECT_DIRECTORY_ASSET_KIND) {
    throw dedicatedEndpointError(operation, assetId)
  }
}

export function assertGenericAssetRowMutationAllowed(
  storedData: string | null,
  operation: Exclude<GenericAssetMutation, 'create'>,
  assetId: string,
): void {
  if (storedData === null) return
  let parsed: unknown
  try {
    parsed = JSON.parse(storedData)
  } catch {
    throw new AppError('资产数据不是有效 JSON，无法安全判断写入边界', {
      status: 409,
      code: 'asset_data_corrupt',
      details: { assetId, operation },
    })
  }
  if (readTopLevelKind(parsed) === PROJECT_DIRECTORY_ASSET_KIND) {
    throw dedicatedEndpointError(operation, assetId)
  }
}

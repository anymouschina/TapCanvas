import { VIDEO_RUN_STATUS_PROJECTION_OWNER } from '@tapcanvas/video-orchestrator-protocol'

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Runtime facts belong to the server; browsers may sync node layout but never projection data. */
export function isServerManagedProjectionData(data: unknown): boolean {
  const record = readRecord(data)
  return record?.managedProjection === VIDEO_RUN_STATUS_PROJECTION_OWNER
}

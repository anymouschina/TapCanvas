import { getPendingUploadCount } from '../domain/upload-runtime/store/uploadRuntimeStore'
import { useUIStore } from './uiStore'

type LeaveGuardOptions = {
  nextProjectName?: string
  includeDirtyCheck?: boolean
}

function buildPendingUploadMessage(pendingCount: number, nextProjectName?: string): string {
  const target = nextProjectName ? `并切换到「${nextProjectName}」` : '并离开当前页面'
  if (pendingCount <= 0) return ''
  return `还有 ${pendingCount} 个本地文件正在上传，图片可能还没同步到画布。现在离开${target}，这些图片可能暂时看不到。确定继续吗？`
}

function buildDirtyMessage(nextProjectName?: string): string {
  if (nextProjectName) {
    return `当前项目有未保存修改，切换到「${nextProjectName}」后未保存内容可能丢失。确定继续吗？`
  }
  return '当前项目有未保存修改，离开后未保存内容可能丢失。确定继续吗？'
}

export function hasPendingUploads(): boolean {
  return getPendingUploadCount() > 0
}

export function confirmLeaveForProjectChange(options?: LeaveGuardOptions): boolean {
  const pendingCount = getPendingUploadCount()
  const nextProjectName = typeof options?.nextProjectName === 'string' ? options.nextProjectName.trim() : ''
  const includeDirtyCheck = options?.includeDirtyCheck !== false

  if (pendingCount > 0) {
    const ok = window.confirm(buildPendingUploadMessage(pendingCount, nextProjectName))
    if (!ok) return false
  }

  if (includeDirtyCheck && useUIStore.getState().isDirty) {
    return window.confirm(buildDirtyMessage(nextProjectName))
  }

  return true
}

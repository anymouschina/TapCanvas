import { buildAssetUploadRequestKey } from '../api/server'

export type DedupeLocalFilesResult = {
  uniqueFiles: File[]
  skippedCount: number
}

export function dedupeLocalFiles(
  files: File[],
  resolveName?: (file: File) => string,
): DedupeLocalFilesResult {
  const seen = new Set<string>()
  const uniqueFiles: File[] = []
  let skippedCount = 0

  files.forEach((file) => {
    const name = resolveName ? resolveName(file) : file.name
    const requestKey = buildAssetUploadRequestKey(file, name)
    if (seen.has(requestKey)) {
      skippedCount += 1
      return
    }
    seen.add(requestKey)
    uniqueFiles.push(file)
  })

  return { uniqueFiles, skippedCount }
}

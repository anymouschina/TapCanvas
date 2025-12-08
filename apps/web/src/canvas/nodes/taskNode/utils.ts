export const REMOTE_IMAGE_URL_REGEX = /^https?:\/\//i

export const isRemoteUrl = (url?: string | null) => {
  if (!url) return false
  return REMOTE_IMAGE_URL_REGEX.test(url)
}

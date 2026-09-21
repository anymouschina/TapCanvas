import { getCachedGenerationPrefs } from '../config/generationPrefs'
import type { UserGenerationPrefsDto } from '../api/server'

/** Only explicitly enabled account preferences initialize new nodes. */
export function readNodeModelPrefs(): UserGenerationPrefsDto {
  const prefs = getCachedGenerationPrefs()
  return {
    ...(prefs?.imagePreferenceEnabled ? {
      imageModel: prefs.imageModel, imageSize: prefs.imageSize, imageQuality: prefs.imageQuality,
      imageAspect: prefs.imageAspect, imageResolution: prefs.imageResolution, imageCount: prefs.imageCount,
    } : {}),
    ...(prefs?.videoPreferenceEnabled ? {
      videoModel: prefs.videoModel, videoResolution: prefs.videoResolution, videoAspect: prefs.videoAspect,
      videoDuration: prefs.videoDuration, videoCount: prefs.videoCount, videoGenerateAudio: prefs.videoGenerateAudio,
    } : {}),
  }
}

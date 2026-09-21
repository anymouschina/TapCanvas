import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { UserGenerationPrefsDto } from '../../../api/server'
import { getCachedGenerationPrefs, subscribeGenerationPrefs, updateRecentGenerationPrefs } from '../../../config/generationPrefs'
import type { GenerationPreferenceSetting } from './components/GenerationPreferenceSwitch'

export function useNodeGenerationPreference(
  nodeId: string, kind: 'image' | 'video', selection: UserGenerationPrefsDto | null,
): { setting: GenerationPreferenceSetting; markEdited: () => void } {
  const prefs = useSyncExternalStore(subscribeGenerationPrefs, getCachedGenerationPrefs, () => null)
  const enabledKey = kind === 'image' ? 'imagePreferenceEnabled' : 'videoPreferenceEnabled'
  const checked = prefs?.[enabledKey] === true
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editEpoch, setEditEpoch] = useState(0)
  const processedEpoch = useRef(0)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const selectionKey = JSON.stringify(selection)
  const operationCount = useRef(0)

  const save = useCallback(async (patch: UserGenerationPrefsDto) => {
    operationCount.current += 1
    setSaving(true)
    setError(null)
    try { await updateRecentGenerationPrefs(patch, nodeId) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      operationCount.current -= 1
      if (operationCount.current === 0) setSaving(false)
    }
  }, [nodeId])

  useEffect(() => {
    if (!checked) { processedEpoch.current = editEpoch; return }
    if (editEpoch === processedEpoch.current) return
    if (!selection) {
      setError('当前模型和规格组合不完整，请完成选择后同步偏好。')
      return
    }
    const timer = window.setTimeout(() => {
      processedEpoch.current = editEpoch
      const latest = selectionRef.current
      if (latest) void save({ ...latest, [enabledKey]: true })
    }, 200)
    return () => window.clearTimeout(timer)
  }, [checked, editEpoch, selectionKey, enabledKey, save])

  return {
    markEdited: useCallback(() => setEditEpoch((value) => value + 1), []),
    setting: {
      checked, saving, error,
      onChange: (enabled) => {
        if (enabled && !selectionRef.current) {
          setError('当前模型和规格组合不完整，请先完成选择。')
          return
        }
        processedEpoch.current = editEpoch
        void save(enabled ? { ...selectionRef.current, [enabledKey]: true } : { [enabledKey]: false })
      },
    },
  }
}

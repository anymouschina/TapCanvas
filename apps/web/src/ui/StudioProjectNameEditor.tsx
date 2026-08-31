import React from 'react'
import { Loader, TextInput } from '@mantine/core'
import { toast } from './toast'

export interface StudioProjectNameEditorProject {
  id: string
  name: string
}

export interface StudioProjectNameEditorProps {
  project: StudioProjectNameEditorProject
  onSave: (projectId: string, name: string) => Promise<string>
}

function resolveSaveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return '项目名称保存失败'
}

export function StudioProjectNameEditor({ project, onSave }: StudioProjectNameEditorProps): JSX.Element {
  const [draft, setDraft] = React.useState(project.name)
  const [saving, setSaving] = React.useState(false)
  const focusedRef = React.useRef(false)
  const skipNextBlurSaveRef = React.useRef(false)
  const confirmedNameRef = React.useRef(project.name)
  const projectIdRef = React.useRef(project.id)

  React.useEffect(() => {
    projectIdRef.current = project.id
    confirmedNameRef.current = project.name
    if (!focusedRef.current) setDraft(project.name)
  }, [project.id, project.name])

  const saveDraft = React.useCallback(async (): Promise<void> => {
    if (saving) return

    const projectId = project.id
    const nextName = draft.trim()
    const confirmedName = confirmedNameRef.current
    if (!nextName) {
      setDraft(confirmedName)
      toast('项目名称不能为空', 'error')
      return
    }
    if (nextName === confirmedName) {
      setDraft(confirmedName)
      return
    }

    setSaving(true)
    try {
      const savedName = await onSave(projectId, nextName)
      if (projectIdRef.current !== projectId) return
      confirmedNameRef.current = savedName
      setDraft(savedName)
    } catch (error: unknown) {
      if (projectIdRef.current === projectId) setDraft(confirmedNameRef.current)
      toast(resolveSaveErrorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, project.id, saving])

  return (
    <TextInput
      className="app-project-input"
      classNames={{ input: 'app-project-input__field', section: 'app-project-input__section' }}
      size="xs"
      aria-label="项目名称"
      title="聚焦编辑项目名称，失焦自动保存"
      value={draft}
      onFocus={() => {
        focusedRef.current = true
        setDraft(confirmedNameRef.current)
      }}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        focusedRef.current = false
        if (skipNextBlurSaveRef.current) {
          skipNextBlurSaveRef.current = false
          return
        }
        void saveDraft()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          skipNextBlurSaveRef.current = true
          setDraft(confirmedNameRef.current)
          event.currentTarget.blur()
        }
      }}
      rightSection={saving ? <Loader className="app-project-input__loader" size={12} /> : null}
      readOnly={saving}
      data-saving={saving || undefined}
      data-tour="project-name"
    />
  )
}

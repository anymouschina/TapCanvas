import React from 'react'

export type GenerationPreferenceSetting = {
  checked: boolean
  saving: boolean
  error: string | null
  onChange: (enabled: boolean) => void
}

export function GenerationPreferenceSwitch({ setting }: { setting: GenerationPreferenceSetting }): JSX.Element {
  return (
    <section className="tc-generation-settings__preference" aria-label="模型与规格偏好">
      <label className="tc-generation-settings__preference-row">
        <span className="generation-preference-switch__span">设为偏好</span>
        <input className="generation-preference-switch__input" type="checkbox" role="switch" aria-label="设为偏好"
          checked={setting.checked} disabled={setting.saving}
          onChange={(event) => setting.onChange(event.currentTarget.checked)} />
      </label>
      <p className="tc-generation-settings__preference-description">
        {setting.saving ? '正在保存偏好…' : '开启后，同类型未执行节点与新节点统一使用此模型和规格'}
      </p>
      {setting.error ? <p role="alert" className="tc-generation-settings__preference-error">{setting.error}</p> : null}
    </section>
  )
}

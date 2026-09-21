import React from 'react'
import type { ImageParameterSpec, ImageParameterValue, ImageParameterValues } from '../../../../config/imageModelParameters'
import './ImageAdvancedSettings.css'

export type ImageAdvancedSetting = {
  specs: ReadonlyArray<ImageParameterSpec>
  values: ImageParameterValues
  onChange: (key: string, value: ImageParameterValue) => void
}

export function ImageAdvancedSettings({ setting }: { setting: ImageAdvancedSetting }): JSX.Element | null {
  if (setting.specs.length === 0) return null
  return (
    <section className="tc-image-advanced" aria-label="高级设置">
      <h3 className="tc-generation-settings__label">高级设置</h3>
      {setting.specs.map((spec) => {
        const value = setting.values[spec.key] ?? spec.default
        if (spec.type === 'string') {
          return <label className="tc-image-advanced__text" key={spec.key}>
            <span className="image-advanced-settings__span">{spec.label}</span>
            <input className="image-advanced-settings__input" aria-label={spec.label} placeholder={`输入${spec.label}（可留空）`} value={typeof value === 'string' ? value : ''}
              onChange={(event) => setting.onChange(spec.key, event.currentTarget.value)} />
          </label>
        }
        if (spec.type === 'boolean') {
          return <label className="tc-image-advanced__text" key={spec.key}>
            <span className="image-advanced-settings__span">{spec.label}</span>
            <input className="image-advanced-settings__input" type="checkbox" aria-label={spec.label} checked={value === true}
              onChange={(event) => setting.onChange(spec.key, event.currentTarget.checked)} />
          </label>
        }
        const numericValue = typeof value === 'number' ? value : spec.min ?? 0
        return <div className="tc-image-advanced__numeric" key={spec.key}>
          <div className="tc-image-advanced__heading"><span className="image-advanced-settings__span">{spec.label}</span><output className="image-advanced-settings__output">{numericValue}</output></div>
          <input className="image-advanced-settings__input" type="range" aria-label={spec.label} min={spec.min} max={spec.max} step={spec.step ?? 1} value={numericValue}
            onChange={(event) => setting.onChange(spec.key, Number(event.currentTarget.value))} />
        </div>
      })}
    </section>
  )
}

import React from 'react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import './SkillLogo.css'

export type SkillLogoData = {
  id: string
  key?: string
  name: string
  logoUrl: string | null
}

type SkillLogoProps = {
  skill: SkillLogoData
  className?: string
  priority?: 'critical' | 'visible' | 'prefetch' | 'background'
}

export function SkillLogo({ skill, className = '', priority = 'visible' }: SkillLogoProps): JSX.Element {
  const classes = `tc-skill-logo${className ? ` ${className}` : ''}`
  if (skill.logoUrl) {
    return (
      <ManagedImage
        className={`${classes} tc-skill-logo--image`}
        src={skill.logoUrl}
        alt=""
        priority={priority}
      />
    )
  }
  return (
    <span className={`${classes} tc-skill-logo--missing`} role="img" aria-label={`${skill.name} 图片缺失`}>
      <span className="tc-skill-logo__missing-label">无图</span>
    </span>
  )
}

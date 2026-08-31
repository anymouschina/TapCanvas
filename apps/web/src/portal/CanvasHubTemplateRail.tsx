import React from 'react'
import type { ProjectDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'

const TEMPLATE_SKELETON_KEYS = [
  'template-a',
  'template-b',
  'template-c',
  'template-d',
  'template-e',
  'template-f',
] as const

export type ConfiguredCanvasTemplate = ProjectDto & {
  templateCoverUrl: string
}

export function isConfiguredCanvasTemplate(
  project: ProjectDto,
): project is ConfiguredCanvasTemplate {
  return Boolean(project.templateCoverUrl?.trim() && (project.templateTitle?.trim() || project.name.trim()))
}

export type CanvasHubTemplateRailProps = {
  templates: ConfiguredCanvasTemplate[]
  loading: boolean
  error: string
  cloningTemplateId: string | null
  onUseTemplate: (template: ConfiguredCanvasTemplate) => void
}

export function CanvasHubTemplateRail({
  templates,
  loading,
  error,
  cloningTemplateId,
  onUseTemplate,
}: CanvasHubTemplateRailProps): JSX.Element {
  return (
    <section className="canvas-hub-templates" aria-label="热门画布模板">
      <div className="canvas-hub-template-tabs" role="tablist" aria-label="模板分类">
        <button className="canvas-hub-template-tab is-active" type="button" role="tab" aria-selected="true">热门</button>
      </div>
      <div className="canvas-hub-template-rail" aria-busy={loading}>
        {loading ? TEMPLATE_SKELETON_KEYS.map((key) => (
          <div className="canvas-hub-template-card canvas-hub-template-card--skeleton" aria-hidden="true" key={key}>
            <span className="canvas-hub-template-card__media tc-portal-skeleton" />
            <span className="canvas-hub-template-card__title-skeleton tc-portal-skeleton" />
          </div>
        )) : null}
        {error ? <div className="canvas-hub-template-state is-error" role="alert">{error}</div> : null}
        {!loading && !error ? templates.map((template) => (
          <button
            className="canvas-hub-template-card"
            type="button"
            disabled={Boolean(cloningTemplateId)}
            key={template.id}
            onClick={() => onUseTemplate(template)}
          >
            <span className="canvas-hub-template-card__media">
              <ManagedImage
                className="canvas-hub-template-card__image"
                src={template.templateCoverUrl}
                alt={template.templateTitle || template.name}
                priority="visible"
              />
              <span className="canvas-hub-template-card__action">
                {cloningTemplateId === template.id ? '正在创建' : '使用模板'}
              </span>
            </span>
            <strong className="canvas-hub-template-card__title">{template.templateTitle || template.name}</strong>
          </button>
        )) : null}
        {!loading && !error && templates.length === 0 ? (
          <div className="canvas-hub-template-state">当前暂无已配置的公开模板</div>
        ) : null}
      </div>
    </section>
  )
}

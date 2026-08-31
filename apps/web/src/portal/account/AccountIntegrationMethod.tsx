import { Button } from '@mantine/core'
import { IconCopy, IconExternalLink, type TablerIcon } from '@tabler/icons-react'

export type AccountIntegrationScenario = {
  icon: TablerIcon
  title: string
  description: string
}

export type AccountIntegrationFact = {
  label: string
  value: string
}

export function AccountIntegrationMethod({
  icon: IntroIcon,
  title,
  description,
  scenarios,
  facts,
  codeLabel,
  codeHint,
  codeValue,
  copyLabel,
  onCopy,
  docsHref,
  docsLabel,
  footnote,
}: {
  icon: TablerIcon
  title: string
  description: string
  scenarios: readonly AccountIntegrationScenario[]
  facts: readonly AccountIntegrationFact[]
  codeLabel: string
  codeHint: string
  codeValue: string
  copyLabel: string
  onCopy: () => void
  docsHref?: string
  docsLabel?: string
  footnote?: string
}): JSX.Element {
  return (
    <div className="account-integration-method">
      <div className="account-integration-method__intro">
        <IntroIcon className="account-integration-method__intro-icon" size={20} />
        <div className="account-integration-method__intro-copy">
          <strong className="account-integration-method__intro-title">{title}</strong>
          <p className="account-integration-method__intro-description">{description}</p>
        </div>
      </div>

      <section className="account-integration-scenarios" aria-label={`${title}适合场景`}>
        {scenarios.map((scenario) => {
          const ScenarioIcon = scenario.icon
          return (
            <div className="account-integration-scenario" key={scenario.title}>
              <ScenarioIcon className="account-integration-scenario__icon" size={18} />
              <div className="account-integration-scenario__copy">
                <strong className="account-integration-scenario__title">{scenario.title}</strong>
                <span className="account-integration-scenario__description">{scenario.description}</span>
              </div>
            </div>
          )
        })}
      </section>

      <section className="account-integration-contract" aria-label={`${title}接入契约`}>
        {facts.map((fact) => (
          <div className="account-integration-contract__row" key={fact.label}>
            <span className="account-integration-contract__label">{fact.label}</span>
            <code className="account-integration-contract__value">{fact.value}</code>
          </div>
        ))}
      </section>

      <section className="account-integration-code" aria-label={codeLabel}>
        <header className="account-integration-code__header">
          <div className="account-integration-code__heading">
            <IntroIcon className="account-integration-code__heading-icon" size={16} />
            <strong className="account-integration-code__title">{codeLabel}</strong>
            <span className="account-integration-code__hint">{codeHint}</span>
          </div>
          <Button className="account-integration-code__copy" variant="subtle" size="compact-sm" leftSection={<IconCopy className="account-integration-code__copy-icon" size={14} />} onClick={onCopy}>
            {copyLabel}
          </Button>
        </header>
        <pre className="account-integration-code__pre"><code className="account-integration-code__value">{codeValue}</code></pre>
      </section>

      {docsHref || footnote ? (
        <div className="account-integration-method__actions">
          {docsHref && docsLabel ? (
            <a className="account-integration-method__docs-link" href={docsHref} target="_blank" rel="noreferrer">
              <IconExternalLink className="account-integration-method__docs-icon" size={14} />
              {docsLabel}
            </a>
          ) : <span className="account-integration-method__docs-spacer" />}
          {footnote ? <span className="account-integration-method__action-note">{footnote}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

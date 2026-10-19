import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type OriginAgent = {
  affiliated?: boolean
  managed?: boolean
  module_slug?: string | null
  affiliation_label?: string | null
  department_name?: string | null
  module_name?: string | null
  origin_label?: string | null
}

/** Quiet line: this agent was hired from a marketplace module. */
export function AgentModuleOrigin({
  agent,
  linked = false,
}: {
  agent: OriginAgent
  /** Detail page can open the module. Library cards are already a link. */
  linked?: boolean
}) {
  const { t } = useTranslation('nav')
  if (!agent.affiliated && !agent.managed) return null
  const raw =
    agent.affiliation_label ||
    agent.department_name ||
    agent.module_name ||
    agent.origin_label ||
    t('workforce.agents.affiliationBadgeFallback')
  const place = agent.module_slug
    ? t(`integrations.modules.${agent.module_slug}.name`, { defaultValue: raw })
    : raw
  const label = t('workforce.agents.fromModule', {
    place,
    defaultValue: 'From the {{place}} module',
  })
  const className = 'mt-1 block text-2xs text-text-muted'
  if (!linked || !agent.module_slug) {
    return <span className={className}>{label}</span>
  }
  return (
    <p className={className}>
      <Link to={`/connections/${agent.module_slug}`} className="hover:text-accent">
        {label}
      </Link>
    </p>
  )
}

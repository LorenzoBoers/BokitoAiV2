import { Link } from 'react-router-dom'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { AgentOptionRow } from '../ui/AgentOptionRow'
import { AgentMark } from '../ui/AgentMark'
import { agentProfileAccentColor } from '../../lib/agent-avatar'
import type { IntegrationModuleRow } from '../../lib/integrations-api'
import { cn } from '../../lib/utils'

type Props = {
  module: IntegrationModuleRow
  moduleName: string
  /** Compact one-line for marketplace cards. */
  compact?: boolean
  className?: string
  onNavigate?: () => void
  /** Changes when the showcase opens so the orb plays its entrance. */
  spawnKey?: string | null
}

/** Persona shown on a module card and in the showcase. Unmarked hired orbs fall back to the template. */
export function moduleSpecialistVisual(module: IntegrationModuleRow, moduleName: string, t: TFunction) {
  const agentId = module.specialist_agent_id
  const template = module.package?.agent_template
  const hiredName = (module.specialist_agent_name || '').trim()
  const genericHired =
    !hiredName ||
    / specialist$/i.test(hiredName) ||
    [
      'Noor Vale',
      'Kas Lind',
      'Jules Hart',
      'Ada Quill',
      'Vale',
      'Kas',
      'Vega',
      'Finny',
      'Stocko',
      'Quill',
      'Audito',
      'Boekhouder',
      'Accountant',
    ].includes(hiredName)
  const agentName = genericHired
    ? t(`integrations.modules.showcase.personas.${module.slug}.name`, {
        defaultValue: template?.name || `${moduleName} specialist`,
      })
    : hiredName
  const jobTitle = t(`integrations.modules.showcase.personas.${module.slug}.title`, {
    defaultValue: template?.job_title || t('integrations.modules.showcase.specialistBadge', { defaultValue: 'Specialist' }),
  })
  const uspRaw = t(`integrations.modules.showcase.personas.${module.slug}.usps`, {
    returnObjects: true,
    defaultValue: [],
  })
  const usps = Array.isArray(uspRaw) ? uspRaw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const unmarkedDefault =
    !module.specialist_avatar_image_url &&
    (module.specialist_avatar_shape || 'bokito') === 'bokito' &&
    (module.specialist_avatar_color || '#9159fe').toLowerCase() === '#9159fe'
  const avatar = {
    id: agentId || module.slug,
    name: agentName,
    avatar_kind: unmarkedDefault ? 'orb' : module.specialist_avatar_kind || 'orb',
    avatar_icon: unmarkedDefault ? null : module.specialist_avatar_icon,
    avatar_color: unmarkedDefault ? template?.avatar_color : module.specialist_avatar_color || template?.avatar_color,
    avatar_shape: unmarkedDefault ? template?.avatar_shape : module.specialist_avatar_shape || template?.avatar_shape,
    avatar_image_url: module.specialist_avatar_image_url,
  }
  const titleColor = agentProfileAccentColor(avatar.avatar_color || '#9159fe')
  return { agentId, agentName, jobTitle, usps, avatar, titleColor }
}

/** Shared specialist ownership strip for Connections cards and showcase modal. */
export function ModuleSpecialistCallout({
  module,
  moduleName,
  compact = false,
  className,
  onNavigate,
  spawnKey = null,
}: Props) {
  const { t } = useTranslation('nav')
  const { agentId, agentName, jobTitle, usps, avatar, titleColor } = moduleSpecialistVisual(module, moduleName, t)

  if (compact) {
    return (
      <div className={cn('flex min-w-0 items-center gap-2', className)}>
        <AgentOptionRow agent={avatar} size={18} />
        <span className="shrink-0 text-2xs" style={{ color: titleColor }}>
          {jobTitle}
        </span>
      </div>
    )
  }

  const identity = (
    <div className="min-w-0 space-y-1 pt-1">
      <p className="truncate-fade text-2xl font-semibold tracking-tight text-text-heading">{agentName}</p>
      <p className="text-sm font-medium" style={{ color: titleColor }}>
        {jobTitle}
      </p>
    </div>
  )

  const portrait = (
    <div className="flex min-w-0 items-center justify-center gap-4">
      <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
        <AgentMark
          agent={avatar}
          size={128}
          mode="live"
          decorative
          spawnKey={spawnKey}
          className="relative z-[1]"
        />
      </div>
      {agentId ? (
        <Link to={`/agents/${agentId}`} onClick={onNavigate} className="min-w-0 hover:opacity-90">
          {identity}
        </Link>
      ) : (
        identity
      )}
    </div>
  )

  return (
    <section className={cn('grid items-center gap-x-6 gap-y-4 sm:grid-cols-2', className)}>
      {portrait}
      {usps.length > 0 ? (
        <ul className="space-y-2">
          {usps.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-text-secondary">
              <Check size={16} className="mt-0.5 shrink-0" style={{ color: titleColor }} aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MessageSquare } from 'lucide-react'
import { AgentOptionRow } from '../ui/AgentOptionRow'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import type { IntegrationModuleRow } from '../../lib/integrations-api'
import { cn } from '../../lib/utils'

type Props = {
  module: IntegrationModuleRow
  moduleName: string
  /** Compact one-line for marketplace cards. */
  compact?: boolean
  className?: string
  onNavigate?: () => void
}

/** Shared specialist ownership strip for Connections cards and showcase modal. */
export function ModuleSpecialistCallout({
  module,
  moduleName,
  compact = false,
  className,
  onNavigate,
}: Props) {
  const { t } = useTranslation('nav')
  const agentId = module.specialist_agent_id
  const agentName =
    module.specialist_agent_name ||
    module.package?.agent_template?.name ||
    t('integrations.modules.showcase.specialistFallback', {
      defaultValue: '{{name}} specialist',
      name: moduleName,
    })
  const blurb =
    module.package?.agent_template?.role_blurb ||
    t('integrations.modules.showcase.specialistBlurb', {
      defaultValue:
        'Owns this module tools, packaged hashtags and setup. Invite them into a conversation with @.',
    })
  const talkPrefill = t('integrations.modules.showcase.talkPrefill', {
    defaultValue: 'Help me use {{name}}. What can you do, and what should we set up next?',
    name: moduleName,
  })
  const talkPath = agentId
    ? talkToAssistantPath(talkPrefill, agentId)
    : talkToAssistantPath(talkPrefill)

  if (compact) {
    if (!agentId && !module.has_managed_specialist) {
      return (
        <p className={cn('text-xs text-text-muted', className)}>
          {t('integrations.modules.showcase.specialistOnInstall', {
            defaultValue: 'Install hires a specialist for this module',
          })}
        </p>
      )
    }
    return (
      <div className={cn('flex min-w-0 items-center gap-2', className)}>
        <AgentOptionRow
          agent={{
            id: agentId || module.slug,
            name: agentName,
            avatar_kind: module.specialist_avatar_kind,
            avatar_icon: module.specialist_avatar_icon,
            avatar_color: module.specialist_avatar_color,
            avatar_shape: module.specialist_avatar_shape,
            avatar_image_url: module.specialist_avatar_image_url,
          }}
          size={18}
        />
        <Badge variant="neutral" className="shrink-0 px-1.5 py-0 text-2xs">
          {t('integrations.modules.showcase.specialistBadge', { defaultValue: 'Specialist' })}
        </Badge>
      </div>
    )
  }

  return (
    <section
      className={cn(
        'space-y-3 rounded-lg border border-border/60 bg-bg-muted/15 px-3 py-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
            {t('integrations.modules.showcase.specialist', {
              defaultValue: 'Module specialist',
            })}
          </h3>
          {agentId ? (
            <Link
              to={`/agents/${agentId}`}
              onClick={onNavigate}
              className="block min-w-0 hover:opacity-90"
            >
              <AgentOptionRow
                agent={{
                  id: agentId,
                  name: agentName,
                  avatar_kind: module.specialist_avatar_kind,
                  avatar_icon: module.specialist_avatar_icon,
                  avatar_color: module.specialist_avatar_color,
                  avatar_shape: module.specialist_avatar_shape,
                  avatar_image_url: module.specialist_avatar_image_url,
                }}
                size={22}
                trailing={
                  <Badge variant="secondary" className="px-1.5 py-0 text-2xs">
                    {t('integrations.modules.showcase.specialistBadge', {
                      defaultValue: 'Specialist',
                    })}
                  </Badge>
                }
              />
            </Link>
          ) : (
            <p className="text-sm font-medium text-text-heading">{agentName}</p>
          )}
          <p className="text-xs leading-snug text-text-secondary">{blurb}</p>
        </div>
        <Button asChild size="sm" variant={agentId ? 'secondary' : 'outline'}>
          <Link to={talkPath} onClick={onNavigate} className="gap-1.5">
            <MessageSquare size={13} aria-hidden />
            {agentId
              ? t('integrations.modules.showcase.talkSpecialist', {
                  defaultValue: 'Talk to {{name}}',
                  name: agentName,
                })
              : t('integrations.modules.showcase.talkAfterInstall', {
                  defaultValue: 'Talk after install',
                })}
          </Link>
        </Button>
      </div>
    </section>
  )
}

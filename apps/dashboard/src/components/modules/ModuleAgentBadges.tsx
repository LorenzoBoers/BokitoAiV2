import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import type { ModuleAgentRow } from '../../lib/integrations-api'

/** Shared roster badges so Overview and Setup stay identical. */
export function ModuleAgentBadges({ row }: { row: ModuleAgentRow }) {
  const { t } = useTranslation(['nav', 'common'])
  return (
    <>
      {row.is_default ? (
        <Badge variant="neutral" size="sm">
          {t('integrations.modules.agents.defaultBadge', { defaultValue: 'Default' })}
        </Badge>
      ) : null}
      {row.is_pack_specialist || row.managed ? (
        <Badge variant="neutral" size="sm">
          {row.affiliation_label ||
            t('integrations.modules.agents.specialistBadge', { defaultValue: 'Specialist' })}
        </Badge>
      ) : null}
      {row.can_write ? (
        <Badge variant="neutral" size="sm">
          {t('integrations.modules.agents.writeBadge', { defaultValue: 'Write' })}
        </Badge>
      ) : (
        <Badge variant="neutral" size="sm">
          {t('integrations.modules.agents.readOnlyBadge', { defaultValue: 'Read-only' })}
        </Badge>
      )}
      {row.company_ids && row.company_ids.length > 0 ? (
        <Badge variant="neutral" size="sm">
          {t('integrations.modules.agents.scopeBadge', {
            defaultValue: '{{count}} administration(s)',
            count: row.company_ids.length,
          })}
        </Badge>
      ) : null}
    </>
  )
}

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import { QUEUE_STATUS_VARIANT } from '../projects/projectWorkBadges'
import type { LinkedRequestRef } from '../../lib/workspace-api'
import type { QueueItemStatus } from '../../lib/project-work-api'

type Props = {
  requests: LinkedRequestRef[]
  /** Optional label above the chips */
  className?: string
}

/** Subtle active queue links on a knowledge / project document. */
export function LinkedRequestsChips({ requests, className }: Props) {
  const { t } = useTranslation('nav')
  if (!requests.length) return null

  return (
    <div className={className}>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {t('knowledgePage.linkedRequests')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {requests.map((req) => {
          const href =
            req.project_id != null
              ? `/projects/${req.project_id}?tab=queue&item=${req.id}`
              : undefined
          return href ? (
            <Link key={req.id} to={href} className="inline-flex max-w-full hover:opacity-90">
              <Badge
                variant={QUEUE_STATUS_VARIANT[req.status as QueueItemStatus] ?? 'neutral'}
                className="max-w-full px-2 py-0.5 text-[11px] font-normal"
              >
                <span className="truncate">{req.title}</span>
                <span className="ml-1 opacity-70">
                  {t(`projects.work.status.${req.status}`, { defaultValue: req.status })}
                </span>
              </Badge>
            </Link>
          ) : (
            <Badge
              key={req.id}
              variant={QUEUE_STATUS_VARIANT[req.status as QueueItemStatus] ?? 'neutral'}
              className="max-w-full px-2 py-0.5 text-[11px] font-normal"
            >
              <span className="truncate">{req.title}</span>
              <span className="ml-1 opacity-70">
                {t(`projects.work.status.${req.status}`, { defaultValue: req.status })}
              </span>
            </Badge>
          )
        })}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { AgentAvatarSource } from '../../lib/agent-avatar'
import { connectionsPathWithKind } from '../../lib/integration-kind-url'
import { cn } from '../../lib/utils'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { Card } from '../ui/card'

/** Showcase orb pool for the hire-agents banner (pick four at random per visit). */
const MARKETPLACE_BANNER_POOL: AgentAvatarSource[] = [
  { name: 'Nova', avatar_kind: 'orb', avatar_color: '#9159fe', avatar_shape: 'bokito' },
  { name: 'Atlas', avatar_kind: 'orb', avatar_color: '#1084fe', avatar_shape: 'blob' },
  { name: 'Kai', avatar_kind: 'orb', avatar_color: '#00c972', avatar_shape: 'pebble' },
  { name: 'Mira', avatar_kind: 'orb', avatar_color: '#ff6700', avatar_shape: 'squircle' },
  { name: 'Rio', avatar_kind: 'orb', avatar_color: '#ff309b', avatar_shape: 'hex' },
  { name: 'Sky', avatar_kind: 'orb', avatar_color: '#00bca6', avatar_shape: 'capsule' },
  { name: 'Leo', avatar_kind: 'orb', avatar_color: '#ff9800', avatar_shape: 'egg' },
  { name: 'Ada', avatar_kind: 'orb', avatar_color: '#ff263c', avatar_shape: 'crystal' },
]

function pickMarketplaceBannerAgents(count = 4): AgentAvatarSource[] {
  const pool = [...MARKETPLACE_BANNER_POOL]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}

/**
 * Compact footer banner to the modules catalog (hire a specialist / add a department).
 * Sits under the roster on Workforce and Agents so the main list stays primary.
 */
export function MarketplaceHireHint({ className }: { className?: string }) {
  const { t } = useTranslation('nav')
  const [agents] = useState(() => pickMarketplaceBannerAgents(4))
  return (
    <Card
      id="agent-marketplace"
      className={cn('relative overflow-hidden p-0 scroll-mt-24', className)}
      data-testid="agent-marketplace-banner"
    >
      <div className="relative z-[1] flex flex-wrap items-center gap-3 px-4 py-3 sm:gap-4">
        <div className="flex items-center gap-1" aria-hidden>
          {agents.map((agent, index) => (
            <Avatar kind="agent" key={agent.name ?? index} agent={agent} size={32} decorative mode="static" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-heading">{t('membersPage.hireAgentsTitle')}</p>
          <p className="mt-0.5 text-xs text-text-muted line-clamp-2">{t('membersPage.hireAgentsBody')}</p>
        </div>
        <Button asChild size="sm" variant="secondary" className="shrink-0">
          <Link to={connectionsPathWithKind('modules')}>
            <Store size={14} aria-hidden />
            {t('membersPage.hireAgentsCta')}
          </Link>
        </Button>
      </div>
    </Card>
  )
}

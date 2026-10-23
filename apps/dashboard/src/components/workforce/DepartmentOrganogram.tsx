import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2 } from 'lucide-react'
import { AvatarStack } from '../ui/AvatarStack'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { IconTile } from '../ui/icon-tile'
import { departmentPath } from '../../lib/navigation'
import { platformIcon } from '../../lib/platform-icons'
import { resolveTeamStackMembers } from '../../lib/team-facepile'
import type { DepartmentTreeNode } from '../../lib/department-tree'
import type { OverviewTeam, TeamOverview } from '../../lib/teams-api'
import { cn } from '../../lib/utils'

type Node = DepartmentTreeNode<OverviewTeam>

function ChildConnector({ index, count }: { index: number; count: number }) {
  const isFirst = index === 0
  const isLast = index === count - 1
  const solo = count === 1
  return (
    <div className="relative h-6 self-stretch" aria-hidden>
      {solo ? null : (
        <div
          className={cn(
            'absolute top-0 h-px bg-border',
            isFirst && 'left-1/2 right-0',
            isLast && !isFirst && 'left-0 right-1/2',
            !isFirst && !isLast && 'inset-x-0',
          )}
        />
      )}
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
    </div>
  )
}

function OrgNode({
  node,
  overview,
  level,
  connector,
}: {
  node: Node
  overview: TeamOverview
  level: number
  connector?: { index: number; count: number }
}) {
  const { t } = useTranslation('nav')
  const team = node.department
  const Icon = platformIcon(team.icon) ?? Building2
  const canOpen = !team.system && !team.root
  const stack = resolveTeamStackMembers(team.members, {
    people: overview.people,
    agents: overview.agents,
  })
  const card = (
    <Card interactive={canOpen} className="flex h-24 w-56 shrink-0 flex-col justify-between px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <IconTile icon={Icon} tone="accent" size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-heading">{team.name}</p>
          {team.system ? <Badge variant="neutral">{t('teamPage.systemBadge')}</Badge> : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-text-muted">
          {t('teamPage.memberCount', { count: team.member_count })}
        </span>
        {stack.length > 0 ? (
          <AvatarStack members={stack} size={20} linkAgents={false} className="shrink-0" />
        ) : null}
      </div>
    </Card>
  )

  return (
    <div
      className="flex shrink-0 flex-col items-center"
      role="treeitem"
      aria-level={level}
      aria-expanded={node.children.length > 0 ? true : undefined}
      aria-label={team.name}
      data-testid="organogram-node"
    >
      {connector ? <ChildConnector index={connector.index} count={connector.count} /> : null}
      <div className="px-2">
      {canOpen ? (
        <Link
          to={departmentPath(team.id)}
          aria-label={t('organogram.openDepartment', { name: team.name })}
          className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {card}
        </Link>
      ) : (
        card
      )}
      </div>
      {node.children.length > 0 ? (
        <div className="flex flex-col items-center">
          <div className="h-6 w-px bg-border" aria-hidden />
          <div className="flex items-start">
            {node.children.map((child, index) => (
              <OrgNode
                key={child.department.id}
                node={child}
                overview={overview}
                level={level + 1}
                connector={{ index, count: node.children.length }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Top-down department tree. The root sits above its branches. */
export function DepartmentOrganogram({
  nodes,
  overview,
}: {
  nodes: Node[]
  overview: TeamOverview
}) {
  const { t } = useTranslation('nav')
  if (nodes.length === 0) return null
  return (
    <div className="flex items-start gap-16" role="tree" aria-label={t('tabs.organogram.title')}>
      {nodes.map((node) => (
        <OrgNode key={node.department.id} node={node} overview={overview} level={1} />
      ))}
    </div>
  )
}

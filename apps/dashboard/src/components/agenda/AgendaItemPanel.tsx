import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FolderKanban, MessageSquare, Pause, Pencil, Play, Bot, X, Zap } from 'lucide-react'
import { Button } from '../ui/button'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import { itemEnd, itemStart, layerOf } from '../../lib/agenda-layout'
import { runTrigger, updateTrigger, type Trigger } from '../../lib/orchestration-api'
import { openEntityPath } from '../../lib/open-entity'
import { agendaStatusLabel } from '../../lib/status-labels'
import { triggerThreadPath, type TimeItem } from '../../lib/time-items'
import { cn } from '../../lib/utils'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  LAYER_DOT,
  LAYER_ICON,
  LAYER_TEXT,
  isFailed,
  itemSubtitle,
  relativeMoment,
  triggerScheduleLabel,
} from './agenda-style'
import type { AgendaSelection } from './AgendaTimeGrid'

type Props = {
  selection: AgendaSelection
  nowMs: number
  triggers: Trigger[]
  projectNames: Map<string, string>
  onSelect: (selection: AgendaSelection) => void
  onClose: () => void
  onEditTrigger: (trigger: Trigger) => void
  onOpenCalendar: (item: TimeItem) => void
  onChanged: () => void
}

export default function AgendaItemPanel(props: Props) {
  const { selection, onClose } = props
  const { t } = useTranslation('nav')
  return (
    <aside
      className="flex max-h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-xl border border-border/60 bg-bg-surface lg:sticky lg:top-4"
      data-testid="agenda-item-panel"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border/50 px-4 py-3">
        {selection.kind === 'item' ? (
          <ItemHeader item={selection.item} />
        ) : (
          <p className="text-sm font-semibold text-text-heading">
            {selection.title} <span className="font-normal text-text-muted">· {selection.items.length}</span>
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-text-muted hover:bg-bg-elevated hover:text-text-heading"
          aria-label={t('agendaPage.panel.close')}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selection.kind === 'item' ? <ItemBody {...props} item={selection.item} /> : <GroupBody {...props} items={selection.items} />}
      </div>
    </aside>
  )
}

function ItemHeader({ item }: { item: TimeItem }) {
  const { t } = useTranslation('nav')
  const layer = layerOf(item)
  const Icon = LAYER_ICON[layer]
  return (
    <div className="min-w-0">
      <p className={cn('mb-1 inline-flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide', LAYER_TEXT[layer])}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {t(`agendaPage.layers.${layer}`)}
      </p>
      <h2 className="text-base font-semibold leading-snug text-text-heading">{item.title}</h2>
    </div>
  )
}

function ItemBody({
  item,
  nowMs,
  triggers,
  projectNames,
  onEditTrigger,
  onOpenCalendar,
  onChanged,
}: Props & { item: TimeItem }) {
  const { t, i18n } = useTranslation('nav')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const start = itemStart(item)
  const end = itemEnd(item)
  const trigger = item.trigger_id ? triggers.find((row) => row.id === item.trigger_id) ?? null : null
  const isCheckup = item.kind === 'checkup'
  const conversation = item.kind !== 'calendar' ? triggerThreadPath(item) : null
  const projectName = item.project_id ? projectNames.get(item.project_id) : undefined
  const isPast = start.getTime() < nowMs
  const pointInTime = item.kind !== 'calendar' && !(item.end && end.getTime() - start.getTime() > 120_000)

  const act = async (key: string, run: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    setError(null)
    setNote(null)
    try {
      await run()
      if (done) setNote(done)
      onChanged()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.panel.actionError')))
    } finally {
      setBusy(null)
    }
  }

  const subtitle = itemSubtitle(item, t)

  return (
    <div className="space-y-4 px-4 py-3 text-sm">
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        <dt className="text-text-muted">{t('agendaPage.panel.when')}</dt>
        <dd className="text-text-heading">
          {formatAppDate(start, i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })}
          {item.all_day ? '' : ` · ${formatAppTime(start, i18n.language)}`}
          {!item.all_day && !pointInTime ? ` – ${formatAppTime(end, i18n.language)}` : ''}
          <span className="block text-xs text-text-muted">{relativeMoment(start.getTime(), nowMs, t)}</span>
        </dd>
        {subtitle ? (
          <>
            <dt className="text-text-muted">
              {item.kind === 'activity' ? t('agendaPage.panel.what') : item.kind === 'calendar' ? t('agendaPage.panel.calendars') : t('agendaPage.panel.who')}
            </dt>
            <dd className="text-text-heading">{subtitle}</dd>
          </>
        ) : null}
        {trigger && !isCheckup ? (
          <>
            <dt className="text-text-muted">{t('agendaPage.panel.rhythm')}</dt>
            <dd className="text-text-heading">
              {triggerScheduleLabel(trigger, t)}
              {!trigger.enabled ? <span className="ml-1.5 text-xs text-text-muted">({t('agendaPage.paused')})</span> : null}
            </dd>
          </>
        ) : null}
        {item.status && !['planned', 'calendar'].includes(item.status) && item.kind !== 'activity' ? (
          <>
            <dt className="text-text-muted">{t('agendaPage.panel.status')}</dt>
            <dd className={cn(isFailed(item.status) ? 'text-status-error' : item.status === 'due' ? 'text-status-warning' : 'text-text-heading')}>
              {agendaStatusLabel(item.status, t)}
            </dd>
          </>
        ) : null}
        {item.location ? (
          <>
            <dt className="text-text-muted">{t('agendaPage.calendar.location')}</dt>
            <dd className="text-text-heading">{item.location}</dd>
          </>
        ) : null}
      </dl>

      {isCheckup ? (
        <p className="rounded-lg bg-violet-500/10 px-3 py-2 text-xs text-text-secondary">{t('agendaPage.panel.checkupHint')}</p>
      ) : null}

      {item.instructions && item.kind !== 'checkup' ? (
        <p className="line-clamp-6 whitespace-pre-wrap rounded-lg bg-bg-elevated/60 px-3 py-2 text-xs text-text-secondary">
          {item.instructions}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {conversation ? (
          <PanelLink to={conversation} icon={MessageSquare} label={t('agendaPage.panel.openConversation')} />
        ) : null}
        {item.project_id ? (
          <PanelLink
            to={`/projects/${item.project_id}`}
            icon={FolderKanban}
            label={projectName ? t('agendaPage.panel.openProjectNamed', { name: projectName }) : t('agendaPage.panel.openProject')}
          />
        ) : null}
        {item.agent_id ? (
          <PanelLink
            to={`/agents/${item.agent_id}`}
            icon={Bot}
            label={item.agent_name ? t('agendaPage.panel.openAgentNamed', { name: item.agent_name }) : t('agendaPage.panel.openAgent')}
          />
        ) : null}
        {item.run_id && item.agent_id && isPast ? (
          <PanelLink
            to={openEntityPath({ type: 'run', id: item.run_id, agentId: item.agent_id })}
            icon={Zap}
            label={t('agendaPage.openRun')}
          />
        ) : null}
        {item.html_link ? (
          <a
            href={item.html_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-accent hover:bg-accent/10"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            {t('agendaPage.calendar.openExternal')}
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
        {item.kind === 'calendar' ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenCalendar(item)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('agendaPage.calendar.edit')}
          </Button>
        ) : null}
        {item.trigger_id && (trigger || isCheckup) ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy != null}
            onClick={() =>
              void act('run', () => runTrigger(item.trigger_id as string), t('agendaPage.panel.ran'))
            }
          >
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {busy === 'run' ? t('agendaPage.running') : isCheckup ? t('agendaPage.panel.checkNow') : t('agendaPage.runNow')}
          </Button>
        ) : null}
        {trigger && !isCheckup ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy != null}
              onClick={() => void act('toggle', () => updateTrigger(trigger.id, { enabled: !trigger.enabled }))}
            >
              {trigger.enabled ? (
                <Pause className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {trigger.enabled ? t('agendaPage.panel.pause') : t('agendaPage.panel.resume')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onEditTrigger(trigger)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t('agendaPage.edit')}
            </Button>
          </>
        ) : null}
      </div>
      {note ? <p className="text-xs text-status-success">{note}</p> : null}
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
    </div>
  )
}

function GroupBody({ items, onSelect }: Props & { items: TimeItem[] }) {
  const { t, i18n } = useTranslation('nav')
  return (
    <ul className="divide-y divide-border/40">
      {items.map((item) => {
        const layer = layerOf(item)
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect({ kind: 'item', item })}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-bg-elevated/60"
            >
              <span className="w-10 shrink-0 text-xs tabular-nums text-text-muted">
                {formatAppTime(itemStart(item), i18n.language)}
              </span>
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', LAYER_DOT[layer])} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text-heading">{item.title}</span>
                <span className="block truncate text-xs text-text-muted">{itemSubtitle(item, t)}</span>
              </span>
              {isFailed(item.status) ? (
                <span className="shrink-0 text-2xs text-status-error">{agendaStatusLabel(item.status, t)}</span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function PanelLink({ to, icon: Icon, label }: { to: string; icon: typeof MessageSquare; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-accent hover:bg-accent/10">
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  )
}

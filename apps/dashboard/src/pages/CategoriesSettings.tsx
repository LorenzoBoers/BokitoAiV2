/**
 * Tags (`/settings/action-tags`): one list of free tags and action tags,
 * backlog of unmatched patterns, and who may confirm tickets.
 *
 * Make an action tag by adding a tag, then Create flow. Filing rules live on
 * the flow page (Open flow).
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Radar, Users } from 'lucide-react'
import PageContent from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { TagRegistrySection } from '../components/inbox/TagRegistrySection'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { inboxPath } from '../lib/messages-paths'
import {
  dismissSignalBacklog,
  getSignalPolicy,
  listSignalBacklog,
  promoteSignalBacklog,
  saveSignalPolicy,
  type SignalAcceptRoles,
  type SignalBacklogEntry,
  type SignalPolicy,
} from '../lib/tickets-api'
import { listWorkstreams, type WorkstreamRow } from '../lib/workstreams-api'

export default function CategoriesSettings() {
  const { t } = useTranslation('nav')
  const [policy, setPolicy] = useState<SignalPolicy | null>(null)
  const [backlog, setBacklog] = useState<SignalBacklogEntry[]>([])
  const [savingPolicy, setSavingPolicy] = useState(false)

  const loadWorkstreams = useCallback(async () => {
    await listWorkstreams().catch(() => [] as WorkstreamRow[])
  }, [])

  const loadBacklog = useCallback(async () => {
    const res = await listSignalBacklog().catch(() => ({ items: [], threshold: 3 }))
    setBacklog(res.items)
  }, [])

  useEffect(() => {
    void loadWorkstreams().catch((err) =>
      toast.error(formatApiErrorMessage(err, t('categoriesPage.loadError'))),
    )
    void getSignalPolicy().then(setPolicy).catch(() => setPolicy(null))
    void loadBacklog()
  }, [loadWorkstreams, loadBacklog, t])

  const savePolicy = async (patch: { accept_roles?: SignalAcceptRoles; backlog_threshold?: number }) => {
    setSavingPolicy(true)
    try {
      setPolicy(await saveSignalPolicy(patch))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('categoriesPage.policyError')))
    } finally {
      setSavingPolicy(false)
    }
  }

  return (
    <PageContent width="md" className="space-y-6">
      <PageIntro description={t('categoriesPage.intro')} />

      <Card className="space-y-0 p-5">
        <TagRegistrySection onChanged={() => void loadWorkstreams()} />
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">{t('categoriesPage.backlogTitle')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t('categoriesPage.backlogDescription')}</p>
        </div>
        {backlog.length === 0 ? (
          <p className="text-xs text-text-muted">{t('categoriesPage.backlogEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {backlog.map((entry) => (
              <BacklogRow key={entry.key} entry={entry} onChanged={() => void loadBacklog()} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-2">
          <Users size={16} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
          <div>
            <h2 className="text-sm font-medium text-text-heading">{t('categoriesPage.policyTitle')}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{t('categoriesPage.policyDescription')}</p>
          </div>
        </div>
        {!policy ? (
          <LoadingBlock variant="inline" label={t('categoriesPage.loading')} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-text-heading">
                  {t('categoriesPage.acceptRolesLabel')}
                </p>
                <p className="mt-0.5 max-w-sm text-xs text-text-muted">{t('categoriesPage.acceptRolesHint')}</p>
              </div>
              <Select
                value={policy.accept_roles}
                disabled={savingPolicy}
                onValueChange={(value) => void savePolicy({ accept_roles: value as SignalAcceptRoles })}
              >
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admins">{t('categoriesPage.acceptAdmins')}</SelectItem>
                  <SelectItem value="members">{t('categoriesPage.acceptMembers')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-text-heading">
                  {t('categoriesPage.thresholdLabel')}
                </p>
                <p className="mt-0.5 max-w-sm text-xs text-text-muted">{t('categoriesPage.thresholdHint')}</p>
              </div>
              <Select
                value={String(policy.backlog_threshold)}
                disabled={savingPolicy}
                onValueChange={(value) => void savePolicy({ backlog_threshold: Number(value) })}
              >
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t('categoriesPage.thresholdOption', { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Card>

      <PageRelatedLinks
        links={[
          { to: inboxPath('all'), label: t('categoriesPage.crossLinks.communicationHub') },
          { to: '/workstreams', label: t('categoriesPage.crossLinks.playbooks') },
        ]}
      />
    </PageContent>
  )
}

function BacklogRow({ entry, onChanged }: { entry: SignalBacklogEntry; onChanged: () => void }) {
  const { t } = useTranslation('nav')
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(message)
      onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('categoriesPage.backlogError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-md border border-border/50 bg-bg-elevated px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-text-heading">
            <Radar size={14} className="shrink-0 text-text-muted" aria-hidden />
            <span className="truncate-fade">{entry.name}</span>
            <Badge variant={entry.ready ? 'accent' : 'neutral'} size="sm">
              {t('categoriesPage.backlogCount', { count: entry.count })}
            </Badge>
          </p>
          {entry.sentence ? <p className="mt-0.5 text-xs text-text-muted">{entry.sentence}</p> : null}
          {entry.examples[0] ? (
            <p className="mt-1 border-l-2 border-border/60 pl-2 text-xs italic text-text-secondary">
              {entry.examples[0]}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={entry.ready ? 'default' : 'outline'}
            disabled={busy}
            onClick={() => void act(() => promoteSignalBacklog(entry.key), t('categoriesPage.backlogPromoted'))}
          >
            <Plus size={13} className="mr-1" />
            {t('categoriesPage.backlogPromote')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => dismissSignalBacklog(entry.key), t('categoriesPage.backlogDismissed'))}
          >
            {t('categoriesPage.backlogDismiss')}
          </Button>
        </div>
      </div>
    </li>
  )
}

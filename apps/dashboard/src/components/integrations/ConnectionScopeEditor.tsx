import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { AccessPicker, type AccessState } from '../access/AccessPicker'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  getConnectionAccess,
  setConnectionAccess,
  setConnectionProjects,
  type ConnectionAccessLevel,
  type ConnectionProjectRef,
} from '../../lib/integrations-api'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { cn } from '../../lib/utils'

const CONNECTION_LEVELS = ['use', 'manage'] as const

/** Projects (exclusive scope) and Use/Manage access for one connection. */
export function ConnectionScopeEditor({
  connectionId,
  projects,
  onSaved,
  showProjects = true,
  accessHint,
}: {
  connectionId: string
  projects: ConnectionProjectRef[]
  onSaved?: () => Promise<void> | void
  /** Off for connections that are not project-scoped (calendars). */
  showProjects?: boolean
  accessHint?: string
}) {
  const { t } = useTranslation('nav')
  const [allProjects, setAllProjects] = useState<ProjectRow[] | null>(null)
  const [selected, setSelected] = useState<string[]>(() => projects.map((p) => p.id))
  const [access, setAccess] = useState<AccessState<ConnectionAccessLevel> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setSelected(projects.map((p) => p.id)), [projects])

  useEffect(() => {
    let alive = true
    if (showProjects) {
      listProjects()
        .then((rows) => alive && setAllProjects(rows))
        .catch(() => alive && setAllProjects([]))
    }
    getConnectionAccess(connectionId)
      .then((res) => alive && setAccess({ entries: res.entries, isDefault: res.is_default }))
      .catch(() => alive && setAccess({ entries: [], isDefault: true }))
    return () => {
      alive = false
    }
  }, [connectionId, showProjects])

  const dirty = useMemo(() => {
    const before = new Set(projects.map((p) => p.id))
    return selected.length !== before.size || selected.some((id) => !before.has(id))
  }, [projects, selected])

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const saveProjects = async () => {
    setBusy(true)
    try {
      await setConnectionProjects(connectionId, selected)
      await onSaved?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('integrations.connections.projectsSaveError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('grid gap-4', showProjects && 'sm:grid-cols-[1fr_auto]')}>
      {showProjects ? (
        <div className="min-w-0 space-y-2">
          <div>
            <p className="text-xs font-medium text-text-heading">{t('integrations.connections.projects')}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {selected.length === 0
                ? t('integrations.connections.projectsAllHint')
                : t('integrations.connections.projectsExclusiveHint')}
            </p>
          </div>
          {allProjects == null ? null : allProjects.length === 0 ? (
            <p className="text-xs text-text-muted">{t('integrations.connections.projectsNone')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {allProjects.map((project) => {
                const on = selected.includes(project.id)
                return (
                  <button
                    key={project.id}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => toggle(project.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
                      on
                        ? 'border-accent/50 bg-accent/10 text-text-heading'
                        : 'border-border/60 text-text-secondary hover:border-border-light',
                    )}
                  >
                    {on ? <Check size={11} aria-hidden /> : null}
                    {project.name}
                  </button>
                )
              })}
            </div>
          )}
          {dirty ? (
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void saveProjects()}>
                {t('integrations.connections.projectsSave')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setSelected(projects.map((p) => p.id))}
              >
                {t('common:cancel', { defaultValue: 'Cancel' })}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-xs font-medium text-text-heading">{t('integrations.connections.access')}</p>
        {accessHint ? <p className="text-xs text-text-muted">{accessHint}</p> : null}
        {access ? (
          <AccessPicker
            access={access}
            levels={CONNECTION_LEVELS}
            canEdit
            copy={{
              title: t('connectionAccess.title'),
              description: t('connectionAccess.description'),
              hint: t('connectionAccess.hint'),
              adminsNote: t('connectionAccess.adminsNote'),
            }}
            save={async (entries) => {
              const res = await setConnectionAccess(connectionId, entries)
              return { entries: res.entries, isDefault: res.is_default }
            }}
            onChanged={(next) => {
              setAccess(next)
              void onSaved?.()
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

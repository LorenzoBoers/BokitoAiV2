import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Workflow } from 'lucide-react'
import { Button } from '../ui/button'
import {
  installModuleTagTemplate,
  installModuleTemplate,
  listModuleTagTemplates,
  listModuleTemplates,
  type ModuleTagTemplate,
  type ModuleWorkstreamTemplate,
} from '../../lib/integrations-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { Hashtag } from '../ui/HashtagMark'

/** Workstream templates a module ships: install copies them to the tenant. */
export function ModuleTemplatesPanel({ slug }: { slug: string }) {
  const { t } = useTranslation(['nav', 'common'])
  const [rows, setRows] = useState<ModuleWorkstreamTemplate[]>([])
  const [tags, setTags] = useState<ModuleTagTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [installedId, setInstalledId] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const [ws, tagRows] = await Promise.all([
        listModuleTemplates(slug),
        listModuleTagTemplates(slug).catch(() => []),
      ])
      setRows(ws)
      setTags(tagRows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [slug])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const install = async (templateSlug: string) => {
    setBusySlug(templateSlug)
    try {
      const res = await installModuleTemplate(slug, templateSlug)
      setInstalledId((prev) => ({ ...prev, [templateSlug]: res.workstream.id }))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusySlug(null)
    }
  }

  const installTag = async (templateSlug: string) => {
    setBusySlug(templateSlug)
    try {
      await installModuleTagTemplate(slug, templateSlug)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusySlug(null)
    }
  }

  if (rows.length === 0 && tags.length === 0 && !error) return null

  return (
    <section>
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-text-primary">
        <Workflow size={14} />
        {t('integrations.modules.templates.title', { defaultValue: 'Workstream templates' })}
      </h3>
      <p className="mb-3 max-w-2xl text-xs text-text-muted">
        {t('integrations.modules.templates.intro', {
          defaultValue:
            'Pre-built workstreams this module ships. Installing copies the workstream to your workspace; you own and can edit the copy.',
        })}
      </p>
      {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.slug}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text-primary">{row.name}</div>
              <p className="mt-0.5 text-xs text-text-secondary">{row.description}</p>
              <p className="mt-1 text-xs text-text-muted">
                {t('integrations.modules.templates.stageCount', {
                  defaultValue: 'Flow template',
                  count: row.steps_count,
                })}
              </p>
              {row.problems.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-status-warning">
                  {row.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {installedId[row.slug] ? (
                <Button asChild size="sm" variant="secondary">
                  <Link to={workstreamPath(installedId[row.slug])}>
                    {t('integrations.modules.templates.open', { defaultValue: 'Open workstream' })}
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={!row.installable || busySlug === row.slug}
                  onClick={() => void install(row.slug)}
                >
                  {row.already_installed
                    ? t('integrations.modules.templates.installAgain', {
                        defaultValue: 'Install again',
                      })
                    : t('integrations.modules.templates.install', { defaultValue: 'Install' })}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {tags.length > 0 ? (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">
            {t('integrations.modules.templates.hashtagsTitle', { defaultValue: 'Hashtags' })}
          </h3>
          {tags.map((row) => (
            <div
              key={row.slug}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-primary">
                  <Hashtag name={row.name} />
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">{row.description}</p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={row.already_installed || busySlug === row.slug}
                onClick={() => void installTag(row.slug)}
              >
                {row.already_installed
                  ? t('integrations.modules.templates.installed', { defaultValue: 'Installed' })
                  : t('integrations.modules.templates.install', { defaultValue: 'Install' })}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

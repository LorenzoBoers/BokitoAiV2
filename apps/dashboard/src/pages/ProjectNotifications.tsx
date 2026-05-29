import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { LoadingBlock } from '../components/ui/loading-block'
import { ProjectShell } from '../components/project/ProjectShell'
import { useProjectContext } from '../context/ProjectContext'
import {
  getProjectNotificationPrefs,
  patchProjectNotificationPrefs,
  type NotificationChannel,
  type NotificationEventType,
  type ProjectNotificationPreference,
} from '../lib/project-notifications-api'

const EVENTS: readonly NotificationEventType[] = ['decisions', 'updates', 'failures', 'tokens']
const CHANNELS: readonly NotificationChannel[] = ['desktop', 'email', 'mobile']

function prefKey(event: NotificationEventType, channel: NotificationChannel): string {
  return `${event}:${channel}`
}

export default function ProjectNotifications() {
  const { t } = useTranslation('nav')
  const { projectId } = useProjectContext()
  const [prefs, setPrefs] = useState<ProjectNotificationPreference[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getProjectNotificationPrefs(projectId)
      setPrefs(res.preferences)
    } catch (err) {
      setPrefs([])
      setError(err instanceof Error ? err.message : t('project.notifications.loadError'))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    void load()
  }, [load])

  const prefMap = new Map(prefs.map((p) => [prefKey(p.event_type, p.channel), p.enabled]))

  const toggle = async (event: NotificationEventType, channel: NotificationChannel, enabled: boolean) => {
    const next = [...prefs]
    const idx = next.findIndex((p) => p.event_type === event && p.channel === channel)
    if (idx >= 0) next[idx] = { ...next[idx], enabled }
    else next.push({ event_type: event, channel, enabled })
    setPrefs(next)
    setSaving(true)
    setError(null)
    try {
      const res = await patchProjectNotificationPrefs(projectId, next)
      setPrefs(res.preferences)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.notifications.saveError'))
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProjectShell>
      <Card>
        <CardHeader>
          <p className="text-sm text-text-muted">{t('project.notifications.description')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <LoadingBlock label={t('project.notifications.loading')} />
          ) : (
            <>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="overflow-hidden rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-bg-muted/40 text-text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">
                        {t('project.notifications.eventColumn')}
                      </th>
                      {CHANNELS.map((channel) => (
                        <th key={channel} className="px-3 py-2 text-center font-medium">
                          {t(`project.notifications.channels.${channel}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {EVENTS.map((event) => (
                      <tr key={event} className="border-t border-border/50">
                        <td className="px-3 py-2.5">
                          <Label className="font-normal text-text-primary">
                            {t(`project.notifications.events.${event}`)}
                          </Label>
                        </td>
                        {CHANNELS.map((channel) => {
                          const enabled = prefMap.get(prefKey(event, channel)) ?? false
                          return (
                            <td key={channel} className="px-3 py-2.5 text-center">
                              <Switch
                                checked={enabled}
                                disabled={saving}
                                onCheckedChange={(checked) =>
                                  void toggle(event, channel, checked)
                                }
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </ProjectShell>
  )
}

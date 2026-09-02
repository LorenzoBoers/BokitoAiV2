import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'
import {
  erasePrivacySubject,
  exportPrivacySubject,
  getPrivacySettings,
  patchPrivacySettings,
  type PrivacySettings,
} from '../lib/privacy-api'

const LEGAL_BASE = 'https://github.com/bokito-ai/bokito/blob/master/docs/legal'

export default function TrustPrivacyPage() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [settings, setSettings] = useState<PrivacySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subjectEmail, setSubjectEmail] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setSettings(await getPrivacySettings())
    } catch (err) {
      setError(formatApiErrorMessage(err, t('trustPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (patch: Partial<PrivacySettings>) => {
    setSaving(true)
    try {
      const next = await patchPrivacySettings(patch)
      setSettings(next)
      toast.success(t('trustPage.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('trustPage.saveError')))
    } finally {
      setSaving(false)
    }
  }

  const runExport = async () => {
    if (!subjectEmail.trim()) {
      toast.error(t('trustPage.emailRequired'))
      return
    }
    setBusyAction('export')
    try {
      const pkg = await exportPrivacySubject(subjectEmail.trim())
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `privacy-export-${subjectEmail.trim().toLowerCase()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t('trustPage.exportDone'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('trustPage.exportError')))
    } finally {
      setBusyAction(null)
    }
  }

  const runErase = async () => {
    if (!subjectEmail.trim()) {
      toast.error(t('trustPage.emailRequired'))
      return
    }
    if (!window.confirm(t('trustPage.eraseConfirm'))) return
    setBusyAction('erase')
    try {
      await erasePrivacySubject(subjectEmail.trim())
      toast.success(t('trustPage.eraseDone'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('trustPage.eraseError')))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <PageContent width="md" className="space-y-6">
      <ContentHeader title={t('trustPage.title')} subtitle={t('trustPage.subtitle')} />

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <section className="space-y-3 rounded-xl border border-border/60 bg-bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-heading">{t('trustPage.legalTitle')}</h2>
        <p className="text-xs text-text-muted">{t('trustPage.legalBody')}</p>
        <ul className="space-y-1 text-sm">
          {(
            [
              ['DPA.md', t('trustPage.linkDpa')],
              ['PRIVACY.md', t('trustPage.linkPrivacy')],
              ['SUBPROCESSORS.md', t('trustPage.linkSubprocessors')],
              ['SECURITY.md', t('trustPage.linkSecurity')],
            ] as const
          ).map(([file, label]) => (
            <li key={file}>
              <a
                className="text-accent hover:underline"
                href={`/docs/govern/privacy-security`}
              >
                {label}
              </a>
              <span className="text-text-muted"> · </span>
              <a
                className="text-xs text-text-muted hover:underline"
                href={`${LEGAL_BASE}/${file}`}
                target="_blank"
                rel="noreferrer"
              >
                {file}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-xl border border-border/60 bg-bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-heading">{t('trustPage.retentionTitle')}</h2>
        {loading || !settings ? (
          <p className="text-sm text-text-muted">{t('trustPage.loading')}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ret-msg">{t('trustPage.retentionMessages')}</Label>
                <Input
                  id="ret-msg"
                  type="number"
                  min={30}
                  max={3650}
                  className="h-9"
                  value={settings.retention_messages_days}
                  disabled={saving}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      retention_messages_days: Number(e.target.value) || 365,
                    })
                  }
                  onBlur={() =>
                    void save({ retention_messages_days: settings.retention_messages_days })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ret-cal">{t('trustPage.retentionCalendar')}</Label>
                <Input
                  id="ret-cal"
                  type="number"
                  min={30}
                  max={3650}
                  className="h-9"
                  value={settings.retention_calendar_days}
                  disabled={saving}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      retention_calendar_days: Number(e.target.value) || 365,
                    })
                  }
                  onBlur={() =>
                    void save({ retention_calendar_days: settings.retention_calendar_days })
                  }
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2">
              <div>
                <p className="text-sm font-medium">{t('trustPage.llmBodies')}</p>
                <p className="text-xs text-text-muted">{t('trustPage.llmBodiesHint')}</p>
              </div>
              <Switch
                checked={settings.llm_may_use_message_bodies}
                disabled={saving}
                onCheckedChange={(checked) => {
                  setSettings({ ...settings, llm_may_use_message_bodies: checked })
                  void save({ llm_may_use_message_bodies: checked })
                }}
              />
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border/60 bg-bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-heading">{t('trustPage.dsarTitle')}</h2>
        <p className="text-xs text-text-muted">{t('trustPage.dsarBody')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="subject">{t('trustPage.subjectEmail')}</Label>
          <Input
            id="subject"
            type="email"
            className="h-9"
            value={subjectEmail}
            onChange={(e) => setSubjectEmail(e.target.value)}
            placeholder="person@example.com"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busyAction != null}
            onClick={() => void runExport()}
          >
            {t('trustPage.export')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busyAction != null}
            onClick={() => void runErase()}
          >
            {t('trustPage.erase')}
          </Button>
        </div>
      </section>
    </PageContent>
  )
}

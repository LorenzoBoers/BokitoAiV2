import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Button } from '../components/ui/button'
import { useConfirm } from '../components/ui/confirm-dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'
import {
  getTenantModels,
  setDataRegionPolicy,
  type DataRegionBlock,
} from '../lib/models-api'
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
  const { token, currentTenantRole } = useAuth()
  const confirm = useConfirm()
  const isOwnerOrAdmin = currentTenantRole === 'owner' || currentTenantRole === 'admin'
  const [settings, setSettings] = useState<PrivacySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subjectEmail, setSubjectEmail] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [region, setRegion] = useState<DataRegionBlock | null>(null)
  const [regionBusy, setRegionBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const [privacy, models] = await Promise.all([
        getPrivacySettings(),
        getTenantModels(token).catch(() => null),
      ])
      setSettings(privacy)
      setRegion(models?.data_region ?? null)
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
    if (!(await confirm({ description: t('trustPage.eraseConfirm'), destructive: true }))) return
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

  const allowUs = region?.non_eu_platform_models === 'allowed'

  const handleRegionPolicy = async (nextAllowUs: boolean) => {
    if (!token || regionBusy || !isOwnerOrAdmin) return
    setRegionBusy(true)
    try {
      const payload = await setDataRegionPolicy(token, nextAllowUs ? 'allowed' : 'blocked')
      setRegion(payload.data_region ?? null)
      toast.success(t('trustPage.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('trustPage.saveError')))
    } finally {
      setRegionBusy(false)
    }
  }

  return (
    <PageContent width="md" className="space-y-6">
      <ContentHeader title={t('trustPage.title')} subtitle={t('trustPage.subtitle')} />

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <section className="panel space-y-3 p-4">
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

      <section className="panel space-y-4 p-4">
        <h2 className="text-sm font-semibold text-text-heading">{t('trustPage.retentionTitle')}</h2>
        {loading || !settings ? (
          <p className="text-sm text-text-muted">{t('trustPage.loading')}</p>
        ) : (
          <>
            <div className="max-w-sm space-y-1.5">
                <Label htmlFor="ret-workspace">{t('trustPage.retentionWorkspace')}</Label>
                <Input
                  id="ret-workspace"
                  type="number"
                  min={30}
                  max={3650}
                  className="h-9"
                  value={settings.workspace_retention_days}
                  disabled={saving}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      workspace_retention_days: Number(e.target.value) || 365,
                    })
                  }
                  onBlur={() =>
                    void save({ workspace_retention_days: settings.workspace_retention_days })
                  }
                />
                <p className="text-xs text-text-muted">{t('trustPage.retentionWorkspaceHint')}</p>
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

      <section className="panel space-y-4 p-4">
        <h2 className="text-sm font-semibold text-text-heading">{t('trustPage.region.title')}</h2>
        <p className="text-xs text-text-muted">{t('trustPage.region.body')}</p>
        {region?.eu_share_pct_30d != null && region.eu_share_pct_30d > 0 ? (
          <p className="text-sm text-text-primary">
            {t('trustPage.region.euShare30d')}: {region.eu_share_pct_30d}%
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2">
          <div>
            <p className="text-sm font-medium">{t('trustPage.region.allowUs')}</p>
            <p className="text-xs text-text-muted">{t('trustPage.region.allowUsHint')}</p>
          </div>
          <Switch
            checked={allowUs}
            disabled={regionBusy || !isOwnerOrAdmin || !region}
            onCheckedChange={(checked) => void handleRegionPolicy(checked)}
          />
        </div>
        {region && region.non_eu_models_in_use.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-text-primary">{t('trustPage.region.inUseTitle')}</p>
            <ul className="flex flex-wrap gap-2">
              {region.non_eu_models_in_use.map((slug) => (
                <li
                  key={slug}
                  className="rounded-md border border-border/60 px-3 py-1.5 text-sm text-text-primary"
                >
                  {slug}
                </li>
              ))}
            </ul>
            {!allowUs ? (
              <p className="text-xs text-text-muted">{t('trustPage.region.inUseBlockedHint')}</p>
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-text-muted">{t('trustPage.region.embeddingNote')}</p>
      </section>

      <section className="panel space-y-3 p-4">
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

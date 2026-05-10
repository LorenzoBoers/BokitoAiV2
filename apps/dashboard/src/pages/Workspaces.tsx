import { useState } from 'react'
import { Building2, CirclePlus, ExternalLink, Plus } from 'lucide-react'
import { getAvatarColor } from '../lib/avatar'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../context/WorkspaceContext'
import { useTranslation } from 'react-i18next'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { buildTenantOrigin, buildTenantWorkspaceUrl } from '../lib/host-routing'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam'
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

function normalizeSubdomainInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

function validateSubdomain(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (!v) return 'Subdomein is verplicht.'
  if (!SUBDOMAIN_REGEX.test(v)) {
    return 'Gebruik 3-63 tekens: a-z, 0-9, en "-" (niet starten/eindigen met "-").'
  }
  return null
}

export default function Workspaces() {
  const { t } = useTranslation('workspaces')
  const navigate = useNavigate()
  const { currentWorkspace, workspaces, workspaceLoading, createWorkspace, switchWorkspace } = useWorkspace()

  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSubdomain, setWorkspaceSubdomain] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subdomainError, setSubdomainError] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const handleCreateWorkspace = async () => {
    if (!workspaceName.trim()) return
    const normalizedSubdomain = workspaceSubdomain.trim().toLowerCase()
    const validationError = validateSubdomain(normalizedSubdomain)
    if (validationError) {
      setSubdomainError(validationError)
      return
    }
    setCreateLoading(true)
    setError(null)
    setSubdomainError(null)
    try {
      const createdWorkspace = await createWorkspace({
        name: workspaceName.trim(),
        timezone: DEFAULT_TIMEZONE,
        subdomain: normalizedSubdomain,
      })
      setWorkspaceName('')
      setWorkspaceSubdomain('')
      await switchWorkspace(createdWorkspace.id)
      setCreateDialogOpen(false)
      navigate('/settings/general', { replace: true })
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : t('cards.create.error')
      setError(message)
    } finally {
      setCreateLoading(false)
    }
  }

  if (workspaceLoading) {
    return (
      <div className="mx-auto w-full max-w-[920px] px-2 py-6">
        <p className="text-sm text-text-muted">{t('loading')}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-[860px] space-y-10">
        <section className="space-y-1.5 text-center">
          <h2 className="text-[28px] font-semibold leading-tight text-text-heading">{t('title')}</h2>
          <p className="text-sm text-text-secondary">{t('description')}</p>
        </section>

        <div className="space-y-4">
          <div className={`grid gap-4 ${workspaces.length === 0 ? 'mx-auto max-w-[460px] grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
            {workspaces.map((workspace) => {
              const isCurrent = currentWorkspace?.id === workspace.id
              const hasSubdomain = Boolean(workspace.slug && workspace.slug.trim())
              const tenantOrigin = workspace.slug ? buildTenantOrigin(workspace.slug) : null
              const tenantUrl = tenantOrigin ?? null
              const { bg, text } = getAvatarColor(workspace.name)
              const initials = workspace.name
                .split(/\s+/)
                .filter(Boolean)
                .map((w) => w[0] ?? '')
                .slice(0, 2)
                .join('')
                .toUpperCase()
              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={async () => {
                    if (!hasSubdomain) {
                      navigate('/settings/branding')
                      return
                    }
                    const tenantSlug = workspace.slug || ''
                    const tenantUrl = buildTenantWorkspaceUrl(tenantSlug, '/support/inbox/all')
                    if (!tenantUrl) {
                      navigate('/settings/branding')
                      return
                    }
                    try {
                      if (typeof window !== 'undefined') {
                        window.location.assign(tenantUrl)
                      }
                    } catch (openError) {
                      const message = openError instanceof Error ? openError.message : 'Tenant openen mislukt'
                      setError(message)
                    }
                  }}
                  className={`rounded-xl border p-5 text-left transition-colors ${
                    isCurrent
                      ? 'border-accent/45 bg-accent/10'
                      : 'border-border/70 bg-bg-elevated/40 hover:bg-bg-hover/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Logo or initials */}
                      {workspace.logo ? (
                        <img
                          src={workspace.logo}
                          alt={workspace.name}
                          className="w-10 h-10 rounded-lg object-contain border border-border/50 bg-bg-surface/60 shrink-0"
                        />
                      ) : (
                        <span
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-[15px] font-bold shrink-0"
                          style={{ background: bg, color: text }}
                        >
                          {initials}
                        </span>
                      )}
                      <div className="space-y-0.5 min-w-0">
                        <p className="text-[18px] font-semibold text-text-heading leading-tight">{workspace.name}</p>
                        <p className="text-xs uppercase tracking-[0.08em] text-text-muted">
                          {workspace.slug || t('cards.workspace.defaultSlug')}
                        </p>
                        {tenantUrl ? (
                          <p className="text-[11px] text-text-secondary truncate">{tenantUrl}</p>
                        ) : (
                          <p className="text-[11px] text-status-error">Subdomein vereist om tenant te openen</p>
                        )}
                      </div>
                    </div>
                    {isCurrent ? (
                      <span className="rounded-md border border-border/70 bg-bg-hover px-2 py-1 text-[11px] text-text-muted shrink-0">
                        {t('cards.workspace.current')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-5 flex items-center gap-2 text-sm text-text-secondary">
                    <Building2 size={14} className="text-text-muted" />
                    <span>{hasSubdomain ? t('cards.workspace.openCta') : 'Stel eerst subdomein in'}</span>
                    <ExternalLink size={13} className="text-text-muted" />
                  </div>
                </button>
              )
            })}

            <button
              type="button"
              onClick={() => {
                setError(null)
                setCreateDialogOpen(true)
              }}
              className="attention-glow rounded-xl border border-dashed border-accent/45 p-5 text-left transition-colors hover:bg-bg-hover/50"
            >
              <div className="space-y-2">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-bg-hover/70">
                  <CirclePlus size={18} className="text-text-muted" />
                </div>
                <p className="text-[18px] font-semibold text-text-heading">{t('cards.create.title')}</p>
                <p className="text-sm text-text-secondary">{t('cards.create.description')}</p>
              </div>
              <div className="mt-5 flex items-center gap-2 text-sm text-text-secondary">
                <Plus size={14} className="text-text-muted" />
                <span>{t('cards.create.openDialogCta')}</span>
              </div>
            </button>
          </div>

          <Card className="space-y-3 p-5">
            <p className="text-sm font-medium text-text-heading">{t('help.title')}</p>
            <div className="space-y-2">
              <a href="#" className="block rounded-md px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary">
                {t('help.items.docs')}
              </a>
              <a href="#" className="block rounded-md px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary">
                {t('help.items.community')}
              </a>
              <a href="#" className="block rounded-md px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary">
                {t('help.items.videos')}
              </a>
              <a href="#" className="block rounded-md px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary">
                {t('help.items.support')}
              </a>
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('createDialog.title')}</DialogTitle>
              <DialogDescription>{t('createDialog.description')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                autoFocus
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder={t('cards.create.inputPlaceholder')}
              />
              <div className="flex items-center">
                <Input
                  value={workspaceSubdomain}
                  onChange={(event) => {
                    const next = normalizeSubdomainInput(event.target.value)
                    setWorkspaceSubdomain(next)
                    if (subdomainError) setSubdomainError(validateSubdomain(next))
                  }}
                  placeholder="subdomein"
                  className="rounded-r-none"
                />
                <span className="px-3 py-2 bg-bg-hover border border-l-0 border-border/55 text-[12px] text-text-muted whitespace-nowrap rounded-r-md">
                  .bokito.ai
                </span>
              </div>
              {subdomainError ? <p className="text-sm text-status-error">{subdomainError}</p> : null}
              {error ? <p className="text-sm text-status-error">{error}</p> : null}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="secondary" onClick={() => setCreateDialogOpen(false)}>
                {t('createDialog.cancel')}
              </Button>
              <Button
                onClick={() => void handleCreateWorkspace()}
                disabled={!workspaceName.trim() || !workspaceSubdomain.trim() || Boolean(validateSubdomain(workspaceSubdomain)) || createLoading}
              >
                <Plus size={14} />
                {createLoading ? t('cards.create.creating') : t('cards.create.button')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  )
}

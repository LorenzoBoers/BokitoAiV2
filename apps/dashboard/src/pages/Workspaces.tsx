import { useMemo, useState } from 'react'
import { ArrowRight, Building2, CirclePlus, Copy, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getAvatarColor } from '../lib/avatar'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../context/WorkspaceContext'
import { useTranslation } from 'react-i18next'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { buildTenantOrigin, isLocalHostname } from '../lib/host-routing'
import { useAuth } from '../context/AuthContext'
import { inboxPath } from '../lib/messages-paths'
import { normalizeWorkspaceSubdomain, validateWorkspaceSubdomain } from '../lib/workspace-subdomain'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam'

export default function Workspaces() {
  const { t } = useTranslation('workspaces')
  const navigate = useNavigate()
  const { currentWorkspace, workspaces, workspaceLoading, createWorkspace, switchWorkspace } = useWorkspace()
  const { token } = useAuth()

  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSubdomain, setWorkspaceSubdomain] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subdomainError, setSubdomainError] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [workspaceQuery, setWorkspaceQuery] = useState('')

  const handleCreateWorkspace = async () => {
    if (!workspaceName.trim()) return
    const normalizedSubdomain = normalizeWorkspaceSubdomain(workspaceSubdomain)
    const validationCode = validateWorkspaceSubdomain(normalizedSubdomain)
    if (validationCode) {
      setSubdomainError(
        validationCode === 'required' ? t('cards.create.subdomainRequired') : t('cards.create.subdomainFormat'),
      )
      return
    }
    setCreateLoading(true)
    setError(null)
    setSubdomainError(null)
    try {
      await createWorkspace({
        name: workspaceName.trim(),
        timezone: DEFAULT_TIMEZONE,
        subdomain: normalizedSubdomain,
      })
      // createWorkspace adopts the new workspace session and fully reloads
      // the app into the fresh tenant; nothing else to do here.
      setWorkspaceName('')
      setWorkspaceSubdomain('')
      setCreateDialogOpen(false)
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : t('cards.create.error')
      setError(message)
    } finally {
      setCreateLoading(false)
    }
  }

  const visibleWorkspaces = useMemo(() => {
    const q = workspaceQuery.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter((workspace) => {
      const hay = `${workspace.name} ${workspace.slug ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [workspaces, workspaceQuery])

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
          {workspaces.length > 3 ? (
            <Input
              value={workspaceQuery}
              onChange={(event) => setWorkspaceQuery(event.target.value)}
              placeholder={t('searchPlaceholder')}
              className="mx-auto max-w-sm"
              aria-label={t('searchPlaceholder')}
            />
          ) : null}
          <div className={`grid gap-4 ${workspaces.length === 0 ? 'mx-auto max-w-[460px] grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
            {visibleWorkspaces.length === 0 && workspaceQuery.trim() ? (
              <p className="col-span-full text-center text-sm text-text-muted">{t('filterEmpty')}</p>
            ) : null}
            {visibleWorkspaces.map((workspace) => {
              const isCurrent = currentWorkspace?.id === workspace.id
              const hasSubdomain = Boolean(workspace.slug && workspace.slug.trim())
              const tenantOrigin = workspace.slug ? buildTenantOrigin(workspace.slug) : null
              const sameOrigin =
                typeof window !== 'undefined' &&
                (isLocalHostname(window.location.hostname) || tenantOrigin === window.location.origin)
              const tenantUrl = tenantOrigin && !sameOrigin ? tenantOrigin : null
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
                    await switchWorkspace(workspace.id)
                    navigate(inboxPath('open'), { replace: true })
                  }}
                  className={`rounded-xl border p-5 text-left shadow-card hover-lift ${
                    isCurrent
                      ? 'border-accent/45 bg-accent/10'
                      : 'border-border/60 bg-bg-surface hover:border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Logo or initials */}
                      {workspace.logo ? (
                        <img
                          src={workspace.logo}
                          alt={workspace.name}
                          className="w-10 h-10 rounded-lg object-contain border border-border/60 bg-bg-elevated shrink-0"
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
                        <p className="flex items-center gap-1 text-xs uppercase tracking-[0.08em] text-text-muted">
                          <span>{workspace.slug || t('cards.workspace.defaultSlug')}</span>
                          {workspace.slug ? (
                            <span
                              role="button"
                              tabIndex={0}
                              className="inline-flex rounded p-0.5 text-text-muted hover:text-accent"
                              title={t('copySlug')}
                              onClick={(event) => {
                                event.stopPropagation()
                                void navigator.clipboard.writeText(workspace.slug).then(
                                  () => toast.success(t('copied')),
                                  () => toast.error(t('cards.create.error')),
                                )
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return
                                event.preventDefault()
                                event.stopPropagation()
                                void navigator.clipboard.writeText(workspace.slug)
                              }}
                            >
                              <Copy className="h-3 w-3" aria-hidden />
                              <span className="sr-only">{t('copySlug')}</span>
                            </span>
                          ) : null}
                        </p>
                        {tenantUrl ? (
                          <p className="text-[11px] text-text-secondary truncate">{tenantUrl}</p>
                        ) : !hasSubdomain ? (
                          <p className="text-[11px] text-status-error">{t('cards.workspace.subdomainRequired')}</p>
                        ) : null}
                      </div>
                    </div>
                    {isCurrent ? (
                      <span className="rounded-md border border-border/60 bg-bg-hover px-2 py-1 text-[11px] text-text-muted shrink-0">
                        {t('cards.workspace.current')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-5 flex items-center gap-2 text-sm text-text-secondary">
                    <Building2 size={14} className="text-text-muted" />
                    <span>{hasSubdomain ? t('cards.workspace.openCta') : t('cards.workspace.setSubdomainCta')}</span>
                    <ArrowRight size={13} className="text-text-muted" />
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
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCreateWorkspace()
                  }
                }}
                placeholder={t('cards.create.inputPlaceholder')}
              />
              <div className="flex items-center">
                <Input
                  value={workspaceSubdomain}
                  onChange={(event) => {
                    const next = normalizeWorkspaceSubdomain(event.target.value)
                    setWorkspaceSubdomain(next)
                    if (subdomainError) {
                      const code = validateWorkspaceSubdomain(next)
                      setSubdomainError(
                        code === 'required'
                          ? t('cards.create.subdomainRequired')
                          : code === 'format'
                            ? t('cards.create.subdomainFormat')
                            : null,
                      )
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleCreateWorkspace()
                    }
                  }}
                  placeholder={t('cards.create.subdomainPlaceholder')}
                  className="rounded-r-none"
                />
                <span className="px-3 py-2 bg-bg-hover border border-l-0 border-border/60 text-[12px] text-text-muted whitespace-nowrap rounded-r-md">
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
                disabled={!workspaceName.trim() || !workspaceSubdomain.trim() || Boolean(validateWorkspaceSubdomain(workspaceSubdomain)) || createLoading}
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

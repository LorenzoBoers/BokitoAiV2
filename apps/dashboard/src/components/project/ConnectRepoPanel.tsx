import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  connectProjectRepo,
  disconnectProjectRepo,
  reindexProjectRepo,
  type ProjectRow,
} from '../../lib/projects-api'
import {
  listGithubBranches,
  listGithubConnections,
  listGithubRepos,
  startGithubOAuth,
  type GithubConnectionRow,
  type GithubRepoRow,
} from '../../lib/github-api'

type ConnectRepoPanelProps = {
  projectId: string
  project?: ProjectRow | null
  oauthConnected?: boolean
  onConnected?: () => void
  onProjectUpdated?: () => void
}

export function ConnectRepoPanel({
  projectId,
  project,
  oauthConnected = false,
  onConnected,
  onProjectUpdated,
}: ConnectRepoPanelProps) {
  const { t } = useTranslation(['nav', 'common'])
  const [connections, setConnections] = useState<GithubConnectionRow[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [connectionLogin, setConnectionLogin] = useState<string | null>(null)
  const [repos, setRepos] = useState<GithubRepoRow[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [selectedRepo, setSelectedRepo] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('main')
  const [repoSearch, setRepoSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(oauthConnected)
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)

  const linkedRepo = project?.github_repo_full_name ?? null

  const loadConnection = useCallback(async () => {
    setConnectionError(null)
    try {
      const list = await listGithubConnections()
      setConnections(list)
      const preferred =
        project?.github_connection_id && list.find((c) => c.id === project.github_connection_id)
          ? project.github_connection_id
          : list[0]?.id ?? ''
      setSelectedConnectionId(preferred)
      const active = list.find((c) => c.id === preferred) ?? list[0]
      setConnectionLogin(active?.github_login ?? null)
      if (list.some((c) => c.status === 'active')) setShowPicker(true)
    } catch {
      setConnectionError(t('project.settings.repo.connectionLoadError'))
      setConnectionLogin(null)
      setConnections([])
    }
  }, [project?.github_connection_id, t])

  const loadRepos = useCallback(async () => {
    if (!selectedConnectionId && connections.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const rows = await listGithubRepos(selectedConnectionId || undefined)
      setRepos(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('project.settings.repo.loadReposError'))
      setRepos([])
    } finally {
      setLoading(false)
    }
  }, [selectedConnectionId, connections.length, t])

  useEffect(() => {
    void loadConnection()
  }, [loadConnection])

  useEffect(() => {
    if ((showPicker || oauthConnected) && selectedConnectionId) void loadRepos()
  }, [showPicker, oauthConnected, loadRepos, selectedConnectionId])

  useEffect(() => {
    if (!selectedRepo) {
      setBranches([])
      return
    }
    const [owner, name] = selectedRepo.split('/')
    if (!owner || !name) return
    listGithubBranches(owner, name, selectedConnectionId || undefined)
      .then((rows) => setBranches(rows))
      .catch(() => setBranches(['main']))
  }, [selectedRepo, selectedConnectionId])

  async function handleConnectOAuth() {
    setError(null)
    const returnUrl = `${window.location.origin}${window.location.pathname}?github_pending=1`
    try {
      const { authorize_url } = await startGithubOAuth(returnUrl, projectId)
      window.location.assign(authorize_url)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('project.settings.repo.oauthError'))
    }
  }

  async function handleLinkRepo() {
    if (!selectedRepo) return
    setLoading(true)
    setError(null)
    try {
      await connectProjectRepo(projectId, {
        github_repo_full_name: selectedRepo,
        github_default_branch: selectedBranch || 'main',
        connection_id: selectedConnectionId || undefined,
      })
      await reindexProjectRepo(projectId)
      onProjectUpdated?.()
      onConnected?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('project.settings.repo.linkError'))
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    setLoading(true)
    setError(null)
    try {
      await disconnectProjectRepo(projectId)
      setShowDisconnectDialog(false)
      onProjectUpdated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('project.settings.repo.disconnectError'))
    } finally {
      setLoading(false)
    }
  }

  async function handleReindex() {
    setLoading(true)
    setError(null)
    try {
      await reindexProjectRepo(projectId)
      onProjectUpdated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('project.settings.repo.reindexError'))
    } finally {
      setLoading(false)
    }
  }

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.trim().toLowerCase()),
  )

  if (linkedRepo) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-primary">
          {t('project.settings.repo.connectedTo', { repo: linkedRepo })}
          {project?.github_default_branch
            ? ` (${t('project.settings.repo.branchLabel', { branch: project.github_default_branch })})`
            : ''}
        </p>
        {connectionLogin ? (
          <p className="text-xs text-text-muted">
            {t('project.settings.repo.accountLabel', { login: connectionLogin })}
          </p>
        ) : null}
        {project?.repo_index_error ? (
          <p className="text-sm text-status-error">{project.repo_index_error}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => void handleReindex()}>
            {t('project.settings.repo.reindex')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => setShowDisconnectDialog(true)}
          >
            {t('project.settings.repo.disconnect')}
          </Button>
        </div>
        {error ? <p className="text-sm text-status-error">{error}</p> : null}
        <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('project.settings.repo.disconnectTitle')}</DialogTitle>
              <DialogDescription>
                {t('project.settings.repo.disconnectDescription', { repo: linkedRepo })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => setShowDisconnectDialog(false)}
              >
                {t('project.settings.repo.disconnectCancel')}
              </Button>
              <Button type="button" variant="destructive" disabled={loading} onClick={() => void handleDisconnect()}>
                {loading ? t('project.settings.repo.disconnecting') : t('project.settings.repo.disconnectConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  if (!showPicker) {
    return (
      <div className="space-y-3">
        <Button type="button" size="sm" onClick={() => void handleConnectOAuth()}>
          {t('project.settings.repo.connectGithub')}
        </Button>
        {connectionError ? (
          <div className="space-y-2">
            <p className="text-sm text-status-error">{connectionError}</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => void loadConnection()}>
              {t('common:actions.retry')}
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-sm text-status-error">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {connectionError ? (
        <div className="space-y-2">
          <p className="text-sm text-status-error">{connectionError}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => void loadConnection()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : null}
      {connections.length > 1 ? (
        <select
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          value={selectedConnectionId}
          onChange={(e) => {
            setSelectedConnectionId(e.target.value)
            const c = connections.find((x) => x.id === e.target.value)
            setConnectionLogin(c?.github_login ?? null)
          }}
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.github_login}
            </option>
          ))}
        </select>
      ) : connectionLogin ? (
        <p className="text-xs text-text-muted">
          {t('project.settings.repo.signedInAs', { login: connectionLogin })}
        </p>
      ) : null}
      <Input
        placeholder={t('project.settings.repo.searchPlaceholder')}
        value={repoSearch}
        onChange={(e) => setRepoSearch(e.target.value)}
      />
      {loading && repos.length === 0 ? (
        <p className="text-sm text-text-muted">{t('project.settings.repo.loadingRepos')}</p>
      ) : (
        <select
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
        >
          <option value="">{t('project.settings.repo.selectRepo')}</option>
          {filteredRepos.map((r) => (
            <option key={r.id} value={r.full_name}>
              {r.full_name}
            </option>
          ))}
        </select>
      )}
      {selectedRepo ? (
        <select
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
        >
          {(branches.length ? branches : ['main']).map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      ) : null}
      <Button type="button" size="sm" disabled={loading || !selectedRepo} onClick={() => void handleLinkRepo()}>
        {t('project.settings.repo.linkRepo')}
      </Button>
      {error ? <p className="text-sm text-status-error">{error}</p> : null}
    </div>
  )
}

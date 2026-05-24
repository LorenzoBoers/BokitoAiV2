import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
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
  const [showPicker, setShowPicker] = useState(oauthConnected)

  const linkedRepo = project?.github_repo_full_name ?? null

  const loadConnection = useCallback(async () => {
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
      setConnectionLogin(null)
      setConnections([])
    }
  }, [project?.github_connection_id])

  const loadRepos = useCallback(async () => {
    if (!selectedConnectionId && connections.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const rows = await listGithubRepos(selectedConnectionId || undefined)
      setRepos(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load repositories')
      setRepos([])
    } finally {
      setLoading(false)
    }
  }, [selectedConnectionId, connections.length])

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
      setError(e instanceof Error ? e.message : 'Could not start GitHub connection')
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
      setError(e instanceof Error ? e.message : 'Could not link repository')
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    setLoading(true)
    setError(null)
    try {
      await disconnectProjectRepo(projectId)
      onProjectUpdated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect')
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
      setError(e instanceof Error ? e.message : 'Could not re-read project')
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
          Connected to <span className="font-medium">{linkedRepo}</span>
          {project?.github_default_branch ? ` (${project.github_default_branch})` : ''}
        </p>
        {connectionLogin ? (
          <p className="text-xs text-text-muted">GitHub account: {connectionLogin}</p>
        ) : null}
        {project?.repo_index_error ? (
          <p className="text-sm text-status-error">{project.repo_index_error}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => void handleReindex()}>
            Re-read project
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void handleDisconnect()}>
            Disconnect
          </Button>
        </div>
      </div>
    )
  }

  if (!showPicker) {
    return (
      <div className="space-y-3">
        <Button type="button" size="sm" onClick={() => void handleConnectOAuth()}>
          Connect with GitHub
        </Button>
        {error ? <p className="text-sm text-status-error">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
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
        <p className="text-xs text-text-muted">Signed in as {connectionLogin}</p>
      ) : null}
      <Input
        placeholder="Search repositories..."
        value={repoSearch}
        onChange={(e) => setRepoSearch(e.target.value)}
      />
      {loading && repos.length === 0 ? (
        <p className="text-sm text-text-muted">Loading repositories...</p>
      ) : (
        <select
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
        >
          <option value="">Select a repository</option>
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
        Link repository
      </Button>
      {error ? <p className="text-sm text-status-error">{error}</p> : null}
    </div>
  )
}

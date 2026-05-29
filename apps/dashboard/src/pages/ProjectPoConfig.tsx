import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Bot } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Badge } from '../components/ui/badge'
import { LoadingBlock } from '../components/ui/loading-block'
import { AiAvatar } from '../components/ui/AiAvatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { ProjectShell } from '../components/project/ProjectShell'
import { ProjectOrchestrationForm } from '../components/project/ProjectOrchestrationForm'
import { useProjectContext } from '../context/ProjectContext'
import { useProjectHubNav } from '../context/ProjectHubNavContext'
import { listAgents } from '../lib/agents-api'
import {
  createProjectPoAgent,
  getProjectPoAgent,
  linkProjectPoAgent,
  type ProjectPoAgentSummary,
} from '../lib/po-agent-api'
import {
  getProjectOrchestration,
  patchProjectOrchestration,
  type ProjectOrchestrationConfig,
} from '../lib/project-orchestration-api'
import { listProjects } from '../lib/projects-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { normalizeRoleSlug } from '../lib/workforce-nav-agents'

function isLinkablePoAgent(agent: RuntimeAgent, linkedElsewhere: Set<string>): boolean {
  if (normalizeRoleSlug(agent) !== 'po') return false
  if (linkedElsewhere.has(agent.id)) return false
  return true
}

export default function ProjectPoConfig() {
  const { t } = useTranslation('nav')
  const { projectId, project } = useProjectContext()
  const { refreshWorkstreams, setSelectedProjectId } = useProjectHubNav()
  const [summary, setSummary] = useState<ProjectPoAgentSummary | null>(null)
  const [orchestration, setOrchestration] = useState<ProjectOrchestrationConfig | null>(null)
  const [candidateAgents, setCandidateAgents] = useState<RuntimeAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPo, setSavingPo] = useState(false)
  const [savingOrch, setSavingOrch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orchError, setOrchError] = useState<string | null>(null)
  const [orchLoadError, setOrchLoadError] = useState<string | null>(null)
  const [savedOrchAt, setSavedOrchAt] = useState<number | null>(null)
  const [newPoName, setNewPoName] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [showLinkExisting, setShowLinkExisting] = useState(false)

  useEffect(() => {
    if (projectId) setSelectedProjectId(projectId)
  }, [projectId, setSelectedProjectId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setOrchLoadError(null)
    try {
      const [poData, orchResult, agents, projects] = await Promise.all([
        getProjectPoAgent(projectId),
        getProjectOrchestration(projectId).then(
          (data) => ({ data, error: null as string | null }),
          (err) => ({
            data: null as ProjectOrchestrationConfig | null,
            error: err instanceof Error ? err.message : t('project.orchestration.loadError'),
          }),
        ),
        listAgents(),
        listProjects(),
      ])
      setSummary(poData)
      setOrchestration(orchResult.data)
      setOrchLoadError(orchResult.error)
      const linkedElsewhere = new Set(
        projects
          .filter((row) => row.id !== projectId && row.po_agent_id)
          .map((row) => row.po_agent_id as string),
      )
      setCandidateAgents(
        agents.filter((agent) => isLinkablePoAgent(agent, linkedElsewhere)),
      )
    } catch (err) {
      setSummary(null)
      setOrchestration(null)
      setError(err instanceof Error ? err.message : t('project.po.loadError', { defaultValue: 'Could not load orchestrator settings.' }))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    if (project?.name && !newPoName) {
      setNewPoName(`${project.name} Orchestrator`)
    }
  }, [project?.name, newPoName])

  useEffect(() => {
    void load()
  }, [load])

  const poAgent = summary?.po_agent ?? null
  const setupComplete = summary?.setup_complete === true

  const defaultPoName = useMemo(
    () => (project?.name ? `${project.name} Orchestrator` : t('project.po.defaultName', { defaultValue: 'Project orchestrator' })),
    [project?.name, t],
  )

  async function handleCreatePo() {
    setSavingPo(true)
    setError(null)
    try {
      const name = (newPoName || defaultPoName).trim()
      const next = await createProjectPoAgent(projectId, { name })
      setSummary(next)
      setShowLinkExisting(false)
      await refreshWorkstreams()
      if (!orchestration) {
        const orch = await getProjectOrchestration(projectId)
        setOrchestration(orch)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.po.createError', { defaultValue: 'Could not create orchestrator.' }))
    } finally {
      setSavingPo(false)
    }
  }

  async function handleLinkPo() {
    if (!selectedAgentId) return
    setSavingPo(true)
    setError(null)
    try {
      const next = await linkProjectPoAgent(projectId, selectedAgentId)
      setSummary(next)
      setShowLinkExisting(false)
      await refreshWorkstreams()
      if (!orchestration) {
        const orch = await getProjectOrchestration(projectId)
        setOrchestration(orch)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.po.linkError', { defaultValue: 'Could not link orchestrator.' }))
    } finally {
      setSavingPo(false)
    }
  }

  async function handleOrchestrationSave(
    patch: Parameters<typeof patchProjectOrchestration>[1],
  ) {
    setSavingOrch(true)
    setOrchError(null)
    try {
      const next = await patchProjectOrchestration(projectId, patch)
      setOrchestration(next)
      setSavedOrchAt(Date.now())
    } catch (err) {
      setOrchError(
        err instanceof Error ? err.message : t('project.orchestration.saveError'),
      )
      const refreshed = await getProjectOrchestration(projectId).catch(() => null)
      if (refreshed) setOrchestration(refreshed)
    } finally {
      setSavingOrch(false)
    }
  }

  return (
    <ProjectShell hideContextBar hideTabNav hideWorkerStatus>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-text-heading">
            {t('project.po.title', { defaultValue: 'Orchestrator' })}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t('project.po.description', {
              defaultValue:
                'Configure the dedicated orchestrator for this project. Plans work, routes agents, and keeps project knowledge current.',
            })}
          </p>
        </div>

        {loading ? (
          <LoadingBlock label={t('project.po.loading', { defaultValue: 'Loading orchestrator settings…' })} />
        ) : (
          <>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t('project.po.identity.title', { defaultValue: 'Orchestrator identity' })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {poAgent ? (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <AiAvatar name={poAgent.name} seed={poAgent.id} size={40} />
                      <div>
                        <p className="text-sm font-semibold text-text-heading">
                          {poAgent.name ?? defaultPoName}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {t('workforce.agents.types.po', { defaultValue: 'Orchestrator' })}
                          </Badge>
                          {poAgent.status ? (
                            <span className="text-xs capitalize text-text-muted">{poAgent.status}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" asChild>
                      <Link to={`/ai/agents/${poAgent.id}`}>
                        <Bot size={14} className="mr-1.5" />
                        {t('project.po.advancedProfile', { defaultValue: 'Advanced agent profile' })}
                        <ArrowUpRight size={14} className="ml-1" />
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">
                    {t('project.po.identity.empty', {
                      defaultValue: 'No orchestrator is linked to this project yet.',
                    })}
                  </p>
                )}
              </CardContent>
            </Card>

            {!setupComplete ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t('project.po.setup.title', { defaultValue: 'Link or create orchestrator' })}
                  </CardTitle>
                  <p className="text-sm text-text-muted">
                    {t('project.po.setup.description', {
                      defaultValue:
                        'Each project needs one dedicated orchestrator. Create a new one or link an existing unassigned orchestrator.',
                    })}
                  </p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="po-name">
                      {t('project.po.setup.createLabel', { defaultValue: 'New orchestrator name' })}
                    </Label>
                    <Input
                      id="po-name"
                      value={newPoName || defaultPoName}
                      onChange={(e) => setNewPoName(e.target.value)}
                      disabled={savingPo}
                    />
                    <Button onClick={() => void handleCreatePo()} disabled={savingPo}>
                      {savingPo
                        ? t('project.po.setup.creating', { defaultValue: 'Creating…' })
                        : t('project.po.setup.createCta', { defaultValue: 'Create orchestrator for project' })}
                    </Button>
                  </div>

                  <div className="border-t border-border/60 pt-5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowLinkExisting((value) => !value)}
                    >
                      {showLinkExisting
                        ? t('project.po.setup.hideExisting', { defaultValue: 'Hide existing orchestrators' })
                        : t('project.po.setup.showExisting', { defaultValue: 'Link existing orchestrator' })}
                    </Button>
                    {showLinkExisting ? (
                      <div className="mt-3 space-y-3">
                        {candidateAgents.length === 0 ? (
                          <p className="text-sm text-text-muted">
                            {t('project.po.setup.noCandidates', {
                              defaultValue: 'No unassigned orchestrators available in this workspace.',
                            })}
                          </p>
                        ) : (
                          <>
                            <Select
                              value={selectedAgentId}
                              onValueChange={setSelectedAgentId}
                              disabled={savingPo}
                            >
                              <SelectTrigger className="w-full sm:max-w-md">
                                <SelectValue
                                  placeholder={t('project.po.setup.selectPlaceholder', {
                                    defaultValue: 'Select orchestrator',
                                  })}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {candidateAgents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id}>
                                    {agent.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="secondary"
                              onClick={() => void handleLinkPo()}
                              disabled={savingPo || !selectedAgentId}
                            >
                              {t('project.po.setup.linkCta', { defaultValue: 'Link selected orchestrator' })}
                            </Button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t('project.po.switch.title', { defaultValue: 'Change orchestrator' })}
                  </CardTitle>
                  <p className="text-sm text-text-muted">
                    {t('project.po.switch.description', {
                      defaultValue: 'Switch to another unassigned orchestrator or create a new dedicated agent.',
                    })}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setShowLinkExisting(true)}>
                      {t('project.po.switch.linkOther', { defaultValue: 'Link different orchestrator' })}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleCreatePo()} disabled={savingPo}>
                      {t('project.po.switch.createNew', { defaultValue: 'Create new orchestrator' })}
                    </Button>
                  </div>
                  {showLinkExisting ? (
                    <div className="space-y-3 border-t border-border/60 pt-3">
                      <Select value={selectedAgentId} onValueChange={setSelectedAgentId} disabled={savingPo}>
                        <SelectTrigger className="w-full sm:max-w-md">
                          <SelectValue
                            placeholder={t('project.po.setup.selectPlaceholder', {
                              defaultValue: 'Select orchestrator',
                            })}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {candidateAgents
                            .filter((agent) => agent.id !== poAgent?.id)
                            .map((agent) => (
                              <SelectItem key={agent.id} value={agent.id}>
                                {agent.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleLinkPo()}
                        disabled={savingPo || !selectedAgentId}
                      >
                        {t('project.po.setup.linkCta', { defaultValue: 'Link selected orchestrator' })}
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}

            {setupComplete && orchestration ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('project.orchestration.title')}</CardTitle>
                  <p className="text-sm text-text-muted">{t('project.orchestration.description')}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {orchError ? <p className="text-sm text-destructive">{orchError}</p> : null}
                  {savedOrchAt ? (
                    <p className="text-xs text-text-muted">{t('project.orchestration.saved')}</p>
                  ) : null}
                  <ProjectOrchestrationForm
                    config={orchestration}
                    saving={savingOrch}
                    onSave={handleOrchestrationSave}
                  />
                </CardContent>
              </Card>
            ) : setupComplete && orchLoadError ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('project.orchestration.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-destructive">{orchLoadError}</p>
                  <Button size="sm" variant="secondary" onClick={() => void load()}>
                    {t('common.retry', { defaultValue: 'Retry' })}
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {setupComplete ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/project/${projectId}/communication`}>
                    {t('project.links.communication')}
                  </Link>
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/project/${projectId}/overview`}>
                    {t('project.links.overview')}
                  </Link>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </ProjectShell>
  )
}

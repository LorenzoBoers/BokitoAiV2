import { Play, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  useAgentMutations,
  useAgents,
  usePlaybookMutations,
  usePlaybooks,
  useRun,
  useRuns,
  useTriggerMutations,
  useTriggers,
} from '@/api/queries'
import type { Agent, Playbook, PlaybookStep, Posture, Trigger } from '@/api/types'
import { Badge, Dialog, Empty, Field, KeyValue, Loading, Page, PageHeader, Section, Switch, TabPanel, Tabs, statusTone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateTime, eur, relativeTime } from '@/lib/format'

const TABS = ['agents', 'playbooks', 'triggers', 'runs'] as const
type Tab = (typeof TABS)[number]
const POSTURES: Array<Posture | ''> = ['', 'manual', 'assisted', 'autonomous']

export function WorkPage() {
  const { t } = useTranslation()
  const { tab = 'agents', id } = useParams()
  const navigate = useNavigate()
  const current: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'agents'
  return (
    <Page>
      <PageHeader title={t('nav.work')} intro={t('surface.workIntro')} />
      <Tabs
        value={current}
        onValueChange={(v) => navigate(v === 'agents' ? '/work' : `/work/${v}`)}
        items={TABS.map((v) => ({ value: v, label: t(`work.tabs.${v}`) }))}
      >
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <TabPanel value="agents">
            <AgentsTab selectedId={current === 'agents' ? id : undefined} />
          </TabPanel>
          <TabPanel value="playbooks">
            <PlaybooksTab selectedId={current === 'playbooks' ? id : undefined} />
          </TabPanel>
          <TabPanel value="triggers">
            <TriggersTab />
          </TabPanel>
          <TabPanel value="runs">
            <RunsTab selectedId={current === 'runs' ? id : undefined} />
          </TabPanel>
        </div>
      </Tabs>
    </Page>
  )
}

function useToastRun() {
  const { t } = useTranslation()
  return async <T,>(p: Promise<T>, ok?: string) => {
    try {
      const out = await p
      if (ok) toast.success(ok)
      return out
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'))
      return undefined
    }
  }
}

// Agents ----------------------------------------------------------------------

function AgentsTab({ selectedId }: { selectedId?: string }) {
  const { t } = useTranslation()
  const agents = useAgents()
  const m = useAgentMutations()
  const navigate = useNavigate()
  const run = useToastRun()
  const [open, setOpen] = useState(false)
  const selected = agents.data?.find((a) => a.id === selectedId) ?? agents.data?.[0]

  if (!agents.data) return <Loading />
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Section
        title={t('work.tabs.agents')}
        actions={
          <button type="button" className="btn-primary h-8" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('work.newAgent')}
          </button>
        }
      >
        <ul className="space-y-1">
          {agents.data.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => navigate(`/work/agents/${a.id}`)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-hover',
                  selected?.id === a.id && 'bg-bg-hover',
                  !a.active && 'opacity-60',
                )}
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-ai/15 text-xs font-semibold text-ai-ink">{a.name[0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.name}</span>
                  <span className="block truncate text-2xs text-text-muted">{a.role || a.slug}</span>
                </span>
                {a.is_default && <Badge tone="accent">{t('work.default')}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {selected ? <AgentEditor key={selected.id} agent={selected} onSave={(patch) => run(m.update.mutateAsync({ id: selected.id, patch }), t('common.saved'))} /> : <Empty />}
      <AgentDialog open={open} onOpenChange={setOpen} onCreate={async (body) => (await run(m.create.mutateAsync(body))) !== undefined} />
    </div>
  )
}

function AgentEditor({ agent, onSave }: { agent: Agent; onSave: (patch: Partial<Agent>) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    name: agent.name,
    role: agent.role,
    instructions: agent.instructions,
    model: agent.model,
    autonomy_cap: agent.autonomy_cap ?? '',
    language: agent.language,
    active: agent.active,
  })
  const dirty = JSON.stringify(form) !== JSON.stringify({
    name: agent.name,
    role: agent.role,
    instructions: agent.instructions,
    model: agent.model,
    autonomy_cap: agent.autonomy_cap ?? '',
    language: agent.language,
    active: agent.active,
  })
  return (
    <Section
      title={agent.name}
      description={t('work.agentPassport')}
      actions={
        <button
          type="button"
          className="btn-primary h-8"
          disabled={!dirty}
          onClick={() => void onSave({ ...form, autonomy_cap: (form.autonomy_cap || null) as Posture | null })}
        >
          {t('common.save')}
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.name')}>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('work.role')}>
          <input className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        </Field>
        <Field label={t('work.model')} hint={t('work.modelHint')}>
          <input className="field font-mono" placeholder="mistral:mistral-large-latest" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        </Field>
        <Field label={t('work.autonomyCap')} hint={t('work.autonomyCapHint')}>
          <select className="field" value={form.autonomy_cap} onChange={(e) => setForm({ ...form, autonomy_cap: e.target.value as Posture | '' })}>
            {POSTURES.map((p) => (
              <option key={p} value={p}>
                {p ? t(`posture.${p}`) : t('work.followWorkspace')}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('work.instructions')} className="sm:col-span-2">
          <textarea className="field min-h-[160px]" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </Field>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Switch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label={t('common.active')} />
          {t('common.active')}
        </div>
      </div>
      <div className="mt-4">
        <KeyValue
          rows={[
            ['slug', <code key="s">{agent.slug}</code>],
            [t('work.tools'), agent.tools.length ? agent.tools.join(', ') : t('work.allTools')],
            [t('common.updated'), dateTime(agent.updated_at)],
          ]}
        />
      </div>
    </Section>
  )
}

function AgentDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: (b: { name: string; role: string; instructions: string }) => Promise<boolean> }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ name: '', role: '', instructions: '' })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('work.newAgent')} description={t('work.newAgentHint')}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (await onCreate(form)) {
            onOpenChange(false)
            setForm({ name: '', role: '', instructions: '' })
          }
        }}
        className="space-y-3"
      >
        <Field label={t('common.name')}>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        </Field>
        <Field label={t('work.role')}>
          <input className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        </Field>
        <Field label={t('work.instructions')}>
          <textarea className="field min-h-[100px]" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </Field>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary">
            {t('common.create')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// Playbooks -------------------------------------------------------------------

function PlaybooksTab({ selectedId }: { selectedId?: string }) {
  const { t } = useTranslation()
  const playbooks = usePlaybooks()
  const agents = useAgents()
  const m = usePlaybookMutations()
  const run = useToastRun()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const selected = playbooks.data?.find((p) => p.id === selectedId) ?? playbooks.data?.[0]
  if (!playbooks.data) return <Loading />

  async function start(p: Playbook) {
    const out = await run(m.run.mutateAsync(p.id))
    if (!out) return
    if (out.status === 'decision') toast.message(t('work.runNeedsDecision'))
    else if (out.status === 'denied') toast.error(out.reason || t('communication.denied'))
    else {
      const runId = (out.result as { run_id?: string } | null)?.run_id
      if (runId) navigate(`/work/runs/${runId}`)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Section
        title={t('work.tabs.playbooks')}
        actions={
          <button type="button" className="btn-primary h-8" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('work.newPlaybook')}
          </button>
        }
      >
        {playbooks.data.length === 0 && <p className="text-xs text-text-muted">{t('work.noPlaybooks')}</p>}
        <ul className="space-y-1">
          {playbooks.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => navigate(`/work/playbooks/${p.id}`)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-hover', selected?.id === p.id && 'bg-bg-hover')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="block truncate text-2xs text-text-muted">{t('work.steps', { n: p.steps.length })}</span>
                </span>
                {p.module && <Badge>{p.module}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {selected ? (
        <PlaybookEditor
          key={selected.id}
          playbook={selected}
          agents={agents.data ?? []}
          onSave={(patch) => run(m.update.mutateAsync({ id: selected.id, ...patch }), t('common.saved'))}
          onRun={() => void start(selected)}
        />
      ) : (
        <Empty title={t('work.noPlaybooks')} hint={t('work.noPlaybooksHint')} />
      )}
      <PlaybookDialog
        open={open}
        onOpenChange={setOpen}
        onCreate={async (body) => (await run(m.create.mutateAsync(body))) !== undefined}
      />
    </div>
  )
}

function StepsEditor({ steps, onChange }: { steps: PlaybookStep[]; onChange: (s: PlaybookStep[]) => void }) {
  const { t } = useTranslation()
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 w-5 text-right text-xs text-text-muted">{i + 1}.</span>
          <div className="flex-1 space-y-1">
            <input
              className="field"
              placeholder={t('work.stepTitle')}
              value={s.title}
              onChange={(e) => onChange(steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
            />
            <textarea
              className="field min-h-[56px]"
              placeholder={t('work.stepInstruction')}
              value={s.instruction ?? ''}
              onChange={(e) => onChange(steps.map((x, j) => (j === i ? { ...x, instruction: e.target.value } : x)))}
            />
          </div>
          <button type="button" className="btn-ghost h-8 self-start px-2 text-2xs" onClick={() => onChange(steps.filter((_, j) => j !== i))}>
            {t('common.remove')}
          </button>
        </li>
      ))}
      <li>
        <button type="button" className="btn-outline h-8" onClick={() => onChange([...steps, { title: '', instruction: '' }])}>
          <Plus className="h-3.5 w-3.5" />
          {t('work.addStep')}
        </button>
      </li>
    </ol>
  )
}

function PlaybookEditor({ playbook, agents, onSave, onRun }: { playbook: Playbook; agents: Agent[]; onSave: (patch: Partial<Playbook>) => Promise<unknown>; onRun: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ name: playbook.name, description: playbook.description, steps: playbook.steps, agent_id: playbook.agent_id ?? '', active: playbook.active })
  const dirty = JSON.stringify(form) !== JSON.stringify({ name: playbook.name, description: playbook.description, steps: playbook.steps, agent_id: playbook.agent_id ?? '', active: playbook.active })
  return (
    <Section
      title={playbook.name}
      description={t('work.playbookHint')}
      actions={
        <>
          <button type="button" className="btn-outline h-8" onClick={onRun}>
            <Play className="h-3.5 w-3.5" />
            {t('work.runNow')}
          </button>
          <button type="button" className="btn-primary h-8" disabled={!dirty} onClick={() => void onSave({ ...form, agent_id: form.agent_id || null })}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.name')}>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('work.agent')}>
          <select className="field" value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
            <option value="">{t('work.defaultAgent')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('common.description')} className="sm:col-span-2">
          <input className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
      <h3 className="mb-2 mt-4 text-xs font-semibold text-text-heading">{t('work.tabs.steps')}</h3>
      <StepsEditor steps={form.steps} onChange={(steps) => setForm({ ...form, steps })} />
    </Section>
  )
}

function PlaybookDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: (b: { name: string; description: string; steps: PlaybookStep[] }) => Promise<boolean> }) {
  const { t } = useTranslation()
  const [form, setForm] = useState<{ name: string; description: string; steps: PlaybookStep[] }>({ name: '', description: '', steps: [{ title: '', instruction: '' }] })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('work.newPlaybook')} description={t('work.newPlaybookHint')} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (await onCreate({ ...form, steps: form.steps.filter((s) => s.title.trim() || s.instruction?.trim()) })) {
            onOpenChange(false)
            setForm({ name: '', description: '', steps: [{ title: '', instruction: '' }] })
          }
        }}
        className="space-y-3"
      >
        <Field label={t('common.name')}>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        </Field>
        <Field label={t('common.description')}>
          <input className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <StepsEditor steps={form.steps} onChange={(steps) => setForm({ ...form, steps })} />
        <div className="flex justify-end">
          <button type="submit" className="btn-primary">
            {t('common.create')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// Triggers --------------------------------------------------------------------

function TriggersTab() {
  const { t, i18n } = useTranslation()
  const triggers = useTriggers()
  const playbooks = usePlaybooks()
  const m = useTriggerMutations()
  const run = useToastRun()
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [form, setForm] = useState<{ name: string; kind: Trigger['kind']; expr: string; minutes: string; instructions: string; playbook_id: string }>({
    name: '',
    kind: 'cron',
    expr: '0 9 * * 1-5',
    minutes: '60',
    instructions: '',
    playbook_id: '',
  })
  if (!triggers.data) return <Loading />

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const spec = form.kind === 'cron' ? { expr: form.expr } : form.kind === 'interval' ? { minutes: Number(form.minutes) } : {}
    const out = await run(m.create.mutateAsync({ name: form.name, kind: form.kind, spec, instructions: form.instructions, playbook_id: form.playbook_id || null }))
    if (!out) return
    const s = (out.result as { webhook_secret?: string } | null)?.webhook_secret
    if (s) setSecret(s)
    else setOpen(false)
  }

  return (
    <Section
      title={t('work.tabs.triggers')}
      description={t('work.triggersHint')}
      actions={
        <button type="button" className="btn-primary h-8" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t('work.newTrigger')}
        </button>
      }
    >
      {triggers.data.length === 0 && <p className="text-xs text-text-muted">{t('common.empty')}</p>}
      <ul className="divide-y divide-border/40">
        {triggers.data.map((tr) => (
          <li key={tr.id} className="flex items-center gap-3 py-2 text-xs">
            <Switch checked={tr.active} onChange={(v) => void run(m.update.mutateAsync({ id: tr.id, active: v }))} label={t('common.active')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary">{tr.name}</span>
                <Badge>{t(`work.triggerKind.${tr.kind}`)}</Badge>
                <span className="font-mono text-2xs text-text-muted">{JSON.stringify(tr.spec)}</span>
              </div>
              <div className="text-2xs text-text-muted">
                {tr.next_fire_at ? t('work.nextFire', { when: relativeTime(tr.next_fire_at, i18n.language) }) : ''}
                {tr.last_fired_at ? ` · ${t('work.lastFire', { when: relativeTime(tr.last_fired_at, i18n.language) })}` : ''}
              </div>
            </div>
            <button type="button" className="btn-ghost h-7 text-2xs" onClick={() => void run(m.remove.mutateAsync(tr.id))}>
              {t('common.remove')}
            </button>
          </li>
        ))}
      </ul>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setSecret(null)
        }}
        title={t('work.newTrigger')}
        description={t('work.newTriggerHint')}
      >
        {secret ? (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">{t('work.webhookSecretHint')}</p>
            <code className="block break-all rounded-lg bg-bg-elevated p-3 font-mono text-xs">{secret}</code>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-3">
            <Field label={t('common.name')}>
              <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </Field>
            <Field label={t('work.kind')}>
              <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Trigger['kind'] })}>
                {(['cron', 'interval', 'webhook'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`work.triggerKind.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
            {form.kind === 'cron' && (
              <Field label={t('work.cronExpr')} hint={t('work.cronHint')}>
                <input className="field font-mono" value={form.expr} onChange={(e) => setForm({ ...form, expr: e.target.value })} />
              </Field>
            )}
            {form.kind === 'interval' && (
              <Field label={t('work.intervalMinutes')}>
                <input className="field" type="number" min={1} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
              </Field>
            )}
            <Field label={t('work.playbook')} hint={t('work.playbookOrInstructions')}>
              <select className="field" value={form.playbook_id} onChange={(e) => setForm({ ...form, playbook_id: e.target.value })}>
                <option value="">{t('work.noPlaybook')}</option>
                {(playbooks.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('work.instructions')}>
              <textarea className="field min-h-[80px]" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary">
                {t('common.create')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </Section>
  )
}

// Runs ------------------------------------------------------------------------

function RunsTab({ selectedId }: { selectedId?: string }) {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState('')
  const runs = useRuns({ status: status || undefined, limit: 100 })
  const navigate = useNavigate()
  if (!runs.data) return <Loading />
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <Section
        title={t('work.ledger')}
        description={t('work.ledgerHint')}
        actions={
          <select className="field h-8 w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('communication.anyStatus')}</option>
            {['queued', 'running', 'waiting', 'done', 'failed', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {t(`runStatus.${s}`)}
              </option>
            ))}
          </select>
        }
      >
        {runs.data.length === 0 && <p className="text-xs text-text-muted">{t('work.noRuns')}</p>}
        <table className="w-full text-xs">
          <tbody>
            {runs.data.map((r) => (
              <tr
                key={r.id}
                onClick={() => navigate(`/work/runs/${r.id}`)}
                className={cn('cursor-pointer border-t border-border/40 hover:bg-bg-hover', selectedId === r.id && 'bg-bg-hover')}
              >
                <td className="py-1.5 pr-3">
                  <div className="font-medium text-text-primary">{r.title || r.tool_name || r.kind}</div>
                  <div className="text-2xs text-text-muted">
                    {r.kind} · {r.actor}
                  </div>
                </td>
                <td className="py-1.5 pr-3">
                  <Badge tone={statusTone(r.status)}>{t(`runStatus.${r.status}`)}</Badge>
                </td>
                <td className="py-1.5 pr-3 text-right">{r.cost_eur ? eur(r.cost_eur, i18n.language, 4) : ''}</td>
                <td className="py-1.5 text-right text-text-muted">{relativeTime(r.created_at, i18n.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      {selectedId ? <RunDetail id={selectedId} /> : <Empty title={t('work.pickRun')} />}
    </div>
  )
}

function RunDetail({ id }: { id: string }) {
  const { t, i18n } = useTranslation()
  const run = useRun(id)
  if (!run.data) return <Loading />
  const r = run.data
  return (
    <Section title={r.title || r.tool_name || r.kind} description={`${r.kind} · ${t(`runStatus.${r.status}`)}`}>
      <KeyValue
        rows={[
          [t('work.actor'), <code key="a">{r.actor}</code>],
          [t('work.trust'), r.trust],
          [t('work.cost'), eur(r.cost_eur, i18n.language, 4)],
          [t('govern.tokens'), `${r.tokens_in} / ${r.tokens_out}`],
          [t('common.created'), dateTime(r.created_at, i18n.language)],
          [t('work.finished'), dateTime(r.finished_at, i18n.language) || '—'],
          ...(r.conversation_id
            ? [[t('nav.communication'), <Link key="c" to={`/communication/${r.conversation_id}`} className="text-accent-ink hover:underline">{t('overview.openThread')}</Link>] as [string, React.ReactNode]]
            : []),
        ]}
      />
      {r.error && <p className="mt-3 rounded-lg bg-status-error/10 p-2 text-xs text-status-error">{r.error}</p>}
      <h3 className="mb-1 mt-4 text-xs font-semibold text-text-heading">{t('work.events')}</h3>
      <ol className="space-y-1">
        {r.events.map((e) => (
          <li key={e.id} className="rounded-lg bg-bg-elevated p-2 text-2xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-text-muted">#{e.seq}</span>
              <span className="font-medium">{e.kind}</span>
              <span className="ml-auto text-text-muted">{dateTime(e.created_at, i18n.language)}</span>
            </div>
            {Object.keys(e.payload).length > 0 && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(e.payload, null, 1)}</pre>}
          </li>
        ))}
      </ol>
      {r.output && (
        <>
          <h3 className="mb-1 mt-4 text-xs font-semibold text-text-heading">{t('work.output')}</h3>
          <pre className="max-h-48 overflow-auto rounded-lg bg-bg-elevated p-2 text-2xs">{JSON.stringify(r.output, null, 2)}</pre>
        </>
      )}
    </Section>
  )
}

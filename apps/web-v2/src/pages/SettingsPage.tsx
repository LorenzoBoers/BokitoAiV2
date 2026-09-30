import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { appRoutes, authRoutes } from '@/api/routes'
import { useInvites, useMembers, useWorkspace, useWorkspaceMutations } from '@/api/queries'
import { Badge, Field, Loading, Page, PageHeader, Section, TabPanel, Tabs } from '@/components/ui'
import { api } from '@/lib/api'
import { API_BASE, WS_URL } from '@/lib/api.config'
import { useMe, type Me } from '@/lib/auth'
import { dateTime } from '@/lib/format'
import { setLanguage } from '@/i18n'

const TABS = ['profile', 'workspace', 'members', 'developers'] as const
type Tab = (typeof TABS)[number]

export function SettingsPage() {
  const { t } = useTranslation()
  const { tab = 'profile' } = useParams()
  const navigate = useNavigate()
  const current: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'profile'
  return (
    <Page>
      <PageHeader title={t('nav.settings')} intro={t('surface.settingsIntro')} />
      <Tabs
        value={current}
        onValueChange={(v) => navigate(v === 'profile' ? '/settings' : `/settings/${v}`)}
        items={TABS.map((v) => ({ value: v, label: t(`settings.tabs.${v}`) }))}
      >
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <TabPanel value="profile">
            <ProfileTab />
          </TabPanel>
          <TabPanel value="workspace">
            <WorkspaceTab />
          </TabPanel>
          <TabPanel value="members">
            <MembersTab />
          </TabPanel>
          <TabPanel value="developers">
            <DevelopersTab />
          </TabPanel>
        </div>
      </Tabs>
    </Page>
  )
}

function ProfileTab() {
  const me = useMe()
  if (!me.data) return <Loading />
  return <ProfileForm me={me.data} onSaved={() => void me.refetch()} />
}

function ProfileForm({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(me.name)
  const [language, setLang] = useState(me.language)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.patch(authRoutes.me, { name, language })
      await setLanguage(language)
      onSaved()
      toast.success(t('common.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('settings.tabs.profile')} className="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('auth.email')}>
          <input className="field" value={me.email} disabled />
        </Field>
        <Field label={t('auth.name')}>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('auth.language')}>
          <select className="field" value={language} onChange={(e) => setLang(e.target.value)}>
            <option value="en">English</option>
            <option value="nl">Nederlands</option>
          </select>
        </Field>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Section>
  )
}

function WorkspaceTab() {
  const { t } = useTranslation()
  const ws = useWorkspace()
  const m = useWorkspaceMutations()
  const [name, setName] = useState<string | null>(null)
  const [language, setLang] = useState<string | null>(null)
  if (!ws.data) return <Loading />
  const w = ws.data
  return (
    <Section title={t('settings.tabs.workspace')} className="max-w-lg">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await m.update.mutateAsync({ name: name ?? w.name, language: language ?? w.language })
            setName(null)
            setLang(null)
            toast.success(t('common.saved'))
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t('common.error'))
          }
        }}
        className="space-y-3"
      >
        <Field label={t('auth.workspaceName')}>
          <input className="field" value={name ?? w.name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('settings.workspaceLanguage')} hint={t('settings.workspaceLanguageHint')}>
          <select className="field" value={language ?? w.language} onChange={(e) => setLang(e.target.value)}>
            <option value="en">English</option>
            <option value="nl">Nederlands</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3 text-xs text-text-secondary">
          <div>
            <div className="text-2xs uppercase text-text-muted">{t('settings.slug')}</div>
            <code>{w.slug}</code>
          </div>
          <div>
            <div className="text-2xs uppercase text-text-muted">{t('govern.region')}</div>
            <span className="uppercase">{w.region}</span>
          </div>
          <div>
            <div className="text-2xs uppercase text-text-muted">{t('overview.posture')}</div>
            <Link to="/govern" className="text-accent-ink hover:underline">
              {t(`posture.${w.posture}`)}
            </Link>
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={m.update.isPending || (name === null && language === null)}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Section>
  )
}

function MembersTab() {
  const { t, i18n } = useTranslation()
  const me = useMe()
  const members = useMembers()
  const invites = useInvites()
  const m = useWorkspaceMutations()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  const admin = me.data?.role === 'owner' || me.data?.role === 'admin' || me.data?.is_staff

  async function run<T>(p: Promise<T>) {
    try {
      return await p
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'))
      return undefined
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('settings.tabs.members')}>
        {!members.data ? (
          <Loading />
        ) : (
          <ul className="divide-y divide-border/40">
            {members.data.map((mem) => (
              <li key={mem.user_id} className="flex items-center gap-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text-primary">{mem.name || mem.email}</div>
                  <div className="text-2xs text-text-muted">{mem.email}</div>
                </div>
                {admin && mem.user_id !== me.data?.user_id ? (
                  <select
                    className="field h-7 w-auto text-xs"
                    value={mem.role}
                    onChange={(e) => void run(m.setRole.mutateAsync({ userId: mem.user_id, role: e.target.value }))}
                  >
                    {['member', 'admin', 'owner'].map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge>{t(`roles.${mem.role}`)}</Badge>
                )}
                {admin && mem.user_id !== me.data?.user_id && mem.role !== 'owner' && (
                  <button type="button" className="btn-ghost h-7 text-2xs" onClick={() => void run(m.removeMember.mutateAsync(mem.user_id))}>
                    {t('common.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {admin && (
        <Section title={t('settings.invite')} description={t('settings.inviteHint')}>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const inv = await run(m.invite.mutateAsync({ email, role }))
              if (inv) {
                setLastUrl(inv.accept_url)
                setEmail('')
              }
            }}
            className="flex gap-2"
          >
            <input className="field" type="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
            <select className="field w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
              {['member', 'admin'].map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-primary shrink-0 whitespace-nowrap" disabled={m.invite.isPending}>
              {t('settings.sendInvite')}
            </button>
          </form>
          {lastUrl && (
            <div className="mt-3 space-y-1">
              <p className="text-2xs text-text-muted">{t('settings.inviteLinkHint')}</p>
              <code className="block break-all rounded-lg bg-bg-elevated p-2 text-2xs">{lastUrl}</code>
            </div>
          )}
          <ul className="mt-4 divide-y divide-border/40">
            {(invites.data ?? []).map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2 text-xs">
                <span className="flex-1">{inv.email}</span>
                <Badge>{t(`roles.${inv.role}`)}</Badge>
                <span className="text-2xs text-text-muted">{t('settings.expires', { when: dateTime(inv.expires_at, i18n.language) })}</span>
                <button type="button" className="btn-ghost h-7 text-2xs" onClick={() => void run(m.withdrawInvite.mutateAsync(inv.id))}>
                  {t('settings.withdraw')}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

function DevelopersTab() {
  const { t } = useTranslation()
  const origin = window.location.origin
  const base = `${origin}${API_BASE}`
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('settings.apiTokens')} description={t('settings.apiTokensHint')}>
        <Link to="/govern/tokens" className="btn-outline h-8">
          {t('settings.manageTokens')}
        </Link>
      </Section>
      <Section title={t('settings.endpoints')} description={t('settings.endpointsHint')}>
        <ul className="space-y-1 text-xs">
          <li>
            <span className="text-text-muted">REST</span> <code className="select-all">{base}</code>
          </li>
          <li>
            <span className="text-text-muted">OpenAPI</span>{' '}
            <a className="text-accent-ink hover:underline" href={`${base}${appRoutes.openapiDocs}`} target="_blank" rel="noreferrer">
              {base}
              {appRoutes.openapiDocs}
            </a>
          </li>
          <li>
            <span className="text-text-muted">MCP</span> <code className="select-all">{`${base}${appRoutes.mcp}`}</code>
          </li>
          <li>
            <span className="text-text-muted">WebSocket</span> <code className="select-all">{WS_URL}</code>
          </li>
        </ul>
      </Section>
    </div>
  )
}

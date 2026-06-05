import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Gauge, Inbox, MessageSquare, RefreshCw, ShieldCheck, Sparkles, Timer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { bokitoGetCockpitSummary, type CockpitSummary } from '../lib/bokito-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { cn } from '../lib/utils'

function formatCost(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

const QUICK_LINKS = [
  { label: 'AI OS canvas', to: '/os' },
  { label: 'Decisions', to: '/os/communication' },
  { label: 'Govern', to: '/govern' },
  { label: 'Integrations', to: '/integrations/connected' },
] as const

export default function Cockpit() {
  const { token } = useAuth()
  const [summary, setSummary] = useState<CockpitSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    bokitoGetCockpitSummary(token)
      .then(setSummary)
      .catch((err) => setError(formatApiErrorMessage(err, 'Could not load cockpit metrics.')))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <PageContent width="xl" className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-text-heading">Cockpit</h1>
          <p className="text-sm text-text-muted mt-1">AI OS performance at a glance</p>
        </header>
        <LoadingBlock label="Loading cockpit metrics..." />
      </PageContent>
    )
  }

  if (error || !summary) {
    return (
      <PageContent width="xl" className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-text-heading">Cockpit</h1>
        </header>
        {error ? (
          <ApiErrorBanner message={error} onRetry={load} />
        ) : (
          <p className="text-sm text-text-muted">No data available</p>
        )}
      </PageContent>
    )
  }

  const emptyHint = (active: boolean, hint: string) => (active ? null : hint)

  const cards = [
    {
      title: 'Conversations (7d)',
      value: formatNumber(summary.volume_week),
      icon: MessageSquare,
      to: '/support/inbox/my',
      hint: emptyHint(summary.volume_week > 0, 'Connect a mailbox to start tracking conversations.'),
    },
    {
      title: 'Open decisions',
      value: formatNumber(summary.open_decisions),
      icon: Inbox,
      to: '/os/communication',
      hint: emptyHint(
        summary.open_decisions > 0,
        'Decisions appear when agents need human approval. Review them in Decisions.',
      ),
    },
    {
      title: 'Autonomy rate',
      value: `${formatNumber(summary.autonomy_rate_pct)}%`,
      icon: Gauge,
      to: '/govern',
      hint: emptyHint(summary.autonomy_rate_pct > 0, 'Runs and approvals build autonomy metrics over time.'),
    },
    {
      title: 'Avg feedback',
      value: summary.avg_feedback_score > 0 ? formatNumber(summary.avg_feedback_score) : '-',
      icon: Sparkles,
      to: '/support/inbox/my',
      hint: emptyHint(summary.avg_feedback_score > 0, 'Feedback scores appear after inbox interactions.'),
    },
    {
      title: 'Time saved (7d)',
      value: `${formatNumber(summary.time_saved_minutes_week)} min`,
      icon: Timer,
      to: '/orchestra',
      hint: emptyHint(summary.time_saved_minutes_week > 0, 'Estimated time saved grows as agents complete work.'),
    },
    {
      title: 'Usage (30d)',
      value: `${formatNumber(summary.tokens_month)} tokens`,
      sub: formatCost(summary.cost_cents_month),
      icon: Activity,
      to: '/settings/billing',
      hint: emptyHint(summary.tokens_month > 0, 'Token usage is tracked per tenant billing period.'),
    },
  ]

  return (
    <PageContent width="xl" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">Cockpit</h1>
          <p className="text-sm text-text-muted mt-1">AI OS performance at a glance</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden />
          Refresh
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="inline-flex items-center rounded-lg border border-border/60 bg-bg-surface/50 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent/30 hover:text-text-heading"
          >
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.title}
            to={card.to}
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Card className="h-full transition-colors hover:border-accent/30">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-text-secondary">{card.title}</CardTitle>
                <card.icon className="h-4 w-4 text-text-muted" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-text-heading">{card.value}</div>
                {card.sub ? <p className="text-xs text-text-muted mt-1">{card.sub}</p> : null}
                {card.hint ? <p className="text-xs text-text-muted mt-2">{card.hint}</p> : null}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-text-muted" aria-hidden />
            Intelligence Stack health
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wide">Learning sample</p>
            <p className="font-medium text-text-heading mt-0.5">
              {formatNumber((summary as CockpitSummary & { learning_sample_size?: number }).learning_sample_size ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wide">Learning autonomy</p>
            <p className="font-medium text-text-heading mt-0.5">
              {formatNumber((summary as CockpitSummary & { learning_autonomy_rate?: number }).learning_autonomy_rate ?? 0)}%
            </p>
          </div>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wide">Govern</p>
            <Link to="/govern" className={cn('font-medium mt-0.5 inline-block text-accent hover:underline')}>
              Review drafts and apply modes
            </Link>
          </div>
        </CardContent>
      </Card>
    </PageContent>
  )
}

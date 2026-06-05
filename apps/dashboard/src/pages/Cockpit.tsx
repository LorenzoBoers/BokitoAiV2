import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Gauge, Inbox, MessageSquare, Sparkles, Timer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { bokitoGetCockpitSummary, type CockpitSummary } from '../lib/bokito-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

function formatCost(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

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
      to: '/support/inbox/my?hub=decisions',
      hint: emptyHint(summary.open_decisions > 0, 'Agent decisions appear here when the assistant needs approval.'),
    },
    {
      title: 'Autonomy rate',
      value: `${formatNumber(summary.autonomy_rate_pct)}%`,
      icon: Gauge,
      to: '/os',
      hint: emptyHint(summary.autonomy_rate_pct > 0, 'Runs and approvals build autonomy metrics over time.'),
    },
    {
      title: 'Avg feedback',
      value: summary.avg_feedback_score > 0 ? formatNumber(summary.avg_feedback_score) : '-',
      icon: Sparkles,
      to: '/settings/inbox',
      hint: emptyHint(summary.avg_feedback_score > 0, 'Feedback scores appear after inbox interactions.'),
    },
    {
      title: 'Time saved (7d)',
      value: `${formatNumber(summary.time_saved_minutes_week)} min`,
      icon: Timer,
      to: '/os',
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
      <header>
        <h1 className="text-2xl font-semibold text-text-heading">Cockpit</h1>
        <p className="text-sm text-text-muted mt-1">AI OS performance at a glance</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.title} to={card.to} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
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
    </PageContent>
  )
}

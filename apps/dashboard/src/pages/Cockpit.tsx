import { useEffect, useState } from 'react'
import { Activity, Gauge, Inbox, MessageSquare, Sparkles, Timer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { bokitoGetCockpitSummary, type CockpitSummary } from '../lib/bokito-api'

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

  useEffect(() => {
    if (!token) return
    setLoading(true)
    bokitoGetCockpitSummary(token)
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load cockpit'))
      .finally(() => setLoading(false))
  }, [token])

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
        <p className="text-sm text-destructive">{error ?? 'No data available'}</p>
      </PageContent>
    )
  }

  const cards = [
    {
      title: 'Conversations (7d)',
      value: formatNumber(summary.volume_week),
      icon: MessageSquare,
    },
    {
      title: 'Open decisions',
      value: formatNumber(summary.open_decisions),
      icon: Inbox,
    },
    {
      title: 'Autonomy rate',
      value: `${formatNumber(summary.autonomy_rate_pct)}%`,
      icon: Gauge,
    },
    {
      title: 'Avg feedback',
      value: summary.avg_feedback_score > 0 ? formatNumber(summary.avg_feedback_score) : '-',
      icon: Sparkles,
    },
    {
      title: 'Time saved (7d)',
      value: `${formatNumber(summary.time_saved_minutes_week)} min`,
      icon: Timer,
    },
    {
      title: 'Usage (30d)',
      value: `${formatNumber(summary.tokens_month)} tokens`,
      sub: formatCost(summary.cost_cents_month),
      icon: Activity,
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
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-text-secondary">{card.title}</CardTitle>
              <card.icon className="h-4 w-4 text-text-muted" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-text-heading">{card.value}</div>
              {card.sub ? <p className="text-xs text-text-muted mt-1">{card.sub}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContent>
  )
}

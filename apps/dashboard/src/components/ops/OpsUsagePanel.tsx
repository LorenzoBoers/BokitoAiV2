import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { DirectoryRowsSkeleton, StatTilesSkeleton } from '../ui/skeleton'
import { StatGrid, StatTile } from '../ui/stat-tile'
import { Badge } from '../ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  getStaffOpsUsage,
  getStaffOpsUsageTenant,
  getStaffPriceBooks,
  putStaffTenantPriceBook,
  type StaffOpsUsageDetail,
  type StaffOpsUsageOverview,
  type StaffPriceBook,
} from '../../lib/ops-api'

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function num(n: number): string {
  return n.toLocaleString()
}

const PERIODS = ['7d', '30d', '90d', 'mtd'] as const

type Props = { token: string }

export function OpsUsagePanel({ token }: Props) {
  const { t } = useTranslation('nav')
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('30d')
  const [overview, setOverview] = useState<StaffOpsUsageOverview | null>(null)
  const [detail, setDetail] = useState<StaffOpsUsageDetail | null>(null)
  const [books, setBooks] = useState<StaffPriceBook[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [bindingId, setBindingId] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const [usage, booksPayload] = await Promise.all([
        getStaffOpsUsage(token, period),
        getStaffPriceBooks(token),
      ])
      setOverview(usage)
      setBooks(booksPayload.books)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('ops.usage.loadError'))
      setOverview(null)
    } finally {
      setLoading(false)
    }
  }, [token, period, t])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const openDetail = useCallback(
    async (tenantId: string) => {
      setDetailLoading(true)
      try {
        const payload = await getStaffOpsUsageTenant(token, tenantId, period)
        setDetail(payload)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('ops.usage.loadError'))
      } finally {
        setDetailLoading(false)
      }
    },
    [token, period, t],
  )

  const onBindBook = useCallback(
    async (tenantId: string, bookId: string) => {
      if (!bookId || bindingId) return
      setBindingId(tenantId)
      try {
        const result = await putStaffTenantPriceBook(token, tenantId, bookId)
        toast.success(t('ops.usage.bindSaved'))
        setOverview((prev) =>
          prev
            ? {
                ...prev,
                tenants: prev.tenants.map((row) =>
                  row.tenant_id === tenantId
                    ? {
                        ...row,
                        price_book_slug: result.price_book_slug,
                        price_book_name: result.price_book_name,
                      }
                    : row,
                ),
              }
            : prev,
        )
        if (detail?.tenant_id === tenantId && result.price_book_slug) {
          setDetail({
            ...detail,
            price_book: {
              id: result.price_book_id,
              slug: result.price_book_slug,
              name: result.price_book_name || result.price_book_slug,
            },
          })
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('ops.usage.bindError'))
      } finally {
        setBindingId(null)
      }
    },
    [token, bindingId, detail, t],
  )

  if (detail) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-text-heading">
              {t('ops.usage.detailTitle', { name: detail.name })}
            </h2>
            <p className="font-mono text-xs text-text-muted">{detail.slug}</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setDetail(null)}>
            {t('ops.usage.back')}
          </Button>
        </div>
        {detailLoading ? <StatTilesSkeleton /> : null}
        <StatGrid className="lg:grid-cols-4">
          <StatTile label={t('ops.usage.totals.tokens')} value={num(detail.totals.tokens)} />
          <StatTile label={t('ops.usage.totals.provider')} value={usd(detail.totals.provider_cost_micros)} />
          <StatTile label={t('ops.usage.totals.customer')} value={usd(detail.totals.customer_cost_micros)} />
          <StatTile label={t('ops.usage.totals.margin')} value={usd(detail.totals.margin_micros)} />
        </StatGrid>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">{t('ops.usage.bindBook')}</span>
          <Select
            value={detail.price_book.id}
            onValueChange={(id) => void onBindBook(detail.tenant_id, id)}
            disabled={!!bindingId}
          >
            <SelectTrigger className="h-8 w-[220px] text-xs" aria-label={t('ops.usage.bindBook')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {books.map((book) => (
                <SelectItem key={book.id} value={book.id}>
                  {book.name}
                  {book.is_default ? ` (${t('ops.usage.defaultBook')})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <UsageTable
          title={t('ops.usage.col.model')}
          columns={[
            t('ops.usage.col.model'),
            t('ops.usage.col.backing'),
            t('ops.usage.col.tokens'),
            t('ops.usage.col.provider'),
            t('ops.usage.col.customer'),
            t('ops.usage.col.margin'),
          ]}
          rows={detail.by_model.map((row) => [
            row.model,
            row.backing_provider
              ? `${row.backing_provider}/${row.backing_model || '—'}`
              : row.provider,
            num(row.tokens),
            usd(row.provider_cost_micros),
            usd(row.customer_cost_micros),
            usd(row.margin_micros),
          ])}
        />
        <UsageTable
          title={t('ops.usage.col.callType')}
          columns={[
            t('ops.usage.col.callType'),
            t('ops.usage.col.tokens'),
            t('ops.usage.col.provider'),
            t('ops.usage.col.customer'),
            t('ops.usage.col.calls'),
          ]}
          rows={detail.by_call_type.map((row) => [
            row.call_type,
            num(row.tokens),
            usd(row.provider_cost_micros),
            usd(row.customer_cost_micros),
            num(row.calls),
          ])}
        />
        <UsageTable
          title={t('ops.usage.col.kind')}
          columns={[t('ops.usage.col.kind'), t('ops.usage.col.tokens')]}
          rows={detail.by_token_kind.map((row) => [row.kind, num(row.tokens)])}
        />
        <UsageTable
          title={t('ops.usage.col.day')}
          columns={[
            t('ops.usage.col.day'),
            t('ops.usage.col.tokens'),
            t('ops.usage.col.provider'),
            t('ops.usage.col.customer'),
          ]}
          rows={detail.by_day.map((row) => [
            row.day,
            num(row.tokens),
            usd(row.provider_cost_micros),
            usd(row.customer_cost_micros),
          ])}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-heading">{t('ops.usage.title')}</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-text-muted">{t('ops.usage.hint')}</p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as (typeof PERIODS)[number])}>
          <SelectTrigger className="h-8 w-[160px] text-xs" aria-label={t('ops.usage.period')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={p}>
                {t(`ops.usage.periods.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && !overview ? (
        <div className="space-y-4">
          <StatTilesSkeleton />
          <DirectoryRowsSkeleton rows={4} />
        </div>
      ) : null}

      {overview ? (
        <>
          <StatGrid className="lg:grid-cols-4">
            <StatTile label={t('ops.usage.totals.tokens')} value={num(overview.totals.tokens)} />
            <StatTile label={t('ops.usage.totals.provider')} value={usd(overview.totals.provider_cost_micros)} />
            <StatTile label={t('ops.usage.totals.customer')} value={usd(overview.totals.customer_cost_micros)} />
            <StatTile label={t('ops.usage.totals.margin')} value={usd(overview.totals.margin_micros)} />
          </StatGrid>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-bg-elevated text-xs text-text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('ops.usage.col.workspace')}</th>
                  <th className="px-3 py-2 font-medium">{t('ops.usage.col.tokens')}</th>
                  <th className="px-3 py-2 font-medium">{t('ops.usage.col.provider')}</th>
                  <th className="px-3 py-2 font-medium">{t('ops.usage.col.customer')}</th>
                  <th className="px-3 py-2 font-medium">{t('ops.usage.col.margin')}</th>
                  <th className="px-3 py-2 font-medium">{t('ops.usage.col.book')}</th>
                  <th className="px-3 py-2 font-medium">{t('ops.usage.col.cap')}</th>
                </tr>
              </thead>
              <tbody>
                {overview.tenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                      {t('ops.usage.empty' /* design-system-ignore: table cell empty row, not a page EmptyState */)}
                    </td>
                  </tr>
                ) : (
                  overview.tenants.map((row) => (
                    <tr
                      key={row.tenant_id}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-bg-hover"
                      onClick={() => void openDetail(row.tenant_id)}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-text-heading">{row.name}</div>
                        <div className="font-mono text-xs text-text-muted">{row.slug}</div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{num(row.tokens)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{usd(row.provider_cost_micros)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{usd(row.customer_cost_micros)}</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {usd(row.margin_micros)}
                        {row.margin_pct != null ? (
                          <span className="ml-1 text-xs text-text-muted">({row.margin_pct}%)</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-text-muted">
                        {row.price_book_name || row.price_book_slug || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.spend.blocked ? (
                          <Badge variant="error">{t('ops.usage.blocked')}</Badge>
                        ) : (
                          <Badge variant="neutral">{t('ops.usage.ok')}</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-text-heading">{t('ops.usage.booksTitle')}</h3>
              <p className="mt-0.5 text-xs text-text-muted">{t('ops.usage.booksHint')}</p>
            </div>
            <div className="space-y-2">
              {books.map((book) => (
                <div key={book.id} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text-heading">{book.name}</span>
                    <span className="font-mono text-xs text-text-muted">{book.slug}</span>
                    {book.is_default ? <Badge variant="accent">{t('ops.usage.defaultBook')}</Badge> : null}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
                    {book.rules.slice(0, 8).map((rule) => (
                      <li key={rule.id}>
                        {t('ops.usage.rule', {
                          mode: rule.pricing_mode,
                          kind: rule.match_kind,
                          value: rule.match_value || '*',
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function UsageTable({
  title,
  columns,
  rows,
}: {
  title: string
  columns: string[]
  rows: string[][]
}) {
  const { t } = useTranslation('nav')
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-text-heading">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-bg-elevated text-xs text-text-muted">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-4 text-center text-text-muted">
                  {t('ops.usage.empty' /* design-system-ignore: table cell empty row, not a page EmptyState */)}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={idx} className="border-b border-border last:border-0">
                  {row.map((cell, cidx) => (
                    <td key={cidx} className="px-3 py-2 tabular-nums text-text-heading">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

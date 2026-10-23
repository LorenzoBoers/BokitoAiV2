import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork } from 'lucide-react'
import { DepartmentOrganogram } from '../components/workforce/DepartmentOrganogram'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { EmptyState } from '../components/ui/empty-state'
import { Skeleton } from '../components/ui/skeleton'
import { useAuth } from '../context/AuthContext'
import { buildDepartmentForest } from '../lib/department-tree'
import { getTeamOverview, type TeamOverview } from '../lib/teams-api'

function OrganogramSkeleton() {
  return (
    <div className="flex flex-col items-center gap-6 py-16" aria-hidden>
      <Skeleton className="h-24 w-56 rounded-xl" />
      <Skeleton className="h-6 w-px" />
      <div className="flex gap-4">
        <Skeleton className="h-24 w-56 rounded-xl" />
        <Skeleton className="h-24 w-56 rounded-xl" />
        <Skeleton className="h-24 w-56 rounded-xl" />
      </div>
    </div>
  )
}

/** Department hierarchy: root at the top, branches downward. */
export default function OrganogramPage() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!token) return
    let alive = true
    setLoading(true)
    setError('')
    getTeamOverview(token)
      .then((data) => {
        if (alive) setOverview(data)
      })
      .catch((err) => {
        if (alive) setError(formatApiErrorMessage(err, t('organogram.loadError')))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [token, t, reloadKey])

  const forest = useMemo(
    () => buildDepartmentForest(overview?.teams ?? []),
    [overview],
  )
  const loneRoot = forest.length === 1 && forest[0].children.length === 0

  return (
    <div className="relative h-full min-h-0 overflow-auto bg-bg" data-testid="organogram-page">
      {error ? (
        <ApiErrorBanner
          className="m-6"
          message={error}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : null}
      {loading && !overview ? <OrganogramSkeleton /> : null}
      {overview && forest.length === 0 ? (
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            icon={GitFork}
            title={t('organogram.emptyTitle')}
            description={t('organogram.emptyDescription')}
          />
        </div>
      ) : null}
      {overview && forest.length > 0 ? (
        <div className="mx-auto flex w-max min-w-full flex-col items-center px-10 py-10">
          <DepartmentOrganogram nodes={forest} overview={overview} />
          {loneRoot ? (
            <p className="mt-8 max-w-sm text-center text-sm text-text-muted">
              {t('organogram.emptyDescription')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

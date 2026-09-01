import { useCallback, useEffect, useState } from 'react'
import type { IntegrationKind } from '../lib/integration-kind'
import { resolveIntegrationKind } from '../lib/integration-kind'
import {
  connectionCountForProvider,
  fetchConnectedSummary,
  listIntegrationProviders,
  type ConnectedSummaryConnection,
  type ProvidersListResponse,
} from '../lib/integrations-api'
import { listGithubConnections, type GithubConnectionRow } from '../lib/github-api'
import { listMcpIntegrationRows, type McpIntegrationRow } from '../lib/mcp-integrations'
import {
  listCalendarConnections,
  type CalendarConnection,
} from '../lib/calendars-api'
import { withTimeout } from '../lib/promise-timeout'

export type { ConnectedSummaryConnection }

export type ConnectedIntegrationsSummary = {
  loading: boolean
  loadError: string | null
  github: GithubConnectionRow[]
  emailOutlook: number
  emailGmail: number
  mcpRows: McpIntegrationRow[]
  calendarRows: CalendarConnection[]
  connections: ConnectedSummaryConnection[]
  appConnections: ConnectedSummaryConnection[]
  counts: {
    all: number
    inbox: number
    repository: number
    calendar: number
    mcp: number
    app: number
  }
}

const EMPTY_COUNTS = { all: 0, inbox: 0, repository: 0, calendar: 0, mcp: 0, app: 0 }
const FETCH_TIMEOUT_MS = 15_000
const MCP_ROWS_TIMEOUT_MS = 20_000

export function useConnectedIntegrationsSummary(): ConnectedIntegrationsSummary & {
  refresh: () => Promise<void>
} {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [github, setGithub] = useState<GithubConnectionRow[]>([])
  const [emailOutlook, setEmailOutlook] = useState(0)
  const [emailGmail, setEmailGmail] = useState(0)
  const [mcpRows, setMcpRows] = useState<McpIntegrationRow[]>([])
  const [calendarRows, setCalendarRows] = useState<CalendarConnection[]>([])
  const [connections, setConnections] = useState<ConnectedSummaryConnection[]>([])
  const [appConnections, setAppConnections] = useState<ConnectedSummaryConnection[]>([])
  const [counts, setCounts] = useState(EMPTY_COUNTS)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    let gh: GithubConnectionRow[] = []
    let outlook = 0
    let gmail = 0
    let mcp: McpIntegrationRow[] = []
    let calendars: CalendarConnection[] = []
    let summaryConnections: ConnectedSummaryConnection[] = []
    let apps: ConnectedSummaryConnection[] = []

    try {
      const [ghResult, summaryResult, calendarResult] = await Promise.all([
        withTimeout(listGithubConnections(), FETCH_TIMEOUT_MS, [] as GithubConnectionRow[]),
        withTimeout(fetchConnectedSummary(), FETCH_TIMEOUT_MS, null),
        withTimeout(listCalendarConnections(), FETCH_TIMEOUT_MS, [] as CalendarConnection[]),
      ])

      gh = ghResult
      setGithub(gh)
      calendars = calendarResult
      setCalendarRows(calendars)

      if (summaryResult) {
        outlook = Number(summaryResult.email_outlook ?? 0)
        gmail = Number(summaryResult.email_gmail ?? 0)
        summaryConnections = summaryResult.connections ?? []
        apps = summaryConnections.filter((row) => row.kind === 'app')
        setEmailOutlook(outlook)
        setEmailGmail(gmail)
        setConnections(summaryConnections)
        setAppConnections(apps)
      } else {
        const providersList = await withTimeout(
          listIntegrationProviders(),
          FETCH_TIMEOUT_MS,
          null,
        )
        outlook = providersList?.connection_counts?.email_outlook ?? 0
        gmail = providersList?.connection_counts?.email_gmail ?? 0
        setEmailOutlook(outlook)
        setEmailGmail(gmail)
        setConnections([])
        setAppConnections([])
      }

      mcp = await withTimeout(
        listMcpIntegrationRows(),
        MCP_ROWS_TIMEOUT_MS,
        [] as McpIntegrationRow[],
      )
      setMcpRows(mcp)
      setLoadError(null)
    } catch {
      setGithub([])
      setEmailOutlook(0)
      setEmailGmail(0)
      setMcpRows([])
      setCalendarRows([])
      setConnections([])
      setAppConnections([])
      setLoadError('integrations.connected.loadError')
      gh = []
      outlook = 0
      gmail = 0
      mcp = []
      calendars = []
      apps = []
    } finally {
      setCounts({
        all: gh.length + outlook + gmail + mcp.length + calendars.length + apps.length,
        inbox: outlook + gmail,
        repository: gh.length,
        calendar: calendars.length,
        mcp: mcp.length,
        app: apps.length,
      })
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    loading,
    loadError,
    github,
    emailOutlook,
    emailGmail,
    mcpRows,
    calendarRows,
    connections,
    appConnections,
    counts,
    refresh,
  }
}

/** @deprecated used for marketplace kind counts from providers list */
export function countConnectedProvidersByKind(
  providers: ProvidersListResponse['providers'],
  connection_counts: ProvidersListResponse['connection_counts'],
  githubLen: number,
): Record<IntegrationKind, number> {
  const out: Record<IntegrationKind, number> = {
    inbox: 0,
    repository: 0,
    mcp: 0,
    calendar: 0,
    app: 0,
  }
  if (githubLen > 0) out.repository += githubLen
  if (connection_counts.email_outlook > 0) out.inbox += connection_counts.email_outlook
  if (connection_counts.email_gmail > 0) out.inbox += connection_counts.email_gmail
  for (const p of providers) {
    const n = connectionCountForProvider(p, connection_counts)
    if (n <= 0 || p.slug === 'github' || p.slug === 'outlook' || p.slug === 'gmail') continue
    const kind = resolveIntegrationKind(p.slug, p.capabilities)
    out[kind] += n
  }
  return out
}

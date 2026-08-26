import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Loader2, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { IntegrationHostLogo } from '../integrations/IntegrationHostLogo'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  revokeMcpConnection,
  testMcpConnection,
  type McpIntegrationRow,
} from '../../lib/mcp-integrations'

type Props = {
  rows: McpIntegrationRow[]
  loading?: boolean
  onChange: () => void
}

export function McpIntegrationsTable({ rows, loading, onChange }: Props) {
  const { t } = useTranslation('nav')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; toolCount: number; error?: string }>>({})

  const statusVariant = (status: McpIntegrationRow['status']) => {
    if (status === 'active') return 'success'
    if (status === 'error') return 'error'
    return 'neutral'
  }

  const runTest = async (row: McpIntegrationRow) => {
    if (!row.mcpServerId) {
      toast.error(t('integrations.mcp.servers.noServerId'))
      return
    }
    const serverId = String(row.mcpServerId)
    setTestingId(row.id)
    try {
      const result = await testMcpConnection(serverId)
      setTestResults((prev) => ({
        ...prev,
        [row.id]: {
          ok: result.ok,
          toolCount: result.tool_count,
          error: result.error,
        },
      }))
      if (result.ok) {
        toast.success(t('integrations.mcp.servers.testSuccess', { count: result.tool_count }))
      } else {
        toast.error(result.error ?? t('integrations.mcp.servers.testFailed'))
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('integrations.mcp.servers.testFailed')))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border/60 px-5 py-4">
        <h3 className="text-sm font-medium text-text-heading">{t('integrations.mcp.servers.listTitle')}</h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('integrations.mcp.servers.colProvider')}</TableHead>
            <TableHead>{t('integrations.mcp.servers.colName')}</TableHead>
            <TableHead>{t('integrations.mcp.servers.colEndpoint')}</TableHead>
            <TableHead>{t('integrations.mcp.servers.colAuth')}</TableHead>
            <TableHead>{t('integrations.mcp.servers.colStatus')}</TableHead>
            <TableHead className="text-right">{t('integrations.mcp.servers.colActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="text-sm text-text-muted py-8 text-center">
                ...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center">
                <p className="text-sm text-text-muted">{t('integrations.mcp.servers.empty')}</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-text-muted">
                  {t('integrations.mcp.servers.emptyHint')}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
                  <Link to="/settings/marketplace" className="font-medium text-accent hover:underline">
                    {t('integrations.mcp.servers.openMarketplace')}
                  </Link>
                  <Link to="/agents" className="font-medium text-accent hover:underline">
                    {t('integrations.mcp.servers.openAgents')}
                  </Link>
                  <Link to="/settings/govern" className="font-medium text-accent hover:underline">
                    {t('integrations.mcp.servers.openGovern')}
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <IntegrationHostLogo
                      logoUrl={row.logoUrl}
                      logoDarkUrl={row.logoDarkUrl}
                      initials={row.initials}
                      color={row.brandColor}
                      name={row.providerName}
                      hostSlug={row.hostSlug}
                      size="sm"
                    />
                    <span className="text-sm text-text-primary">{row.providerName}</span>
                  </div>
                </TableCell>
                <TableCell className="font-medium text-text-primary">{row.displayName}</TableCell>
                <TableCell className="max-w-[220px] truncate font-mono text-xs text-text-secondary">
                  {row.endpoint}
                </TableCell>
                <TableCell>
                  <Badge variant="neutral">
                    {row.authLabel === 'bearer'
                      ? t('integrations.mcp.servers.authBearer')
                      : t('integrations.mcp.servers.authApiKey')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                    {testResults[row.id] ? (
                      <span className={`text-[10px] ${testResults[row.id].ok ? 'text-status-success' : 'text-status-error'}`}>
                        {testResults[row.id].ok
                          ? t('integrations.mcp.servers.testCount', { count: testResults[row.id].toolCount })
                          : testResults[row.id].error ?? t('integrations.mcp.servers.testFailed')}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={testingId === row.id}
                      onClick={() => void runTest(row)}
                      aria-label={t('integrations.mcp.servers.testConnection')}
                    >
                      {testingId === row.id ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-text-muted hover:text-status-error"
                      onClick={() => {
                        void revokeMcpConnection(row.id).then(onChange)
                      }}
                      aria-label={t('integrations.actions.disconnect')}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

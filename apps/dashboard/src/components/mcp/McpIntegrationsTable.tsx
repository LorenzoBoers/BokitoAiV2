import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { IntegrationHostLogo } from '../integrations/IntegrationHostLogo'
import { revokeMcpConnection, type McpIntegrationRow } from '../../lib/mcp-integrations'

type Props = {
  rows: McpIntegrationRow[]
  loading?: boolean
  onChange: () => void
}

export function McpIntegrationsTable({ rows, loading, onChange }: Props) {
  const { t } = useTranslation('nav')

  const statusVariant = (status: McpIntegrationRow['status']) => {
    if (status === 'active') return 'success'
    if (status === 'error') return 'error'
    return 'neutral'
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border/55 px-5 py-4">
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
              <TableCell colSpan={6} className="text-sm text-text-muted py-8 text-center">
                {t('integrations.mcp.servers.empty')}
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
                  <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
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
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

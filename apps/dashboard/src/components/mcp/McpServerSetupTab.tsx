import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { listMcpIntegrationRows, type McpIntegrationRow } from '../../lib/mcp-integrations'
import { McpConnectionDialog, type McpConnectPreset } from './McpConnectionDialog'
import { McpIntegrationsTable } from './McpIntegrationsTable'

const CONNECT_PARAM = 'connect'

function parseConnectPreset(value: string | null): McpConnectPreset | undefined {
  if (value === 'custom_mcp' || value === 'bjorn_lunden_mcp' || value === 'king_accountancy') {
    return value
  }
  return undefined
}

export function McpServerSetupTab() {
  const { t } = useTranslation('nav')
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState<McpIntegrationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogPreset, setDialogPreset] = useState<McpConnectPreset | undefined>(undefined)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listMcpIntegrationRows())
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const preset = parseConnectPreset(searchParams.get(CONNECT_PARAM))
    if (preset) {
      setDialogPreset(preset)
      setDialogOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete(CONNECT_PARAM)
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const openDialog = (preset?: McpConnectPreset) => {
    setDialogPreset(preset ?? 'custom_mcp')
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-medium text-text-heading">{t('integrations.mcp.servers.title')}</h2>
          <p className="text-sm text-text-secondary mt-1">{t('integrations.mcp.servers.description')}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Link to="/modules/marketplace" className="font-medium text-accent hover:underline">
              {t('integrations.mcp.servers.openMarketplace')}
            </Link>
            <Link to="/agents" className="font-medium text-accent hover:underline">
              {t('integrations.mcp.servers.openAgents')}
            </Link>
            <Link to="/settings/govern" className="font-medium text-accent hover:underline">
              {t('integrations.mcp.servers.openGovern')}
            </Link>
          </div>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={() => openDialog('custom_mcp')}>
          <Plus size={14} />
          {t('integrations.mcp.servers.newConnection')}
        </Button>
      </div>

      <McpIntegrationsTable rows={rows} loading={loading} onChange={() => void refresh()} />

      <McpConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => void refresh()}
        presetProvider={dialogPreset}
      />
    </div>
  )
}

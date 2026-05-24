import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { Switch } from '../ui/switch'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import {
  generateClaudeDesktopConfig,
  generateCursorMCPConfig,
  generateGenericMCPConfig,
  generateMCPServerUrls,
  getMCPConnectionConfig,
} from '../../lib/mcp-api'
import { SCHEMA_MCP_TOOLS, DATA_MCP_TOOLS } from '../../types/mcp'
import type { MCPTool } from '../../types/mcp'
import { McpCopyButton } from './McpCopyButton'
import { McpClientSetupCard } from './McpClientSetupCard'

function ToolRow({ tool }: { tool: MCPTool }) {
  const { t } = useTranslation('nav')
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <TableCell className="font-mono text-xs">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {tool.name}
          </div>
        </TableCell>
        <TableCell>
          <Badge variant={tool.category === 'schema' ? 'info' : 'accent'}>
            {tool.category === 'schema'
              ? t('integrations.mcp.bokito.categorySchema')
              : t('integrations.mcp.bokito.categoryData')}
          </Badge>
        </TableCell>
        <TableCell className="max-w-md">
          <p className="text-sm text-text-secondary truncate">{tool.description}</p>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={3} className="bg-bg-elevated">
            <pre className="text-xs bg-bg-surface p-3 rounded border border-border overflow-x-auto">
              {JSON.stringify(tool.inputSchema, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

export function BokitoMcpConnectTab() {
  const { t } = useTranslation('nav')
  const [enabled, setEnabled] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)

  const config = getMCPConnectionConfig()
  const urls = generateMCPServerUrls(config.workspaceId)
  const maskedToken =
    config.apiKey.length > 8
      ? `${config.apiKey.slice(0, 4)}${'•'.repeat(12)}${config.apiKey.slice(-4)}`
      : '••••••••'

  const cursorSteps = [
    'integrations.mcp.bokito.steps.cursor1',
    'integrations.mcp.bokito.steps.cursor2',
    'integrations.mcp.bokito.steps.cursor3',
  ] as [string, string, string]

  const claudeSteps = [
    'integrations.mcp.bokito.steps.claude1',
    'integrations.mcp.bokito.steps.claude2',
    'integrations.mcp.bokito.steps.claude3',
  ] as [string, string, string]

  const genericSteps = [
    'integrations.mcp.bokito.steps.generic1',
    'integrations.mcp.bokito.steps.generic2',
    'integrations.mcp.bokito.steps.generic3',
  ] as [string, string, string]

  return (
    <div className="space-y-6">
      <div className="border border-border rounded-lg p-6 bg-bg-elevated/30">
        <h2 className="text-lg font-medium text-text-heading">{t('integrations.mcp.bokito.title')}</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-2xl">
          {t('integrations.mcp.bokito.description')}
        </p>
        <div className="flex items-center justify-between gap-4 mt-6 pt-4 border-t border-border/50">
          <div>
            <Label htmlFor="bokito-mcp-enable" className="text-sm font-medium">
              {t('integrations.mcp.bokito.enable')}
            </Label>
            <p className="text-xs text-text-muted mt-1">
              {enabled
                ? t('integrations.mcp.bokito.enabledHint')
                : t('integrations.mcp.bokito.disabledHint')}
            </p>
          </div>
          <Switch id="bokito-mcp-enable" checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      {enabled ? (
        <>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-elevated/50 p-4 text-sm text-text-secondary">
            <Info size={18} className="shrink-0 mt-0.5 text-text-muted" />
            <p>{t('integrations.mcp.bokito.previewBanner')}</p>
          </div>

          <div className="border border-border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-text-heading">{t('integrations.mcp.bokito.connectionTitle')}</h3>
            <dl className="grid gap-3 text-sm max-w-2xl">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <dt className="text-text-secondary">{t('integrations.mcp.bokito.workspaceId')}</dt>
                <dd className="font-mono text-xs flex items-center gap-2">
                  {config.workspaceId}
                  <McpCopyButton text={config.workspaceId} />
                </dd>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <dt className="text-text-secondary">{t('integrations.mcp.bokito.schemaUrl')}</dt>
                <dd className="font-mono text-xs flex items-center gap-2 break-all">
                  {urls.schema}
                  <McpCopyButton text={urls.schema} />
                </dd>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <dt className="text-text-secondary">{t('integrations.mcp.bokito.dataUrl')}</dt>
                <dd className="font-mono text-xs flex items-center gap-2 break-all">
                  {urls.data}
                  <McpCopyButton text={urls.data} />
                </dd>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <dt className="text-text-secondary">{t('integrations.mcp.bokito.accessToken')}</dt>
                <dd className="font-mono text-xs flex items-center gap-2">
                  {maskedToken}
                  <McpCopyButton text={config.apiKey} />
                </dd>
              </div>
            </dl>
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-text-heading">{t('integrations.mcp.bokito.clientSetupTitle')}</h3>
            <McpClientSetupCard
              clientId="cursor"
              configSnippet={generateCursorMCPConfig()}
              stepKeys={cursorSteps}
            />
            <McpClientSetupCard
              clientId="claude"
              configSnippet={generateClaudeDesktopConfig()}
              stepKeys={claudeSteps}
            />
            <McpClientSetupCard
              clientId="generic"
              configSnippet={generateGenericMCPConfig()}
              stepKeys={genericSteps}
            />
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-bg-elevated/50"
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <div>
                <h3 className="font-medium text-text-heading">{t('integrations.mcp.bokito.toolsTitle')}</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  {t('integrations.mcp.bokito.toolsDescription')}
                </p>
              </div>
              {toolsOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
            {toolsOpen ? (
              <div className="border-t border-border px-2 pb-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('integrations.mcp.bokito.toolColumn')}</TableHead>
                      <TableHead>{t('integrations.mcp.bokito.categoryColumn')}</TableHead>
                      <TableHead>{t('integrations.mcp.bokito.descriptionColumn')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...SCHEMA_MCP_TOOLS, ...DATA_MCP_TOOLS].map((tool) => (
                      <ToolRow key={tool.name} tool={tool} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

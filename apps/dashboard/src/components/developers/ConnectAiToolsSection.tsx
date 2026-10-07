import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Download, Plug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { McpCopyButton } from '../mcp/McpCopyButton'
import { AiToolProviderRow } from './AiToolProviderRow'
import {
  AI_TOOL_PROVIDERS,
  matchingGrantName,
  type AiToolAuthMode,
  type AiToolProvider,
  type AiToolSnippet,
} from '../../lib/ai-tool-providers'
import { mcpEndpointUrl } from '../../lib/api-token-mcp'
import type { McpOAuthGrant } from '../../lib/mcp-oauth-api'
import { SegmentedControl } from '../ui/segmented-control'

const DOCS_PATH = '/docs/developers/mcp-endpoint'

function origin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

function downloadSnippet(snippet: AiToolSnippet, message: string) {
  if (!snippet.fileName) return
  const blob = new Blob([snippet.code], { type: 'text/plain' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = snippet.fileName
  a.click()
  URL.revokeObjectURL(href)
  toast.success(message)
}

function ProviderBody({ provider, token }: { provider: AiToolProvider; token: string | null }) {
  const { t } = useTranslation('nav')
  const [mode, setMode] = useState<AiToolAuthMode>(provider.authModes[0])
  const base = `developersPage.aiTools.providers.${provider.id}`
  const stepCount = provider.steps[mode] ?? 0
  const snippets = provider.snippets(mode, origin(), token)

  return (
    <>
      <p className="text-sm leading-relaxed text-text-secondary">{t(`${base}.body`)}</p>
      {provider.authModes.length > 1 ? (
        <SegmentedControl
          size="sm"
          value={mode}
          onChange={setMode}
          options={provider.authModes.map((option) => ({
            value: option,
            label: t(`developersPage.aiTools.mode.${option}`),
          }))}
        />
      ) : null}
      {mode === 'token' && !token ? (
        <p className="text-xs text-text-muted">{t('developersPage.aiTools.tokenHint')}</p>
      ) : null}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
        {Array.from({ length: stepCount }, (_, i) => (
          <li key={i}>{t(`${base}.${mode}${i + 1}`, { url: mcpEndpointUrl(origin()) })}</li>
        ))}
      </ol>
      {snippets.map((snippet) => (
        <div key={snippet.id} className="relative">
          <pre className="max-h-64 overflow-x-auto rounded-md border border-border/50 bg-bg-elevated p-3 pr-28 text-xs">
            {snippet.code}
          </pre>
          <div className="absolute right-2 top-2 flex gap-1">
            {snippet.fileName ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('developersPage.aiTools.download', { file: snippet.fileName })}
                title={t('developersPage.aiTools.download', { file: snippet.fileName })}
                onClick={() =>
                  downloadSnippet(snippet, t('developersPage.aiTools.downloaded', { file: snippet.fileName }))
                }
              >
                <Download size={13} />
              </Button>
            ) : null}
            <McpCopyButton text={snippet.code} />
          </div>
        </div>
      ))}
      <Link to={DOCS_PATH} className="inline-block text-xs font-medium text-accent hover:underline">
        {t('developersPage.aiTools.docsLink')}
      </Link>
    </>
  )
}

type Props = {
  token: string | null
  grants: McpOAuthGrant[]
}

/** Inbound MCP: one collapsible row per AI tool that can call this workspace. */
export function ConnectAiToolsSection({ token, grants }: Props) {
  const { t } = useTranslation('nav')

  return (
    <section id="connect-ai-tools" data-testid="connect-ai-tools">
      <h2 className="flex items-center gap-1.5 text-lg font-semibold text-text-heading">
        <Plug size={15} className="text-text-muted" />
        {t('developersPage.aiTools.title')}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">{t('developersPage.aiTools.body')}</p>
      <div className="mt-4 space-y-2">
        {AI_TOOL_PROVIDERS.map((provider) => {
          const connectedAs = matchingGrantName(provider, grants)
          const status = connectedAs
            ? t('developersPage.aiTools.status.connected')
            : provider.authModes.includes('oauth')
              ? t('developersPage.aiTools.status.oauth')
              : t('developersPage.aiTools.status.token')
          return (
            <AiToolProviderRow
              key={provider.id}
              brand={provider.brand}
              name={t(`developersPage.aiTools.providers.${provider.id}.name`)}
              description={t(`developersPage.aiTools.providers.${provider.id}.description`)}
              status={status}
              tone={connectedAs ? 'connected' : provider.authModes.includes('oauth') ? 'available' : 'muted'}
              testId={`ai-tool-${provider.id}`}
            >
              <ProviderBody provider={provider} token={token} />
            </AiToolProviderRow>
          )
        })}
      </div>
    </section>
  )
}

import { useTranslation } from 'react-i18next'
import { McpCopyButton } from './McpCopyButton'

type ClientId = 'cursor' | 'claude' | 'generic'

type Props = {
  clientId: ClientId
  configSnippet: string
  stepKeys: [string, string, string]
}

export function McpClientSetupCard({ clientId, configSnippet, stepKeys }: Props) {
  const { t } = useTranslation('nav')
  const titleKey = `integrations.mcp.bokito.clients.${clientId}` as const

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <h4 className="font-medium text-text-heading">{t(titleKey)}</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-text-secondary">
        {stepKeys.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <div className="relative">
        <pre className="bg-bg-surface p-4 rounded border border-border text-xs overflow-x-auto max-h-64">
          {configSnippet}
        </pre>
        <div className="absolute top-3 right-3">
          <McpCopyButton text={configSnippet} />
        </div>
      </div>
    </div>
  )
}

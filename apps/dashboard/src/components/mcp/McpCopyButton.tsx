import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'

export function McpCopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation('nav')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => void handleCopy()} className="gap-1.5">
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied
        ? t('integrations.mcp.bokito.copied')
        : (label ?? t('integrations.mcp.bokito.copy'))}
    </Button>
  )
}

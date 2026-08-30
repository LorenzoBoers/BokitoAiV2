import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { useAuth } from '../../context/AuthContext'
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import {
  composeDefaultSignatureHtml,
  plainTextToSignatureHtml,
  withAgentDisclaimer,
} from '../../lib/default-signature'
import type { ReplySendAs } from '../../lib/inbox-api'
import { cn } from '../../lib/utils'

type Props = {
  agentId: string
  agentName: string
  signatureText: string
  replySendAs: ReplySendAs
  canEdit: boolean
  companyName?: string | null
  onChanged?: () => void
}

/**
 * Outbound mail identity for a company agent: default Send as (agent vs
 * impersonate teammate) + plain-text signature. Agent sends always preview
 * the Bokito AI powered-by line.
 */
export function AgentSignatureCard({
  agentId,
  agentName,
  signatureText,
  replySendAs,
  canEdit,
  companyName,
  onChanged,
}: Props) {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const [sendAs, setSendAs] = useState<ReplySendAs>(replySendAs)
  const [text, setText] = useState(signatureText)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) {
      setSendAs(replySendAs)
      setText(signatureText)
    }
  }, [replySendAs, signatureText, dirty])

  const previewHtml = useMemo(() => {
    const body =
      plainTextToSignatureHtml(text) ||
      composeDefaultSignatureHtml({
        name: agentName,
        company: companyName,
        language: i18n.language,
      })
    if (sendAs === 'agent') {
      return withAgentDisclaimer(body, i18n.language)
    }
    return body
  }, [text, sendAs, agentName, companyName, i18n.language])

  const save = async () => {
    if (!token || busy) return
    setBusy(true)
    try {
      await bokitoUpdateAgent(token, agentId, {
        email_signature_text: text,
        reply_send_as: sendAs,
      })
      toast.success(t('workforce.agents.signatureSaved'))
      setDirty(false)
      onChanged?.()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('workforce.agents.signatureSaveError'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="px-4 py-3">
      <div>
        <h3 className="text-base font-semibold text-text-heading">
          {t('workforce.agents.signatureTitle')}
        </h3>
        <p className="mt-1 text-sm text-text-muted">
          {t('workforce.agents.signatureBody', { name: agentName })}
        </p>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <Label className="text-xs text-text-muted">
            {t('workforce.agents.replySendAsLabel')}
          </Label>
          <p className="mt-0.5 text-xs text-text-muted">
            {t('workforce.agents.replySendAsHint')}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setSendAs('agent')
                setDirty(true)
              }}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                sendAs === 'agent'
                  ? 'border-accent/50 bg-accent/8 text-text-heading'
                  : 'border-border/60 bg-bg-input/30 text-text-secondary hover:border-accent/30',
                !canEdit && 'cursor-default opacity-70',
              )}
            >
              <span className="block font-medium">
                {t('workforce.agents.replySendAsAgent')}
              </span>
              <span className="mt-0.5 block text-xs text-text-muted">
                {t('workforce.agents.replySendAsAgentHint')}
              </span>
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setSendAs('user')
                setDirty(true)
              }}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                sendAs === 'user'
                  ? 'border-accent/50 bg-accent/8 text-text-heading'
                  : 'border-border/60 bg-bg-input/30 text-text-secondary hover:border-accent/30',
                !canEdit && 'cursor-default opacity-70',
              )}
            >
              <span className="block font-medium">
                {t('workforce.agents.replySendAsUser')}
              </span>
              <span className="mt-0.5 block text-xs text-text-muted">
                {t('workforce.agents.replySendAsUserHint')}
              </span>
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor={`agent-sig-${agentId}`} className="text-xs text-text-muted">
            {t('workforce.agents.signatureTextLabel')}
          </Label>
          <p className="mt-0.5 text-xs text-text-muted">
            {t('workforce.agents.signatureTextHint')}
          </p>
          <Textarea
            id={`agent-sig-${agentId}`}
            value={text}
            disabled={!canEdit}
            rows={4}
            className="mt-2 resize-y text-sm"
            placeholder={t('workforce.agents.signatureTextPlaceholder', { name: agentName })}
            onChange={(e) => {
              setText(e.target.value)
              setDirty(true)
            }}
          />
        </div>

        <div>
          <p className="text-xs font-medium text-text-secondary">
            {t('workforce.agents.signaturePreview')}
          </p>
          <div
            className="mt-1.5 rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-[13px] leading-relaxed text-text-secondary [&_a]:underline [&_p]:my-0.5"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
          {sendAs === 'agent' ? (
            <p className="mt-1.5 text-[11px] text-text-muted">
              {t('workforce.agents.signatureDisclaimerNote')}
            </p>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {t('workforce.agents.signatureSave')}
            </Button>
            {dirty ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSendAs(replySendAs)
                  setText(signatureText)
                  setDirty(false)
                }}
              >
                {t('common:actions.cancel', { defaultValue: 'Cancel' })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  )
}

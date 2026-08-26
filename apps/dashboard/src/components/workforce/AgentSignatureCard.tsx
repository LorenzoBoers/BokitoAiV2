import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { useAuth } from '../../context/AuthContext'
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import SignatureEditor from '../inbox/SignatureEditor'

type Props = {
  agentId: string
  agentName: string
  signatureHtml: string
  canEdit: boolean
  onChanged?: () => void
}

/** Signature card on the agent detail page: the HTML appended to outbound
 * replies sent as this agent (auto mode, or "send as agent" on approvals). */
export function AgentSignatureCard({ agentId, agentName, signatureHtml, canEdit, onChanged }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [editorOpen, setEditorOpen] = useState(false)

  const save = async (signature: string) => {
    if (!token) return
    try {
      await bokitoUpdateAgent(token, agentId, { email_signature_html: signature })
      toast.success(t('workforce.agents.signatureSaved'))
      onChanged?.()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('workforce.agents.signatureSaveError'),
      )
    }
  }

  return (
    <Card className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-text-heading">
            {t('workforce.agents.signatureTitle')}
          </h3>
          <p className="mt-1 text-sm text-text-muted">
            {t('workforce.agents.signatureBody', { name: agentName })}
          </p>
        </div>
        {canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditorOpen(true)}>
            <PenLine size={14} className="mr-1.5" aria-hidden />
            {signatureHtml
              ? t('workforce.agents.signatureEdit')
              : t('workforce.agents.signatureAdd')}
          </Button>
        ) : null}
      </div>
      <div className="mt-3">
        {signatureHtml.trim() ? (
          <div
            className="rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-[13px] leading-relaxed text-text-secondary [&_p]:my-0.5"
            dangerouslySetInnerHTML={{ __html: signatureHtml }}
          />
        ) : (
          <p className="text-sm text-text-muted">
            {t('workforce.agents.signatureEmpty')}{' '}
            <Link to="/settings/channels" className="font-medium text-accent hover:underline">
              {t('workforce.agents.openMailboxSignatures')}
            </Link>
          </p>
        )}
      </div>
      <SignatureEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initialSignature={signatureHtml}
        onSave={(signature) => void save(signature)}
        contextLabel={t('workforce.agents.signatureEditorContext', { name: agentName })}
      />
    </Card>
  )
}

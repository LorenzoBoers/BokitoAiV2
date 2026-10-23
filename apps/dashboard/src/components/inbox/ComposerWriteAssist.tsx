/**
 * Compose-with-AI menu for the customer reply composer: intent → draft,
 * plus quick rewrite actions on existing text.
 */
import { Spinner } from '../ui/spinner'
import { Button } from '../ui/button'
import { Pressable } from '../ui/pressable'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { draftComposerText, draftThreadReply } from '../../lib/inbox-api'
import { cn } from '../../lib/utils'
import { appendSpeechChunk, useSpeechDictation } from '../../hooks/useSpeechDictation'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { DictationLevelMeter, DictationMicButton } from './DictationMicButton'

export type ComposeAiAction =
  | 'compose'
  | 'rewrite'
  | 'shorten'
  | 'expand'
  | 'formal'
  | 'friendly'

type Props = {
  /** Existing conversation. Omit to draft from the instruction alone. */
  threadId?: string | null
  body: string
  disabled?: boolean
  onApply: (text: string, meta?: { fromAi?: boolean }) => void
}

function buildInstruction(action: ComposeAiAction, body: string, intent: string): string {
  const draft = body.trim()
  const tip = intent.trim()
  switch (action) {
    case 'shorten':
      return [
        'Shorten the following customer-facing draft. Keep the meaning and tone. Output only the revised body.',
        tip ? `Extra guidance: ${tip}` : '',
        `Current draft:\n${draft}`,
      ]
        .filter(Boolean)
        .join('\n')
    case 'expand':
      return [
        'Expand the following customer-facing draft with one or two helpful sentences. Output only the revised body.',
        tip ? `Extra guidance: ${tip}` : '',
        `Current draft:\n${draft}`,
      ]
        .filter(Boolean)
        .join('\n')
    case 'formal':
      return [
        'Rewrite the following customer-facing draft in a more formal, professional tone. Output only the revised body.',
        tip ? `Extra guidance: ${tip}` : '',
        `Current draft:\n${draft}`,
      ]
        .filter(Boolean)
        .join('\n')
    case 'friendly':
      return [
        'Rewrite the following customer-facing draft in a warmer, friendlier tone. Output only the revised body.',
        tip ? `Extra guidance: ${tip}` : '',
        `Current draft:\n${draft}`,
      ]
        .filter(Boolean)
        .join('\n')
    case 'rewrite':
      return [
        'Rewrite the following customer-facing draft more clearly. Output only the revised body.',
        tip ? `Extra guidance: ${tip}` : '',
        `Current draft:\n${draft}`,
      ]
        .filter(Boolean)
        .join('\n')
    case 'compose':
    default:
      return tip
        ? `Write a customer-facing reply from this operator intent (output only the body):\n${tip}`
        : 'Draft a concise, professional reply to the latest customer message. Output only the customer-facing body.'
  }
}

export default function ComposerWriteAssist({ threadId, body, disabled, onApply }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [dictationInterim, setDictationInterim] = useState('')
  const dictationInterimRef = useRef('')
  dictationInterimRef.current = dictationInterim
  const intentRef = useRef(intent)
  intentRef.current = intent

  const appendDictation = useCallback((chunk: string) => {
    setIntent((prev) => appendSpeechChunk(prev, chunk))
    setDictationInterim('')
  }, [])

  const dictation = useSpeechDictation({
    onFinal: appendDictation,
    onInterim: setDictationInterim,
  })

  const confirmDictation = useCallback(() => {
    const pending = dictationInterimRef.current.trim()
    dictation.stop()
    if (pending) appendDictation(pending)
    else setDictationInterim('')
  }, [appendDictation, dictation])

  useEffect(() => {
    if (open) return
    if (!dictation.listening) return
    confirmDictation()
    // Only flush when the menu closes; do not re-run on confirm identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open is the trigger
  }, [open])

  const intentDisplay = useMemo(() => {
    if (!dictation.listening || !dictationInterim.trim()) return intent
    return intent ? `${intent} ${dictationInterim}` : dictationInterim
  }, [dictation.listening, dictationInterim, intent])

  const run = async (action: ComposeAiAction) => {
    if (!token || busy) return
    if (dictation.listening) confirmDictation()
    if (action !== 'compose' && !body.trim()) {
      toast.error(t('composer.aiNeedText'))
      return
    }
    if (action === 'compose' && !intent.trim() && !body.trim() && !threadId) {
      toast.error(t('composer.aiNeedText'))
      return
    }
    setBusy(true)
    try {
      const instruction = buildInstruction(action, body, intentRef.current)
      const draft = threadId
        ? await draftThreadReply(token, threadId, instruction)
        : await draftComposerText(token, instruction)
      if (!draft.trim()) {
        toast.error(t('composer.aiEmpty'))
        return
      }
      onApply(draft.trim(), { fromAi: true })
      setIntent('')
      setOpen(false)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('composer.aiError')))
    } finally {
      setBusy(false)
    }
  }

  const hasDraft = Boolean(body.trim())

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost"
          type="button"
          disabled={disabled || busy}
          title={t('composer.writeWithAi')}
          aria-label={t('composer.writeWithAi')}
          className="shrink-0 text-ai-ink"
        >
          {busy ? <Spinner size="md" /> : <Sparkles size={14} />}
          <span className="hidden sm:inline">{t('composer.writeWithAiShort')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="border-b border-border px-3 py-2.5">
          <p className="mb-1.5 text-2xs font-semibold text-text-muted">
            {t('composer.aiIntentLabel')}
          </p>
          <div className="relative">
            <textarea
              value={intentDisplay}
              readOnly={dictation.listening}
              onChange={(e) => {
                if (dictation.listening) return
                setIntent(e.target.value)
              }}
              rows={2}
              placeholder={
                dictation.listening
                  ? t('composer.dictationListening')
                  : t('composer.aiIntentPlaceholder')
              }
              className={cn(
                'w-full resize-none rounded-lg border border-border bg-bg-elevated/50 py-2 pl-2.5 text-xs leading-5 text-text-primary placeholder:text-text-muted focus:border-ai/40 focus:outline-none',
                dictation.listening ? 'pr-36' : 'pr-11',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void run('compose')
                }
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
            {dictation.supported ? (
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5">
                {dictation.listening ? <DictationLevelMeter /> : null}
                <div className="pointer-events-auto">
                  <DictationMicButton
                    size="sm"
                    listening={dictation.listening}
                    disabled={busy || disabled}
                    onStart={() => {
                      dictation.start()
                    }}
                    onConfirm={confirmDictation}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <Pressable
            type="button"
            disabled={busy || disabled}
            onClick={() => void run('compose')}
            className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-ai px-2.5 text-xs font-medium text-ai-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Spinner size="md" /> : <Wand2 size={14} />}
            {hasDraft && !intent.trim() ? t('composer.aiRedraft') : t('composer.aiGenerate')}
          </Pressable>
        </div>

        {hasDraft ? (
          <div className="px-1 py-1">
            <DropdownMenuLabel className="text-2xs font-semibold text-text-muted">
              {t('composer.aiQuickActions')}
            </DropdownMenuLabel>
            {(
              [
                ['rewrite', 'composer.aiRewrite'],
                ['shorten', 'composer.aiShorten'],
                ['expand', 'composer.aiExpand'],
                ['formal', 'composer.aiFormal'],
                ['friendly', 'composer.aiFriendly'],
              ] as const
            ).map(([action, key]) => (
              <DropdownMenuItem
                key={action}
                disabled={busy}
                className="text-xs"
                onSelect={(e) => {
                  e.preventDefault()
                  void run(action)
                }}
              >
                {t(key)}
              </DropdownMenuItem>
            ))}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

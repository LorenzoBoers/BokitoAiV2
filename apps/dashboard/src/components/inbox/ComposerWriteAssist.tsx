/**
 * Compose-with-AI menu for the customer reply composer: intent → draft,
 * quick rewrite actions on existing text, plus demoted saved replies.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  BookmarkPlus,
  Loader2,
  MessageSquareText,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { draftThreadReply } from '../../lib/inbox-api'
import {
  createSavedReply,
  listSavedReplies,
  type SavedReplyRow,
} from '../../lib/signals-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

export type ComposeAiAction =
  | 'compose'
  | 'rewrite'
  | 'shorten'
  | 'expand'
  | 'formal'
  | 'friendly'

type Props = {
  threadId: string
  body: string
  disabled?: boolean
  onApply: (text: string) => void
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
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedReplies, setSavedReplies] = useState<SavedReplyRow[] | null>(null)

  const loadSavedReplies = async () => {
    if (!token || savedReplies !== null) return
    try {
      setSavedReplies(await listSavedReplies(token))
    } catch {
      setSavedReplies([])
    }
  }

  const run = async (action: ComposeAiAction) => {
    if (!token || busy) return
    if (action !== 'compose' && !body.trim()) {
      toast.error(t('composer.aiNeedText'))
      return
    }
    if (action === 'compose' && !intent.trim() && !body.trim()) {
      // Empty compose still drafts from thread context (API default).
    }
    setBusy(true)
    try {
      const instruction = buildInstruction(action, body, intent)
      const draft = await draftThreadReply(token, threadId, instruction)
      if (!draft.trim()) {
        toast.error(t('composer.aiEmpty'))
        return
      }
      onApply(draft.trim())
      setIntent('')
      setOpen(false)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('composer.aiError')))
    } finally {
      setBusy(false)
    }
  }

  const insertSavedReply = (row: SavedReplyRow) => {
    onApply(body.trim() ? `${body.trimEnd()}\n\n${row.bodyText}` : row.bodyText)
    setOpen(false)
  }

  const saveCurrentAsReply = async () => {
    if (!token || !body.trim()) return
    const title = window.prompt(t('composer.templateNamePrompt'), body.trim().slice(0, 40))
    if (!title?.trim()) return
    try {
      const created = await createSavedReply(token, { title: title.trim(), bodyText: body.trim() })
      if (created) {
        setSavedReplies((prev) => (prev ? [...prev, created] : [created]))
        toast.success(t('composer.savedReplyCreated'))
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('composer.saveReplyError')))
    }
  }

  const hasDraft = Boolean(body.trim())

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void loadSavedReplies()
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || busy}
          title={t('composer.writeWithAi')}
          aria-label={t('composer.writeWithAi')}
          className="flex h-8 shrink-0 items-center gap-1 rounded-xl px-2 text-[11px] font-medium text-ai-ink transition-colors hover:bg-ai/10 disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          <span className="hidden sm:inline">{t('composer.writeWithAiShort')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="border-b border-border/50 px-3 py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {t('composer.aiIntentLabel')}
          </p>
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={2}
            placeholder={t('composer.aiIntentPlaceholder')}
            className="w-full resize-none rounded-lg border border-border/60 bg-bg-elevated/50 px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:border-ai/40 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void run('compose')
              }
            }}
          />
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => void run('compose')}
            className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-ai px-2.5 text-[12px] font-medium text-ai-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            {hasDraft && !intent.trim() ? t('composer.aiRedraft') : t('composer.aiGenerate')}
          </button>
        </div>

        {hasDraft ? (
          <div className="px-1 py-1">
            <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
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

        <DropdownMenuSeparator />
        <div className="px-1 py-1">
          <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            <MessageSquareText size={11} />
            {t('composer.savedReplies')}
          </DropdownMenuLabel>
          {savedReplies === null ? (
            <DropdownMenuItem disabled className="text-xs">
              {t('composer.loadingSavedReplies')}
            </DropdownMenuItem>
          ) : savedReplies.length === 0 ? (
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => navigate('/settings/channels#saved-replies')}
            >
              {t('composer.noSavedReplies')}
            </DropdownMenuItem>
          ) : (
            savedReplies.slice(0, 6).map((row) => (
              <DropdownMenuItem
                key={row.id}
                className="flex-col items-start gap-0.5 text-xs"
                onSelect={() => insertSavedReply(row)}
              >
                <span className="font-medium text-text-heading">{row.title}</span>
                <span className="line-clamp-1 text-[11px] text-text-muted">{row.bodyText}</span>
              </DropdownMenuItem>
            ))
          )}
          {body.trim() ? (
            <DropdownMenuItem className="gap-1.5 text-xs" onSelect={() => void saveCurrentAsReply()}>
              <BookmarkPlus size={12} />
              {t('composer.saveAsTemplate')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="text-xs"
            onSelect={() => navigate('/settings/channels#saved-replies')}
          >
            {t('composer.manageSavedReplies')}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

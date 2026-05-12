import { useState } from 'react'
import { Send, StickyNote } from 'lucide-react'
import { Button } from '../ui/button'

type Mode = 'reply' | 'note'

type Props = {
  onReply: (bodyText: string, action: 'send' | 'send_and_close' | 'send_and_pending') => Promise<void>
  onNote: (bodyText: string) => Promise<void>
  saving: boolean
  disabled?: boolean
}

export default function ReplyComposer({ onReply, onNote, saving, disabled }: Props) {
  const [mode, setMode] = useState<Mode>('reply')
  const [body, setBody] = useState('')

  const handleSubmit = async (action: 'send' | 'send_and_close' | 'send_and_pending') => {
    const text = body.trim()
    if (!text) return
    if (mode === 'note') {
      await onNote(text)
    } else {
      await onReply(text, action)
    }
    setBody('')
  }

  return (
    <div className="border-t border-border/50 p-3 bg-bg-surface">
      <div className="flex gap-1 mb-2">
        <button
          type="button"
          onClick={() => setMode('reply')}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
            mode === 'reply'
              ? 'bg-accent/15 text-accent font-semibold ring-1 ring-accent/20'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <Send size={11} />
          Antwoord
        </button>
        <button
          type="button"
          onClick={() => setMode('note')}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
            mode === 'note'
              ? 'bg-yellow-100 text-yellow-800 font-semibold ring-1 ring-yellow-300/60 dark:bg-yellow-900/30 dark:text-yellow-200 dark:ring-yellow-700/40'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <StickyNote size={11} />
          Notitie
        </button>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={disabled || saving}
        placeholder={mode === 'note' ? 'Interne notitie...' : 'Typ een antwoord...'}
        rows={3}
        className="w-full resize-none rounded-md border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:opacity-50"
      />

      <div className="flex items-center justify-end gap-2 mt-2">
        {mode === 'reply' ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={!body.trim() || saving || disabled}
              onClick={() => void handleSubmit('send_and_close')}
            >
              Stuur en sluit
            </Button>
            <Button
              size="sm"
              disabled={!body.trim() || saving || disabled}
              onClick={() => void handleSubmit('send')}
            >
              <Send size={13} />
              {saving ? 'Versturen...' : 'Verstuur'}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={!body.trim() || saving || disabled}
            onClick={() => void handleSubmit('send')}
            className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border border-yellow-300/70 dark:bg-yellow-900/30 dark:text-yellow-200 dark:hover:bg-yellow-900/40 dark:border-yellow-700/40"
          >
            <StickyNote size={13} />
            {saving ? 'Opslaan...' : 'Notitie toevoegen'}
          </Button>
        )}
      </div>
    </div>
  )
}

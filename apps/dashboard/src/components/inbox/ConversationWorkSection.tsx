import { useTranslation } from 'react-i18next'
import { ThreadCasesList } from './ThreadCasesList'

type Props = {
  threadId: string | number
}

/** Conversation-scoped Signals. Not Contact identity; not a project folder. */
export function ConversationWorkSection({ threadId }: Props) {
  const { t } = useTranslation('communication')

  return (
    <div className="border-t border-border/40 px-4 py-3 space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {t('sidePanel.thisConversation', { defaultValue: 'This conversation' })}
      </h2>
      <ThreadCasesList signalId={String(threadId)} />
    </div>
  )
}

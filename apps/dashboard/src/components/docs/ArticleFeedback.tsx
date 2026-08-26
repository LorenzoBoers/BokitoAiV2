import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { apiPost } from '../../lib/api'
import { appRoutes } from '../../api/routes'

/**
 * "Was this helpful?" hook on product-help articles. Feeds the learning loop
 * via the standard feedback endpoint (`subject_type=product_help`), so weak
 * articles become visible. Requires a session; anonymous visitors on the
 * public docs simply do not see it.
 */
export default function ArticleFeedback({ slug }: { slug: string }) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')

  if (!token) return null

  async function submit(sentiment: 'up' | 'down') {
    if (state !== 'idle') return
    setState('sending')
    try {
      await apiPost(appRoutes.learning.feedback, {
        subject_type: 'product_help',
        subject_id: slug,
        sentiment,
      })
      setState('done')
    } catch {
      setState('idle')
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 px-4 py-3">
      {state === 'done' ? (
        <p className="text-[12.5px] text-text-muted">{t('pageGuides.feedback.thanks')}</p>
      ) : (
        <>
          <p className="text-[12.5px] font-medium text-text-secondary">
            {t('pageGuides.feedback.question')}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void submit('up')}
              disabled={state === 'sending'}
              aria-label={t('pageGuides.feedback.yes')}
              className="rounded-lg border border-border/60 p-1.5 text-text-secondary transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              <ThumbsUp size={13} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void submit('down')}
              disabled={state === 'sending'}
              aria-label={t('pageGuides.feedback.no')}
              className="rounded-lg border border-border/60 p-1.5 text-text-secondary transition-colors hover:border-status-error/50 hover:text-status-error disabled:opacity-50"
            >
              <ThumbsDown size={13} aria-hidden />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

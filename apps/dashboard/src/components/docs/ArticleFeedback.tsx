import { Button } from '../ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { apiPost } from '../../lib/api'
import { appRoutes } from '../../api/routes'
import { helpLang } from '../../lib/product-help-api'
import { useDocsT } from './DocsChrome'

/**
 * "Was this helpful?" hook on product-help articles. Feeds the learning loop
 * via the standard feedback endpoint (`subject_type=product_help`), so weak
 * articles become visible. Requires a session; anonymous visitors on the
 * public docs simply do not see it.
 */
export default function ArticleFeedback({ slug, lang }: { slug: string; lang?: string }) {
  const { i18n } = useTranslation()
  const t = useDocsT(lang ?? helpLang(i18n.language))
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
    <div className="flex flex-wrap items-center gap-2">
      {state === 'done' ? (
        <p className="text-sm text-text-muted">{t('pageGuides.feedback.thanks')}</p>
      ) : (
        <>
          <p className="text-sm text-text-secondary">{t('pageGuides.feedback.question')}</p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="iconSm"
              type="button"
              onClick={() => void submit('up')}
              disabled={state === 'sending'}
              aria-label={t('pageGuides.feedback.yes')}
              className="text-text-secondary hover:text-accent"
            >
              <ThumbsUp size={14} aria-hidden />
            </Button>
            <Button variant="ghost" size="iconSm"
              type="button"
              onClick={() => void submit('down')}
              disabled={state === 'sending'}
              aria-label={t('pageGuides.feedback.no')}
              className="text-text-secondary hover:text-status-error"
            >
              <ThumbsDown size={14} aria-hidden />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

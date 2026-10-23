import { Pressable } from '../ui/pressable'
import { useEffect, useState } from 'react'
import { Check, Copy, List } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { TocItem } from '../../lib/docs-toc'
import { useDocsT } from './DocsChrome'
import ArticleFeedback from './ArticleFeedback'

type DocsPageTocProps = {
  lang: string
  toc: TocItem[]
  slug?: string
  onCopyForLlm?: () => Promise<void> | void
  className?: string
  /** Compact disclosure under the title on small screens. */
  compact?: boolean
}

/** Right-rail "On this page" with scroll-spy, Copy for LLM, and feedback. */
export default function DocsPageToc({
  lang,
  toc,
  slug,
  onCopyForLlm,
  className,
  compact = false,
}: DocsPageTocProps) {
  const t = useDocsT(lang)
  const [activeId, setActiveId] = useState<string | null>(toc[0]?.id ?? null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (toc.length === 0) return
    const elements = toc
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el))
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    )
    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [toc])

  async function handleCopy() {
    if (!onCopyForLlm) return
    try {
      await onCopyForLlm()
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable
    }
  }

  const tocList =
    toc.length > 0 ? (
      <ul className={cn('space-y-2', !compact && 'pl-0.5')}>
        {toc.map((item) => (
          <li key={item.id} className={item.level === 3 ? 'pl-3' : undefined}>
            <a
              href={`#${item.id}`}
              className={cn(
                'block text-docs-nav leading-snug transition-colors',
                activeId === item.id
                  ? 'font-medium text-[var(--docs-fg)]'
                  : 'text-[var(--docs-muted)] hover:text-[var(--docs-fg)]',
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    ) : null

  const utilities = (
    <div className="space-y-2 pt-4">
      {onCopyForLlm ? (
        <Pressable
          onClick={() => void handleCopy()}
          className="docs-util w-full justify-start"
        >
          {copied ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          {copied ? t('docs.copyForLlmDone') : t('docs.copyForLlm')}
        </Pressable>
      ) : null}
      {slug ? (
        <div className="pt-1">
          <ArticleFeedback slug={slug} lang={lang} />
        </div>
      ) : null}
    </div>
  )

  if (compact) {
    return (
      <div className={cn('space-y-4', className)}>
        {toc.length > 0 ? (
          <details className="rounded-lg bg-[var(--docs-hover)] px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--docs-fg)]">
              {t('docs.onThisPage')}
            </summary>
            <div className="mt-2">{tocList}</div>
          </details>
        ) : null}
        {utilities}
      </div>
    )
  }

  return (
    <aside className={cn('space-y-6', className)}>
      {toc.length > 0 ? (
        <nav aria-label={t('docs.onThisPage')}>
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--docs-fg)]">
            <List className="h-3.5 w-3.5" aria-hidden />
            {t('docs.onThisPage')}
          </p>
          {tocList}
        </nav>
      ) : null}
      {utilities}
    </aside>
  )
}

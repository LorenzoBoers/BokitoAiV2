import { useEffect, useState, type ReactNode } from 'react'
import {
  getProductHelpIndex,
  type ProductHelpIndex,
} from '../../lib/product-help-api'
import DocsScrollShell from './DocsScrollShell'
import { DocsHeader, useDocsT } from './DocsChrome'
import DocsSideNav from './DocsSideNav'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

export function useDocsIndex(lang: string) {
  const [index, setIndex] = useState<ProductHelpIndex | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setError(false)
    void getProductHelpIndex(lang)
      .then((idx) => {
        if (!cancelled) setIndex(idx)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [lang])
  return { index, error }
}

type DocsSiteShellProps = {
  lang: string
  setLang: (next: 'en' | 'nl') => void
  index: ProductHelpIndex | null
  activeSlug?: string | null
  activePage?: 'docs' | 'api'
  /** Center column content. */
  children: ReactNode
  /** Optional right rail (TOC / utilities). */
  right?: ReactNode
  /**
   * Full-bleed center column without the article left/right rails
   * (API reference — Scalar brings its own sidebar).
   */
  wide?: boolean
}

/**
 * Full-width three-column docs layout: left nav, center prose, optional right rail.
 * Side nav is sticky within the scrollport; mobile uses a drawer.
 */
export default function DocsSiteShell({
  lang,
  setLang,
  index,
  activeSlug = null,
  activePage = 'docs',
  children,
  right,
  wide = false,
}: DocsSiteShellProps) {
  const t = useDocsT(lang)
  const [navOpen, setNavOpen] = useState(false)

  return (
    <DocsScrollShell
      className={
        wide
          ? 'docs-site docs-api-forced-dark flex h-dvh min-h-0 flex-col overflow-hidden'
          : 'docs-site flex h-dvh min-h-0 flex-col overflow-hidden'
      }
      header={
        <DocsHeader
          lang={lang}
          setLang={setLang}
          activePage={activePage}
          onOpenNav={wide ? undefined : () => setNavOpen(true)}
        />
      }
    >
      {wide ? (
        <div className="w-full">{children}</div>
      ) : (
        <div className="mx-auto flex w-full max-w-[1720px]">
          <aside className="docs-rail sticky top-14 hidden max-h-[calc(100dvh-3.5rem)] w-[17.5rem] shrink-0 self-start overflow-y-auto px-5 py-8 lg:block">
            <DocsSideNav
              lang={lang}
              index={index}
              activeSlug={activeSlug}
              activePage={activePage}
            />
          </aside>

          <div className="min-w-0 flex-1 px-5 py-10 sm:px-8 lg:px-12 lg:py-12">
            <div className="mx-auto max-w-[42rem]">{children}</div>
          </div>

          {right ? (
            <aside className="docs-rail-right sticky top-14 hidden max-h-[calc(100dvh-3.5rem)] w-64 shrink-0 self-start overflow-y-auto px-5 py-8 xl:block">
              {right}
            </aside>
          ) : (
            <div className="hidden w-64 shrink-0 xl:block" aria-hidden />
          )}
        </div>
      )}

      {!wide ? (
        <Dialog open={navOpen} onOpenChange={setNavOpen}>
          <DialogContent className="docs-site max-h-[85dvh] max-w-sm overflow-y-auto border-[var(--docs-border)] bg-[var(--docs-bg)] text-[var(--docs-fg)]">
            <DialogHeader>
              <DialogTitle>{t('docs.openNav')}</DialogTitle>
            </DialogHeader>
            <DocsSideNav
              lang={lang}
              index={index}
              activeSlug={activeSlug}
              activePage={activePage}
              onNavigate={() => setNavOpen(false)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </DocsScrollShell>
  )
}

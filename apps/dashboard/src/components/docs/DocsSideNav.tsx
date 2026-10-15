import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import type { ProductHelpIndex } from '../../lib/product-help-api'
import { useDocsT } from './DocsChrome'

type DocsSideNavProps = {
  lang: string
  index: ProductHelpIndex | null
  /** Active article slug, or null on landing / API. */
  activeSlug?: string | null
  /** Highlight Developers when viewing /docs/api. */
  activePage?: 'docs' | 'api'
  onNavigate?: () => void
  className?: string
}

function navLinkClass(active: boolean): string {
  return cn('docs-nav-link block px-2.5 py-1.5 text-[0.8125rem] leading-snug transition-colors', {
    'font-medium': active,
  })
}

/** Hierarchical left nav for the public docs site. */
export default function DocsSideNav({
  lang,
  index,
  activeSlug = null,
  activePage = 'docs',
  onNavigate,
  className,
}: DocsSideNavProps) {
  const t = useDocsT(lang)

  if (!index) {
    return (
      <nav className={cn('space-y-4', className)} aria-label={t('docs.title')}>
        <p className="px-2 text-sm text-[var(--docs-muted)]">{t('docs.indexLoading')}</p>
      </nav>
    )
  }

  return (
    <nav className={cn('space-y-7', className)} aria-label={t('docs.title')}>
      <div className="space-y-0.5">
        <Link
          to="/docs"
          onClick={onNavigate}
          className={navLinkClass(!activeSlug && activePage === 'docs')}
          data-active={!activeSlug && activePage === 'docs' ? 'true' : undefined}
          aria-current={!activeSlug && activePage === 'docs' ? 'page' : undefined}
        >
          {t('docs.overview')}
        </Link>
        {/* Mobile drawer: API is header-only on lg+; keep it reachable here. */}
        <Link
          to="/docs/api"
          onClick={onNavigate}
          className={cn(navLinkClass(activePage === 'api'), 'lg:hidden')}
          data-active={activePage === 'api' ? 'true' : undefined}
          aria-current={activePage === 'api' ? 'page' : undefined}
        >
          {t('docs.apiReference')}
        </Link>
      </div>

      {index.sections.map((navSection) => (
        <div key={navSection.id}>
          <p className="docs-nav-section px-2.5">{t(`docs.sections.${navSection.id}.title`)}</p>
          <ul className="mt-2 space-y-0.5">
            {navSection.articles.map((item) => {
              const active = item.slug === activeSlug
              return (
                <li key={item.slug}>
                  <Link
                    to={`/docs/${item.path}`}
                    onClick={onNavigate}
                    className={navLinkClass(active)}
                    data-active={active ? 'true' : undefined}
                    aria-current={active ? 'page' : undefined}
                  >
                    {item.title}
                  </Link>
                </li>
              )
            })}
            {navSection.id === 'developers' ? (
              <li className="hidden lg:list-item">
                <Link
                  to="/docs/api"
                  onClick={onNavigate}
                  className={navLinkClass(activePage === 'api')}
                  data-active={activePage === 'api' ? 'true' : undefined}
                  aria-current={activePage === 'api' ? 'page' : undefined}
                >
                  {t('docs.apiReference')}
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ))}
    </nav>
  )
}

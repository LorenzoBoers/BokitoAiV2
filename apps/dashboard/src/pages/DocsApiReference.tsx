import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { publicOpenApiUrl } from '../lib/product-help-api'
import { applyDocsMeta } from '../lib/docs-seo'
import DocsScrollShell from '../components/docs/DocsScrollShell'

/**
 * Public API reference at /docs/api: Scalar API Reference rendered against
 * the curated OpenAPI schema (`/api/docs/openapi.json`). Scalar loads from a
 * CDN; when that fails we fall back to a link to the raw schema.
 */
export default function DocsApiReference() {
  const { t } = useTranslation('nav')
  const hostRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    return applyDocsMeta({
      title: `${t('docs.apiReference')} - ${t('docs.title')}`,
      description: t('docs.apiReferenceIntro'),
    })
  }, [t])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const config = document.createElement('script')
    config.id = 'api-reference'
    config.setAttribute('data-url', publicOpenApiUrl())
    host.appendChild(config)
    const loader = document.createElement('script')
    loader.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference'
    loader.async = true
    loader.onerror = () => setFailed(true)
    host.appendChild(loader)
    return () => {
      host.innerHTML = ''
    }
  }, [])

  return (
    <DocsScrollShell
      header={
        <header className="border-b">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
            <Link to="/docs" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <BookOpen className="h-4.5 w-4.5" aria-hidden />
              {t('docs.title')}
            </Link>
            <div className="flex items-center gap-2">
              <Link
                to="/docs/developers/api-overview"
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
              >
                <ArrowLeft className="h-3 w-3" aria-hidden />
                {t('docs.apiGuides')}
              </Link>
              <a
                href={publicOpenApiUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                openapi.json
              </a>
            </div>
          </div>
        </header>
      }
    >
      {failed ? (
        <main className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-sm text-muted-foreground">
            {t('docs.apiReferenceFallback')}{' '}
            <a href={publicOpenApiUrl()} className="text-primary underline" target="_blank" rel="noreferrer noopener">
              openapi.json
            </a>
          </p>
        </main>
      ) : (
        <div ref={hostRef} className="min-h-full" />
      )}
    </DocsScrollShell>
  )
}

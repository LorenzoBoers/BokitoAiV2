import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Code2, ExternalLink } from 'lucide-react'
import { publicOpenApiUrl } from '../lib/product-help-api'
import { applyDocsMeta } from '../lib/docs-seo'
import DocsScrollShell from '../components/docs/DocsScrollShell'
import { DocsHeader, useDocsLang } from '../components/docs/DocsChrome'

/**
 * Public API reference at /docs/api: Scalar API Reference rendered against
 * the curated OpenAPI schema (`/api/docs/openapi.json`). Scalar loads from a
 * CDN; when that fails we fall back to a link to the raw schema.
 */
export default function DocsApiReference() {
  const { t } = useTranslation('nav')
  const [lang, setLang] = useDocsLang()
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
    if (!host || failed) return
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
  }, [failed])

  return (
    <DocsScrollShell header={<DocsHeader lang={lang} setLang={setLang} activePage="api" />}>
      <div className="relative mx-auto max-w-6xl px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-4 h-56 overflow-hidden"
        >
          <div className="absolute left-1/2 top-0 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgb(var(--color-accent)/0.18),transparent_70%)] blur-2xl" />
        </div>

        <section className="relative border-b border-border/60 py-10 sm:py-12">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            {t('docs.sections.developers.title')}
          </p>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-2xl">
              <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                  <Code2 className="h-5 w-5" aria-hidden />
                </span>
                {t('docs.apiReference')}
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                {t('docs.apiReferenceIntro')}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                to="/docs/developers/api-overview"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3.5 py-2 text-xs font-medium transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
              >
                <ArrowLeft className="h-3 w-3" aria-hidden />
                {t('docs.apiGuides')}
              </Link>
              <a
                href={publicOpenApiUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
              >
                openapi.json
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
          </div>
        </section>

        {failed ? (
          <main className="py-16">
            <p className="text-sm text-muted-foreground">
              {t('docs.apiReferenceFallback')}{' '}
              <a
                href={publicOpenApiUrl()}
                className="text-accent underline underline-offset-2"
                target="_blank"
                rel="noreferrer noopener"
              >
                openapi.json
              </a>
            </p>
          </main>
        ) : (
          <div ref={hostRef} className="min-h-[calc(100dvh-12rem)] pb-8" />
        )}
      </div>
    </DocsScrollShell>
  )
}

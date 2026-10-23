import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react'
import { publicOpenApiUrl } from '../lib/product-help-api'
import { applyDocsMeta } from '../lib/docs-seo'
import DocsSiteShell, { useDocsIndex } from '../components/docs/DocsSiteShell'
import { useDocsLang, useDocsT } from '../components/docs/DocsChrome'

const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.28.34'

/** Custom CSS injected into Scalar so it sits on pure black with Bokito green. */
const SCALAR_CUSTOM_CSS = `
:root, .light-mode, .dark-mode, .dark-mode .dark-mode {
  --scalar-background-1: #000000 !important;
  --scalar-background-2: #050505 !important;
  --scalar-background-3: #0c0c0c !important;
  --scalar-background-accent: rgba(50, 191, 142, 0.12) !important;
  --scalar-border-color: rgba(255, 255, 255, 0.1) !important;
  --scalar-color-1: #ffffff !important;
  --scalar-color-2: #b3b3b3 !important;
  --scalar-color-3: #8a8a8a !important;
  --scalar-color-accent: #32bf8e !important;
  --scalar-button-1: #ffffff !important;
  --scalar-button-1-color: #000000 !important;
  --scalar-button-1-hover: #e8e8e8 !important;
  --scalar-radius: 8px !important;
  --scalar-radius-lg: 12px !important;
}
.scalar-app, .scalar-api-reference, .section-flare, .section, #scalar-root {
  background: #000000 !important;
  font-family: inherit !important; /* design-system-ignore: Scalar embed inherits the app font */
}
.t-doc__sidebar, .sidebar, .sidebar-group {
  background: #000000 !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}
.scalar-card, .card, [class*='card'] {
  background: #0a0a0a !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
}
.download-cta a, a.download-button {
  color: #32bf8e !important;
}
`

/**
 * Public API reference at /docs/api: Scalar API Reference rendered against
 * the curated OpenAPI schema (`/api/docs/openapi.json`). Scalar loads from a
 * CDN; when that fails we fall back to a link to the raw schema.
 */
export default function DocsApiReference() {
  const [lang, setLang] = useDocsLang()
  const t = useDocsT(lang)
  const { index } = useDocsIndex(lang)
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
    host.innerHTML = ''

    const config = {
      url: publicOpenApiUrl(),
      theme: 'none',
      layout: 'modern',
      darkMode: true,
      forceDarkModeState: 'dark',
      hideDarkModeToggle: true,
      hideSearch: true,
      showSidebar: true,
      telemetry: false,
      customCss: SCALAR_CUSTOM_CSS,
    }

    const configEl = document.createElement('script')
    configEl.id = 'api-reference'
    configEl.setAttribute('data-configuration', JSON.stringify(config))
    host.appendChild(configEl)

    const loader = document.createElement('script')
    loader.src = `${SCALAR_CDN}/dist/browser/standalone.js`
    loader.async = true
    loader.onerror = () => setFailed(true)
    host.appendChild(loader)

    return () => {
      host.innerHTML = ''
    }
  }, [failed])

  return (
    <DocsSiteShell lang={lang} setLang={setLang} index={index} activePage="api" wide>
      <div className="docs-api-page">
        <div className="px-5 py-6 sm:px-8 lg:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-[var(--docs-muted)]">
                {t('docs.sections.developers.title')}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--docs-fg)] sm:text-3xl">
                {t('docs.apiReference')}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--docs-muted)]">
                {t('docs.apiReferenceIntro')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link to="/docs/developers/api-overview" className="docs-util">
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t('docs.apiGuides')}
              </Link>
              <a
                href={publicOpenApiUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className="docs-util"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                openapi.json
              </a>
              <Link to="/docs" className="docs-util">
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t('docs.backToDocs')}
              </Link>
            </div>
          </div>
        </div>

        {failed ? (
          <p className="px-5 py-16 text-sm text-[var(--docs-muted)] sm:px-8 lg:px-10">
            {t('docs.apiReferenceFallback')}{' '}
            <a
              href={publicOpenApiUrl()}
              className="text-[var(--docs-accent)] underline underline-offset-2"
              target="_blank"
              rel="noreferrer noopener"
            >
              openapi.json
            </a>
          </p>
        ) : (
          <div ref={hostRef} className="docs-api-host min-h-[calc(100dvh-8rem)]" />
        )}
      </div>
    </DocsSiteShell>
  )
}

import { docsRoutes } from '../api/routes'
import { DOCS_API_BASE } from './api.config'

export type ProductHelpSectionId =
  | 'getting-started'
  | 'inbox'
  | 'ai'
  | 'govern'
  | 'integrations'
  | 'developers'

export const PRODUCT_HELP_SECTIONS: ProductHelpSectionId[] = [
  'getting-started',
  'inbox',
  'ai',
  'govern',
  'integrations',
  'developers',
]

export interface ProductHelpSummary {
  slug: string
  section: ProductHelpSectionId
  /** `{section}/{slug}` — the public URL path segment under /docs. */
  path: string
  title: string
  intro: string
  description: string
  keywords: string[]
  sort: number
  related: string[]
  updated_at: number
}

export interface ProductHelpSection {
  id: ProductHelpSectionId
  articles: ProductHelpSummary[]
}

export interface ProductHelpIndex {
  lang: string
  sections: ProductHelpSection[]
  articles: ProductHelpSummary[]
}

export interface ProductHelpArticle extends ProductHelpSummary {
  content: string
  lang: string
}

export interface ProductHelpSearchResult {
  slug: string
  section: ProductHelpSectionId
  path: string
  title: string
  heading: string
  snippet: string
  score: number
}

export function helpLang(language?: string | null): 'en' | 'nl' {
  const raw = (language ?? '').trim().toLowerCase()
  return raw.startsWith('en') ? 'en' : 'nl'
}

async function publicRequest(path: string, params: Record<string, string>): Promise<Response> {
  const query = new URLSearchParams(params)
  const res = await fetch(`${DOCS_API_BASE}${path}?${query.toString()}`)
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? ''
    } catch {
      // Non-JSON error body; fall back to the status code below.
    }
    if (res.status === 404) throw new Error('NOT_FOUND')
    throw new Error(detail || 'LOAD_FAILED')
  }
  return res
}

async function publicGet<T>(path: string, lang?: string | null): Promise<T> {
  const res = await publicRequest(path, { lang: helpLang(lang) })
  return (await res.json()) as T
}

export async function getProductHelpIndex(lang?: string | null): Promise<ProductHelpIndex> {
  return publicGet<ProductHelpIndex>(docsRoutes.index, lang)
}

export async function getProductHelpArticle(
  slug: string,
  lang?: string | null,
): Promise<ProductHelpArticle> {
  return publicGet<ProductHelpArticle>(docsRoutes.article(slug), lang)
}

export async function searchProductHelp(
  query: string,
  lang?: string | null,
): Promise<ProductHelpSearchResult[]> {
  const res = await publicRequest(docsRoutes.search, { lang: helpLang(lang), q: query })
  const body = (await res.json()) as { results: ProductHelpSearchResult[] }
  return body.results
}

export async function getProductHelpMarkdown(slug: string, lang?: string | null): Promise<string> {
  const res = await publicRequest(docsRoutes.articleMarkdown(slug), { lang: helpLang(lang) })
  return res.text()
}

/** Absolute-path URL of the curated public OpenAPI schema. */
export function publicOpenApiUrl(): string {
  return `${DOCS_API_BASE}${docsRoutes.openapi}`
}

/** Absolute-path URL of a product-help screenshot. */
export function docsAssetUrl(slug: string, name: string, ext: 'png' | 'webp' = 'png'): string {
  return `${DOCS_API_BASE}${docsRoutes.asset(`${slug}/${name}.${ext}`)}`
}

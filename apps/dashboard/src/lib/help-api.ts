import { helpRoutes } from '../api/routes'
import { HELP_API_BASE } from './api.config'

export interface HelpArticleSummary {
  slug: string
  title: string
  description: string
  updated_at: string
}

export interface HelpCenterIndex {
  tenant: { name: string; slug: string }
  articles: HelpArticleSummary[]
}

export interface HelpArticle extends HelpArticleSummary {
  tenant: { name: string; slug: string }
  content: string
}

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${HELP_API_BASE}${path}`)
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? ''
    } catch {
      // Non-JSON error body; fall back to the status code below.
    }
    throw new Error(detail || `Request failed (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}

export async function getHelpCenter(tenantSlug: string): Promise<HelpCenterIndex> {
  return publicGet<HelpCenterIndex>(helpRoutes.center(tenantSlug))
}

export async function getHelpArticle(
  tenantSlug: string,
  articleSlug: string,
): Promise<HelpArticle> {
  return publicGet<HelpArticle>(helpRoutes.article(tenantSlug, articleSlug))
}

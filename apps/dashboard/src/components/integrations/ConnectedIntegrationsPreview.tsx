import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { resolveIntegrationKind, type IntegrationKind } from '../../lib/integration-kind'
import {
  connectionCountForProvider,
  listIntegrationProviders,
  listMcpBindings,
} from '../../lib/integrations-api'
import { listGithubConnections } from '../../lib/github-api'
import { hostSlugForProvider, resolveProviderBrand } from '../../lib/integration-brand'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type PreviewChip = {
  id: string
  label: string
  detail?: string
  kind?: IntegrationKind
  providerSlug?: string
  hostSlug?: string | null
  logoUrl?: string | null
  logoDarkUrl?: string | null
  initials?: string
  brandColor?: string
}

export function ConnectedIntegrationsPreview() {
  const { t } = useTranslation('nav')
  const [chips, setChips] = useState<PreviewChip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const next: PreviewChip[] = []
      try {
        const gh = await listGithubConnections()
        const ghBrand = resolveProviderBrand('github', null)
        for (const c of gh) {
          next.push({
            id: `gh-${c.id}`,
            label: 'GitHub',
            detail: c.github_login,
            providerSlug: 'github',
            logoUrl: ghBrand.logoUrl,
            logoDarkUrl: ghBrand.logoDarkUrl,
            initials: ghBrand.initials,
            brandColor: ghBrand.color,
          })
        }
      } catch {
        // ignore
      }

      try {
        const { providers, connection_counts } = await listIntegrationProviders()
        for (const p of providers) {
          const count = connectionCountForProvider(p, connection_counts)
          if (count <= 0) continue
          if (p.slug === 'github') continue
          if (p.slug === 'outlook' && connection_counts.email_outlook > 0) {
            const brand = resolveProviderBrand(p.slug, p.host ?? null, p.logo_meta, p.name)
            next.push({
              id: 'outlook',
              label: 'Microsoft 365',
              detail: `${connection_counts.email_outlook} mailbox`,
              kind: 'inbox',
              providerSlug: p.slug,
              logoUrl: brand.logoUrl,
              logoDarkUrl: brand.logoDarkUrl,
              initials: brand.initials,
              brandColor: brand.color,
            })
          } else if (p.slug === 'gmail' && connection_counts.email_gmail > 0) {
            const brand = resolveProviderBrand(p.slug, p.host ?? null, p.logo_meta, p.name)
            next.push({
              id: 'gmail',
              label: 'Google Workspace',
              detail: `${connection_counts.email_gmail} mailbox`,
              kind: 'inbox',
              providerSlug: p.slug,
              logoUrl: brand.logoUrl,
              logoDarkUrl: brand.logoDarkUrl,
              initials: brand.initials,
              brandColor: brand.color,
            })
          } else if (p.slug !== 'outlook' && p.slug !== 'gmail') {
            const brand = resolveProviderBrand(p.slug, p.host ?? null, p.logo_meta, p.name)
            next.push({
              id: p.id,
              label: p.name,
              detail: `${count} verbinding`,
              kind: resolveIntegrationKind(p.slug, p.capabilities),
              providerSlug: p.slug,
              logoUrl: brand.logoUrl,
              logoDarkUrl: brand.logoDarkUrl,
              initials: brand.initials,
              brandColor: brand.color,
            })
          }
        }
      } catch {
        // ignore
      }

      try {
        const mcp = await listMcpBindings()
        if ((mcp.mcp_server_ids?.length ?? 0) > 0) {
          const mcpBrand = resolveProviderBrand('custom_mcp', null)
          next.push({
            id: 'mcp',
            label: 'MCP',
            detail: `${mcp.mcp_server_ids.length} server(s)`,
            kind: 'mcp',
            providerSlug: 'custom_mcp',
            hostSlug: mcpBrand.hostSlug,
            logoUrl: mcpBrand.logoUrl,
            logoDarkUrl: mcpBrand.logoDarkUrl,
            initials: mcpBrand.initials,
            brandColor: mcpBrand.color,
          })
        }
      } catch {
        // ignore
      }

      if (!cancelled) {
        setChips(next)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="rounded-xl border border-border/60 bg-bg-elevated/20 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-text-heading">Gekoppelde integraties</h3>
          <p className="text-xs text-text-secondary mt-0.5">
            Overzicht van actieve koppelingen. Beheer gebeurt onder Integraties.
          </p>
        </div>
        <Button size="sm" variant="secondary" asChild>
          <Link to="/integrations/connected" className="gap-1.5">
            {t('integrations.connected.viewAll', { defaultValue: 'View connected integrations' })}
            <ArrowRight size={14} />
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-text-muted">Laden...</p>
      ) : chips.length === 0 ? (
        <p className="text-xs text-text-muted">No integrations connected yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <div
              key={chip.id}
              className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-bg px-3 py-2"
            >
              {chip.initials && chip.brandColor ? (
                <IntegrationHostLogo
                  logoUrl={chip.logoUrl}
                  logoDarkUrl={chip.logoDarkUrl}
                  initials={chip.initials}
                  color={chip.brandColor}
                  name={chip.label}
                  hostSlug={
                    chip.hostSlug ??
                    (chip.providerSlug ? hostSlugForProvider(chip.providerSlug) : null)
                  }
                  size="sm"
                />
              ) : null}
              <span className="text-xs font-medium text-text-primary">{chip.label}</span>
              {chip.kind ? (
                <Badge variant="neutral" className="text-[10px]">
                  {t(`integrations.kind.${chip.kind}`)}
                </Badge>
              ) : null}
              {chip.detail ? (
                <Badge variant="neutral" className="text-[10px]">
                  {chip.detail}
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

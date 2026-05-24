import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  resolveProviderBrand,
  resolveProviderRowBrand,
  type ResolvedIntegrationBrand,
} from '../lib/integration-brand'
import { listIntegrationProviders } from '../lib/integrations-api'

type IntegrationBrandContextValue = {
  ready: boolean
  getBrand: (providerOrCatalogId: string) => ResolvedIntegrationBrand
}

const IntegrationBrandContext = createContext<IntegrationBrandContextValue | null>(null)

export function IntegrationBrandProvider({ children }: { children: ReactNode }) {
  const [byProviderSlug, setByProviderSlug] = useState<Map<string, ResolvedIntegrationBrand>>(
    new Map(),
  )
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listIntegrationProviders()
      .then(({ providers }) => {
        if (cancelled) return
        const map = new Map<string, ResolvedIntegrationBrand>()
        for (const row of providers) {
          map.set(row.slug, resolveProviderRowBrand(row))
        }
        setByProviderSlug(map)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const getBrand = useCallback(
    (providerOrCatalogId: string): ResolvedIntegrationBrand => {
      return (
        byProviderSlug.get(providerOrCatalogId) ??
        resolveProviderBrand(providerOrCatalogId, null)
      )
    },
    [byProviderSlug],
  )

  const value = useMemo(
    () => ({
      ready,
      getBrand,
    }),
    [ready, getBrand],
  )

  return (
    <IntegrationBrandContext.Provider value={value}>{children}</IntegrationBrandContext.Provider>
  )
}

export function useIntegrationBrand(providerOrCatalogId: string): ResolvedIntegrationBrand {
  const ctx = useContext(IntegrationBrandContext)
  if (!ctx) {
    return resolveProviderBrand(providerOrCatalogId, null)
  }
  return ctx.getBrand(providerOrCatalogId)
}

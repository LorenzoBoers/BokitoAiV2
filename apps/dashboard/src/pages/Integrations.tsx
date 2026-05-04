import { useMemo, useState } from 'react'
import { Search, Plus, Link2, Clock } from 'lucide-react'
import {
  INTEGRATIONS,
  CATEGORIES,
  type Integration,
  type IntegrationCategory,
  type IntegrationStatus,
} from '../data/integrations-data'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: 'Verbonden',
  available: 'Beschikbaar',
  coming_soon: 'Binnenkort',
}

const STATUS_VARIANT: Record<IntegrationStatus, 'success' | 'info' | 'neutral'> = {
  connected: 'success',
  available: 'info',
  coming_soon: 'neutral',
}

export default function Integrations() {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<IntegrationCategory | 'Alle'>('Alle')
  const [activeFilter, setActiveFilter] = useState<'all' | 'connected' | 'available'>('all')
  const [items, setItems] = useState<Integration[]>(INTEGRATIONS)

  const handleConnect = (id: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, status: 'connected', connectedSince: new Date().toISOString().slice(0, 10) }
          : it,
      ),
    )
  }

  const handleDisconnect = (id: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === id) {
          const updated = { ...it, status: 'available' as const };
          delete (updated as any).connectedSince;
          return updated;
        }
        return it;
      }),
    )
  }

  const filtered = useMemo(() => {
    let list = items
    if (activeCategory !== 'Alle') list = list.filter((i) => i.category === activeCategory)
    if (activeFilter === 'connected') list = list.filter((i) => i.status === 'connected')
    if (activeFilter === 'available') list = list.filter((i) => i.status === 'available')
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q),
      )
    }
    return list
  }, [items, activeCategory, activeFilter, search])

  const connectedCount = items.filter((i) => i.status === 'connected').length

  return (
    <div className="h-full min-h-0 py-4">
      <div className="h-full min-h-0 flex flex-col">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-border/50">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-text-heading">Marketplace</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Koppel tools, beheer status en houd alles compact in één overzicht.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="success">{connectedCount} verbonden</Badge>
            <Badge variant="info">{items.length} totaal</Badge>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex gap-4 overflow-hidden pt-3">
          <div className="w-52 border-r border-border/50 pr-3 overflow-y-auto">
            {(['Alle', ...CATEGORIES] as const).map((cat) => {
              const count = cat === 'Alle' ? items.length : items.filter((i) => i.category === cat).length
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat as IntegrationCategory | 'Alle')}
                  className={`w-full px-2 py-1.5 mb-0.5 rounded-md text-left text-xs transition-colors ${
                    activeCategory === cat
                      ? 'text-accent'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <span>{cat}</span>
                  <span className="ml-1 text-text-muted">({count})</span>
                </button>
              )
            })}
          </div>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 pb-3">
              <div className="relative w-72 max-w-full">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 text-xs"
                  placeholder="Zoek integraties..."
                />
              </div>
              <Tabs value={activeFilter} onValueChange={(v) => setActiveFilter(v as typeof activeFilter)}>
                <TabsList>
                  <TabsTrigger value="all">Alle</TabsTrigger>
                  <TabsTrigger value="connected">Verbonden</TabsTrigger>
                  <TabsTrigger value="available">Beschikbaar</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex-1 min-h-0 overflow-auto border-t border-border/40">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Naam</TableHead>
                    <TableHead>Categorie</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Verbonden sinds</TableHead>
                    <TableHead className="text-right">Actie</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((integration) => (
                    <TableRow key={integration.id}>
                      <TableCell>
                        <div className="font-medium">{integration.name}</div>
                        <div className="text-xs text-text-muted">{integration.description}</div>
                      </TableCell>
                      <TableCell className="text-text-secondary">{integration.category}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[integration.status]}>
                          {integration.status === 'coming_soon' && <Clock size={10} className="mr-1" />}
                          {STATUS_LABEL[integration.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-text-secondary text-xs">
                        {integration.connectedSince ? (
                          <span className="inline-flex items-center gap-1">
                            <Link2 size={12} />
                            {new Date(integration.connectedSince).toLocaleDateString('nl-NL')}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {integration.status === 'connected' ? (
                          <Button size="sm" variant="ghost" onClick={() => handleDisconnect(integration.id)}>
                            Ontkoppelen
                          </Button>
                        ) : integration.status === 'coming_soon' ? (
                          <Button size="sm" variant="secondary" disabled>
                            Binnenkort
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => handleConnect(integration.id)}>
                            <Plus size={12} />
                            Verbinden
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-text-muted">Geen integraties gevonden.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

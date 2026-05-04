import { useMemo, useState } from 'react'
import { Plus, CloudCog, LayoutGrid, List } from 'lucide-react'
import AgentList from '../components/cloud-agent/AgentList'
import AgentCardGrid from '../components/cloud-agent/AgentCardGrid'
import AgentDetailModal from '../components/cloud-agent/AgentDetailModal'
import { cloudAgents } from '../data/mock-data'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'

type ViewMode = 'cards' | 'list'

export default function CloudAgent() {
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [modalAgentId, setModalAgentId] = useState<string | null>(null)

  const modalAgent = useMemo(
    () => (modalAgentId ? cloudAgents.find((a) => a.id === modalAgentId) : null),
    [modalAgentId],
  )

  if (!cloudAgents.length) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Geen cloud agents geconfigureerd.
      </div>
    )
  }

  return (
    <div className="h-full py-4">
      <Card className="h-full min-h-0 flex flex-col">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <CloudCog size={16} className="text-accent" />
              Cloud agents
            </CardTitle>
            <p className="text-xs text-text-secondary mt-0.5">
              Compact beheer van deployment status, model en prestaties.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value="cards">
                  <LayoutGrid size={13} />
                  Kaarten
                </TabsTrigger>
                <TabsTrigger value="list">
                  <List size={13} />
                  Lijst
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button size="sm">
              <Plus size={14} />
              Nieuwe agent
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 overflow-hidden">
          {viewMode === 'list' ? (
            <div className="h-full overflow-hidden">
              <AgentList
                agents={cloudAgents}
                selectedId={modalAgentId ?? ''}
                onSelect={(id) => setModalAgentId(id)}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <AgentCardGrid
                agents={cloudAgents}
                selectedId={modalAgentId ?? ''}
                onSelect={(id) => setModalAgentId(id)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {modalAgent && (
        <AgentDetailModal
          agent={modalAgent}
          onClose={() => setModalAgentId(null)}
        />
      )}
    </div>
  )
}

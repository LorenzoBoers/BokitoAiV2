import { useMemo, useState } from 'react'
import { Plus, CloudCog, LayoutGrid, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import AgentList from '../components/cloud-agent/AgentList'
import AgentCardGrid from '../components/cloud-agent/AgentCardGrid'
import AgentDetailModal from '../components/cloud-agent/AgentDetailModal'
import { cloudAgents } from '../data/mock-data'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { EmptyState } from '../components/ui/empty-state'
import PageContent from '../components/layout/PageContent'

type ViewMode = 'cards' | 'list'

export default function CloudAgent() {
  const { t } = useTranslation('nav')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [modalAgentId, setModalAgentId] = useState<string | null>(null)

  const modalAgent = useMemo(
    () => (modalAgentId ? cloudAgents.find((a) => a.id === modalAgentId) : null),
    [modalAgentId],
  )

  if (!cloudAgents.length) {
    return (
      <PageContent width="lg">
        <EmptyState
          icon={CloudCog}
          title={t('ai.cloudAgent.title')}
          description={t('ai.cloudAgent.empty')}
        />
      </PageContent>
    )
  }

  return (
    <PageContent width="xl" className="h-full">
      <Card className="h-full min-h-0 flex flex-col">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <CloudCog size={16} className="text-accent" />
              {t('ai.cloudAgent.title')}
            </CardTitle>
            <p className="text-xs text-text-secondary mt-0.5">
              {t('ai.cloudAgent.description')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value="cards">
                  <LayoutGrid size={13} />
                  {t('ai.cloudAgent.viewCards')}
                </TabsTrigger>
                <TabsTrigger value="list">
                  <List size={13} />
                  {t('ai.cloudAgent.viewList')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button size="sm">
              <Plus size={14} />
              {t('ai.cloudAgent.newAgent')}
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
    </PageContent>
  )
}

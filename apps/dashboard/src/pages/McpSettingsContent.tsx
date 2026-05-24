import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { McpServerSetupTab } from '../components/mcp/McpServerSetupTab'
import { BokitoMcpConnectTab } from '../components/mcp/BokitoMcpConnectTab'
import PageContent from '../components/layout/PageContent'

export default function McpSettingsContent() {
  const { t } = useTranslation('nav')
  const [activeTab, setActiveTab] = useState('servers')

  return (
    <PageContent width="xl">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="servers">{t('integrations.mcp.tabs.servers')}</TabsTrigger>
          <TabsTrigger value="bokito">{t('integrations.mcp.tabs.bokito')}</TabsTrigger>
        </TabsList>

        <TabsContent value="servers" className="mt-6">
          <McpServerSetupTab />
        </TabsContent>

        <TabsContent value="bokito" className="mt-6">
          <BokitoMcpConnectTab />
        </TabsContent>
      </Tabs>
    </PageContent>
  )
}

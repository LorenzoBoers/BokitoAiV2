import { useTranslation } from 'react-i18next'
import AiCodingToolsBanner from '../integrations/AiCodingToolsBanner'
import RouteTabs from './RouteTabs'

/**
 * Inner tab strip for the Connections hub: workspace inventory and discover.
 * The AI (coding) tools offer sits above the tabs on every hub leaf.
 */
export default function IntegrationsTabs() {
  const { t } = useTranslation('nav')
  return (
    <div className="space-y-4">
      <AiCodingToolsBanner />
      <RouteTabs
        ariaLabel={t('integrations.tabsAria', { defaultValue: 'Connections sections' })}
        tabs={[
          { to: '/connections', end: true, label: t('tabs.modules.title', { defaultValue: 'Connections' }) },
          {
            to: '/connections/marketplace',
            label: t('integrations.pageMeta.marketplace.title', { defaultValue: 'Marketplace' }),
          },
        ]}
      />
    </div>
  )
}

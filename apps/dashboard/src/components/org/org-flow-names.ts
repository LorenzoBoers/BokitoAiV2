import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { OrgFlowNode, OrgFlowWorksIn } from '../../lib/org-flow-api'

/** Display names for Grid nodes the server leaves unnamed (reply, sinks, buckets). */
export function useGridNames() {
  const { t } = useTranslation(['nav', 'communication'])

  const channel = useCallback(
    (kind?: string | null) =>
      kind ? t(`communication:composer.channel.${kind}`, { defaultValue: kind }) : t('nav:orgCanvas.node.channel'),
    [t],
  )

  const node = useCallback(
    (n: Pick<OrgFlowNode, 'kind' | 'label' | 'channel'>) => {
      switch (n.kind) {
        case 'unassigned':
          return t('nav:orgCanvas.node.unassigned')
        case 'reply':
          return t('nav:orgCanvas.result.reply')
        case 'knowledge':
          return t('nav:orgCanvas.result.knowledge')
        case 'sink_open':
          return t('nav:orgCanvas.result.open')
        case 'sink_closed_without_result':
          return t('nav:orgCanvas.result.closedWithout')
        case 'channel':
          return n.label && n.label !== n.channel ? n.label : channel(n.channel)
        default:
          return n.label
      }
    },
    [t, channel],
  )

  const worksIn = useCallback(
    (item: Pick<OrgFlowWorksIn, 'kind' | 'label'>) => {
      const kind = t(`nav:projects.worksIn.kind.${item.kind}`, { defaultValue: item.kind })
      if (!item.label) return kind
      return item.kind === 'canvas' ? `${kind} · ${item.label}` : item.label
    },
    [t],
  )

  return useMemo(() => ({ node, channel, worksIn }), [node, channel, worksIn])
}

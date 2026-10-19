import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSidebarPrefs } from '../context/SidebarPrefsContext'
import type { SidebarSection } from '../lib/communication-sidebar-prefs'

export function useHideSidebarRow() {
  const { t } = useTranslation('nav')
  const { setItemHidden, setSectionHidden } = useSidebarPrefs()

  const hideItem = useCallback(
    (id: string, label: string) => {
      if (!setItemHidden(id, true)) {
        toast(t('support.customize.keepOne'))
        return
      }
      toast(t('support.customize.hidden', { label }), {
        action: {
          label: t('support.customize.undo'),
          onClick: () => setItemHidden(id, false),
        },
      })
    },
    [setItemHidden, t],
  )

  const hideSection = useCallback(
    (section: SidebarSection, label: string) => {
      setSectionHidden(section, true)
      toast(t('support.customize.hidden', { label }), {
        action: {
          label: t('support.customize.undo'),
          onClick: () => setSectionHidden(section, false),
        },
      })
    },
    [setSectionHidden, t],
  )

  return { hideItem, hideSection }
}

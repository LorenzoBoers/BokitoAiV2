import { toast } from 'sonner'
import i18n from '../i18n'
import { openEntityPath } from './open-entity'

/**
 * Success toast after a soft delete, with the one follow-up that always
 * applies: open the Bin to restore. Keeps every delete flow on the same path.
 */
export function toastMovedToBin(message: string, navigate: (to: string) => void) {
  toast.success(message, {
    action: {
      label: i18n.t('binPage.openBin', { ns: 'nav' }),
      onClick: () => navigate(openEntityPath({ type: 'trash_entry' })),
    },
  })
}

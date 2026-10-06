import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

/** Install presets: 7 / 30 / 90 / 365 days. “Everything” stays in advanced channel settings only. */
export const INSTALL_SYNC_WINDOW_OPTIONS = [7, 30, 90, 365] as const
export const DEFAULT_INSTALL_SYNC_WINDOW_DAYS = 30

/** Full set for post-install advanced settings (includes unlimited). */
export const CHANNEL_SYNC_WINDOW_OPTIONS = [7, 30, 90, 365, 0] as const

type Props = {
  value: number
  onChange: (days: number) => void
  disabled?: boolean
  /** When true, include the “everything” option (advanced / existing channel). */
  allowUnlimited?: boolean
  id?: string
}

export default function MailboxSyncWindowField({
  value,
  onChange,
  disabled,
  allowUnlimited = false,
  id = 'mailbox-sync-window',
}: Props) {
  const { t } = useTranslation('nav')
  const options = allowUnlimited ? CHANNEL_SYNC_WINDOW_OPTIONS : INSTALL_SYNC_WINDOW_OPTIONS

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-text-heading">
        {t('channelsPage.installHistory')}
      </label>
      <p className="text-xs leading-snug text-text-secondary">{t('channelsPage.installHistoryHint')}</p>
      <Select value={String(value)} disabled={disabled} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((days) => (
            <SelectItem key={days} value={String(days)}>
              {days === 0
                ? t('channelsPage.everything')
                : days === 365
                  ? t('channelsPage.oneYear')
                  : days === 30
                    ? t('channelsPage.daysRecommended', { count: days })
                    : t('channelsPage.days', { count: days })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

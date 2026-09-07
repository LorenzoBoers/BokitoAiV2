import { useTranslation } from 'react-i18next'

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
      <p className="text-[12px] leading-snug text-text-secondary">{t('channelsPage.installHistoryHint')}</p>
      <select
        id={id}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-border/60 bg-bg-elevated/60 px-3 py-2 text-[12.5px] text-text-primary outline-none transition-colors focus:border-accent/60 disabled:opacity-60"
      >
        {options.map((days) => (
          <option key={days} value={days}>
            {days === 0
              ? t('channelsPage.everything')
              : days === 365
                ? t('channelsPage.oneYear')
                : days === 30
                  ? t('channelsPage.daysRecommended', { count: days })
                  : t('channelsPage.days', { count: days })}
          </option>
        ))}
      </select>
    </div>
  )
}

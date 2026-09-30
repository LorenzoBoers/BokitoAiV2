import { useTranslation } from 'react-i18next'

export function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-full place-items-center bg-bg-root p-6">
      <div className="panel w-full max-w-sm animate-pop-in p-6">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-accent text-sm font-bold text-accent-fg">
            B
          </span>
          <div>
            <div className="text-sm font-semibold text-text-heading">{t('app.name')}</div>
            <div className="text-2xs text-text-muted">{t('app.tagline')}</div>
          </div>
        </div>
        <h1 className="mb-4 text-lg font-semibold text-text-heading">{title}</h1>
        {children}
      </div>
    </div>
  )
}

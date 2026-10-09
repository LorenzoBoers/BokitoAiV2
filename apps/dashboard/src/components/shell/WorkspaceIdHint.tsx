import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { RELEASE_VERSION } from '../../lib/app-version'
import { Tip } from '../ui/Tip'
import ConnectionStatus from './ConnectionStatus'

function environmentLabel(raw: string | undefined): string {
  const env = (raw ?? '').trim().toLowerCase()
  if (env === 'prod' || env === 'production') return 'prod'
  if (env === 'staging' || env === 'acceptatie' || env === 'acceptance') return 'staging'
  if (env === 'dev' || env === 'development' || env === 'local') return 'dev'
  return env
}

const QUIET = 'font-mono text-2xs leading-none text-text-muted/70'
const DOT = (
  <span className="text-text-muted/40" aria-hidden>
    ·
  </span>
)

/** Quiet `environment · tenant-slug · websocket · version` line. */
export default function WorkspaceIdHint({
  liveMarker = 'dot',
}: {
  liveMarker?: 'dot' | 'check'
}) {
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const env = environmentLabel(user?.environment)
  const slug = (user?.tenant?.slug ?? '').trim()
  const slugOk = Boolean(slug && slug.toLowerCase() !== 'unknown')
  const release = RELEASE_VERSION
  const copyValue = [env, slugOk ? slug : '', release].filter(Boolean).join(' · ')

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-testid="workspace-id-hint">
      {env ? (
        <Tip label={t('cockpitPage.environmentHint')}>
          <span className={QUIET}>{env}</span>
        </Tip>
      ) : null}
      {env && slugOk ? DOT : null}
      {slugOk ? (
        <Tip label={t('cockpitPage.workspaceIdHint')}>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(copyValue).then(
                () => toast.success(t('cockpitPage.workspaceIdCopied')),
                () => toast.error(t('cockpitPage.workspaceIdCopyFailed')),
              )
            }}
            className={`max-w-[12rem] truncate hover:text-text-muted ${QUIET}`}
            aria-label={t('cockpitPage.workspaceIdHint')}
          >
            {slug}
          </button>
        </Tip>
      ) : null}
      {(env || slugOk) ? DOT : null}
      <ConnectionStatus marker={liveMarker} className={`gap-1 ${QUIET} hover:text-text-muted`} />
      {release ? (
        <>
          {DOT}
          <Tip label={t('cockpitPage.dashboardBuild')}>
            <span className={QUIET}>{release}</span>
          </Tip>
        </>
      ) : null}
    </span>
  )
}

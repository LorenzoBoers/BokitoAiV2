import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from './useIsAdmin'
import { useConfirm, type ConfirmFn } from '../components/ui/confirm-dialog'
import { minMode, type AiHandling, type AiHandlingMode, type AiHandlingScope } from '../lib/ai-handling'
import { getAiHandling, previewAiHandling, setAiHandling } from '../lib/ai-handling-api'

/**
 * Before raising a channel, contact or the workspace to autonomous, show how
 * many open conversations follow it and how drafts fared. Conversation scope
 * skips this: it only affects one thread and ends when it closes.
 */
export async function confirmAutonomousRaise(
  token: string,
  scope: AiHandlingScope,
  targetId: string,
  t: TFunction,
  confirm: ConfirmFn,
): Promise<boolean> {
  if (scope === 'conversation') return true
  const lines: string[] = []
  try {
    const preview = await previewAiHandling(token, scope, targetId, 'autonomous')
    lines.push(t('aiHandling.preview.followers', { count: preview.followers }))
    const { evidence } = preview
    lines.push(
      evidence.uneditedRate != null && evidence.draftsResolved > 0
        ? t('aiHandling.preview.evidence', {
            rate: Math.round(evidence.uneditedRate * 100),
            count: evidence.draftsResolved,
            days: evidence.days,
          })
        : t('aiHandling.preview.noEvidence', { days: evidence.days }),
    )
  } catch {
    // Preview is advisory; still ask before raising.
  }
  return confirm({
    title: t('aiHandling.preview.confirm'),
    description: lines.join('\n\n'),
    confirmLabel: t('aiHandling.modes.autonomous.label'),
  })
}

type Options = {
  /** Seed from a payload the page already has (thread detail, contact row). */
  initial?: AiHandling | null
  /** Skip the GET when ``initial`` is authoritative. */
  skipFetch?: boolean
  /** Called with the resolved payload after a successful change. */
  onChanged?: (next: AiHandling | null) => void
}

/**
 * Read and change AI handling for one target. Changes are applied
 * optimistically and rolled back on error; a toast confirms the result.
 */
export function useAiHandling(
  scope: AiHandlingScope,
  targetId: string | null | undefined,
  { initial = null, skipFetch = false, onChanged }: Options = {},
) {
  const { t } = useTranslation('common')
  const { token } = useAuth()
  const confirm = useConfirm()
  const canRaise = useIsAdmin()
  const [handling, setHandling] = useState<AiHandling | null>(initial)
  const [saving, setSaving] = useState(false)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  useEffect(() => {
    if (initial) setHandling(initial)
  }, [initial])

  const refresh = useCallback(async () => {
    if (!token || !targetId) return
    try {
      setHandling(await getAiHandling(token, scope, targetId))
    } catch {
      // Keep the last known value; the picker stays usable.
    }
  }, [token, scope, targetId])

  useEffect(() => {
    if (skipFetch) return
    void refresh()
  }, [refresh, skipFetch])

  const change = useCallback(
    async (mode: AiHandlingMode | null, opts: { assignToMe?: boolean; reason?: string } = {}) => {
      if (!token || !targetId) return null
      if (mode === 'autonomous' && handling?.effective !== 'autonomous') {
        if (!(await confirmAutonomousRaise(token, scope, targetId, t, confirm))) return null
      }
      const previous = handling
      if (previous && mode) {
        setHandling({
          ...previous,
          own: mode,
          requested: mode,
          effective: minMode(mode, previous.ceiling),
        })
      }
      setSaving(true)
      try {
        const next = await setAiHandling(token, scope, targetId, mode, opts)
        setHandling(next)
        onChangedRef.current?.(next)
        if (next) {
          toast.success(
            mode
              ? t('aiHandling.changed', { mode: t(`aiHandling.modes.${next.effective}.label`) })
              : t('aiHandling.cleared', { source: t(`aiHandling.sources.${next.source}`) }),
          )
        }
        return next
      } catch (err) {
        setHandling(previous)
        toast.error(err instanceof Error ? err.message : t('aiHandling.saveError'))
        return null
      } finally {
        setSaving(false)
      }
    },
    [token, scope, targetId, handling, t, confirm],
  )

  return { handling, setHandling, change, saving, canRaise, refresh }
}

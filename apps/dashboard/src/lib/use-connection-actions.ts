import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  renameConnection,
  revokeIntegrationConnection,
  verifyConnection,
  type ConnectionVerifyResult,
  type ProviderConnectionRow,
} from './integrations-api'
import {
  disconnectModuleConnection,
  renameModuleConnection,
  verifyModuleConnection,
} from './module-api'
import { useConfirm } from '../components/ui/confirm-dialog'

/** Module rows go through the module endpoints; provider rows through the connection endpoints. */
export type ConnectionActionScope = { module: string } | { provider: string }

type Row = Pick<ProviderConnectionRow, 'id' | 'display_name'>

/**
 * Verify, rename and disconnect with one confirm and error path for every
 * connection list. ``onChanged`` reloads the caller's rows.
 */
export function useConnectionActions(scope: ConnectionActionScope, onChanged: () => Promise<void> | void) {
  const { t } = useTranslation('nav')
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const moduleSlug = 'module' in scope ? scope.module : null

  const run = useCallback(
    async <T,>(row: Row, action: () => Promise<T>): Promise<T | undefined> => {
      setBusyId(row.id)
      setError(null)
      setNotice(null)
      try {
        const result = await action()
        await onChanged()
        return result
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return undefined
      } finally {
        setBusyId(null)
      }
    },
    [onChanged],
  )

  const verify = useCallback(
    async (row: Row) => {
      const result = await run<ConnectionVerifyResult>(row, () =>
        moduleSlug ? verifyModuleConnection(moduleSlug, row.id) : verifyConnection(row.id),
      )
      if (!result) return
      if (!result.ok) {
        setError(result.error || t('integrations.connections.verifyFailed'))
      } else if (result.merged_into) {
        setNotice(t('integrations.connections.reused'))
      }
    },
    [moduleSlug, run, t],
  )

  const rename = useCallback(
    async (row: Row, name: string) => {
      const next = name.trim()
      if (!next || next === row.display_name) return
      await run(row, async () => {
        if (moduleSlug) await renameModuleConnection(moduleSlug, row.id, next)
        else await renameConnection(row.id, next)
      })
    },
    [moduleSlug, run],
  )

  const disconnect = useCallback(
    async (row: Row) => {
      if (!(await confirm({ description: t('integrations.connections.disconnectConfirm'), confirmLabel: t('actions.remove', { ns: 'common' }), destructive: true })))
        return
      await run(row, () =>
        moduleSlug ? disconnectModuleConnection(moduleSlug, row.id) : revokeIntegrationConnection(row.id),
      )
    },
    [confirm, moduleSlug, run, t],
  )

  return { busyId, error, setError, notice, run, verify, rename, disconnect }
}

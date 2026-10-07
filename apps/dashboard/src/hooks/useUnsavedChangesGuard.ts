import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../components/ui/confirm-dialog'

/** Warn on tab close and in-app navigation when a form is dirty. */
export function useUnsavedChangesGuard(dirty: boolean, message: string) {
  const blocker = useBlocker(dirty)
  const confirm = useConfirm()
  const { t } = useTranslation('common')

  useEffect(() => {
    if (!dirty) return
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = message
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty, message])

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let active = true
    void confirm({ description: message, confirmLabel: t('actions.continue') }).then((ok) => {
      if (!active) return
      if (ok) blocker.proceed()
      else blocker.reset()
    })
    return () => {
      active = false
    }
  }, [blocker, message, confirm, t])
}

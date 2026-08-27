import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

/** Warn on tab close and in-app navigation when a form is dirty. */
export function useUnsavedChangesGuard(dirty: boolean, message: string) {
  const blocker = useBlocker(dirty)

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
    const ok = window.confirm(message)
    if (ok) blocker.proceed()
    else blocker.reset()
  }, [blocker, message])
}

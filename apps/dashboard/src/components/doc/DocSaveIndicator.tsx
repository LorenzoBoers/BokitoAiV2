import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { DocEditorSaveStatus } from './BlockEditor'

interface DocSaveIndicatorProps {
  status: DocEditorSaveStatus
  className?: string
}

export function DocSaveIndicator({ status, className }: DocSaveIndicatorProps) {
  const { t } = useTranslation('nav')
  const [showSavedFlash, setShowSavedFlash] = useState(false)

  useEffect(() => {
    if (status.phase !== 'saved' || !status.lastSavedAt) return
    setShowSavedFlash(true)
    const timer = window.setTimeout(() => setShowSavedFlash(false), 2200)
    return () => window.clearTimeout(timer)
  }, [status.phase, status.lastSavedAt])

  if (status.phase === 'error' && status.errorMessage) {
    return (
      <p className={cn('text-xs text-status-error', className)} role="status">
        {status.errorMessage}
      </p>
    )
  }

  if (showSavedFlash) {
    return (
      <p className={cn('text-xs text-status-success transition-opacity', className)} role="status">
        {t('project.doc.editor.savedShort')}
      </p>
    )
  }

  if (status.lastEditedAt) {
    return (
      <p className={cn('text-xs text-text-muted tabular-nums', className)} role="status">
        {t('project.doc.editor.lastEdited', {
          time: status.lastEditedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })}
      </p>
    )
  }

  return null
}

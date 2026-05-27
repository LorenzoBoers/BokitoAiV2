import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Undo2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { applyBlockOps, listBlockRevisions, type DocBlockRevisionRow } from '../../lib/doc-api'
import { applyWorkspaceBlockOps, listWorkspaceBlockRevisions } from '../../lib/workspace-doc-api'
import { renderInlineText } from '../../lib/doc-blocks'

interface RevisionPanelProps {
  projectId?: string
  pageId: string
  docScope?: 'project' | 'workspace'
  refreshKey: number
  onReverted: () => void
  /** When `embedded`, render without outer card chrome (used inside a Dialog). */
  variant?: 'card' | 'embedded'
}

function previewText(rev: DocBlockRevisionRow): string {
  const block = rev.after ?? rev.before
  if (!block) return ''
  const prefix = `[${block.type}]`
  const body = renderInlineText(block.text)
  return body ? `${prefix} ${body.slice(0, 80)}` : prefix
}

export function RevisionPanel({
  projectId,
  pageId,
  refreshKey,
  onReverted,
  variant = 'card',
}: RevisionPanelProps) {
  const { t } = useTranslation('nav')
  const [revs, setRevs] = useState<DocBlockRevisionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [reverting, setReverting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if ((docScope === 'project' && !projectId) || !pageId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const loadRevs =
      docScope === 'workspace'
        ? listWorkspaceBlockRevisions(pageId)
        : listBlockRevisions(projectId!, pageId)
    loadRevs
      .then((rows) => {
        if (cancelled) return
        setRevs(rows)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('project.doc.historyLoadError'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [docScope, projectId, pageId, refreshKey, t])

  const applyOps = (ops: Parameters<typeof applyBlockOps>[2]) =>
    docScope === 'workspace'
      ? applyWorkspaceBlockOps(pageId, ops)
      : applyBlockOps(projectId!, pageId, ops)

  const onRevert = async (rev: DocBlockRevisionRow) => {
    setReverting(rev.id)
    try {
      if (rev.op === 'create') {
        await applyOps([{ op: 'delete', id: rev.block_id }])
      } else if (rev.op === 'delete' && rev.before) {
        const b = rev.before
        await applyOps([
          {
            op: 'create',
            id: b.id,
            parent_block_id: b.parent_block_id ?? null,
            type: b.type,
            text: b.text ?? [],
            props: b.props ?? {},
            position: b.position,
          },
        ])
      } else if (rev.op === 'update' && rev.before) {
        const b = rev.before
        await applyOps([
          {
            op: 'update',
            id: b.id,
            type: b.type,
            text: b.text ?? [],
            props: b.props ?? {},
          },
        ])
      } else if (rev.op === 'move' && rev.before) {
        const b = rev.before
        await applyOps([
          {
            op: 'move',
            id: b.id,
            parent_block_id: b.parent_block_id ?? null,
            position: b.position,
          },
        ])
      }
      onReverted()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.doc.revertFailed'))
    } finally {
      setReverting(null)
    }
  }

  const wrapperClass =
    variant === 'card'
      ? 'rounded-2xl border border-border/80 bg-bg-surface/95 p-4 text-sm'
      : 'text-sm'

  return (
    <div className={wrapperClass}>
      {loading ? (
        <p className="text-text-muted">{t('project.doc.loading')}</p>
      ) : error ? (
        <p className="text-status-error">{error}</p>
      ) : revs.length === 0 ? (
        <p className="text-text-muted">{t('project.doc.historyEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {revs.map((rev) => (
            <li
              key={rev.id}
              className="rounded-md border border-border/40 bg-bg-elevated p-2"
            >
              <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                <span>
                  <span
                    className={cn(
                      'mr-1 inline-block rounded px-1 py-0.5 text-[10px] font-semibold uppercase',
                      rev.actor_type === 'agent'
                        ? 'bg-accent/15 text-accent'
                        : 'bg-bg-hover text-text-secondary',
                    )}
                  >
                    {rev.actor_type}
                  </span>
                  <span className="font-medium text-text-primary">{rev.actor_label}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onRevert(rev)}
                  disabled={reverting === rev.id}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                  aria-label={t('project.doc.revert')}
                >
                  <Undo2 size={12} />
                  <span>{reverting === rev.id ? '…' : t('project.doc.revert')}</span>
                </button>
              </div>
              <p className="mt-1 truncate text-xs text-text-secondary">
                <span className="font-mono uppercase opacity-60">{rev.op}</span>{' '}
                <span>{previewText(rev)}</span>
              </p>
              {rev.change_note ? (
                <p className="mt-0.5 text-[11px] italic text-text-muted">{rev.change_note}</p>
              ) : null}
              <p className="mt-0.5 text-[10px] text-text-muted">
                {new Date(rev.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

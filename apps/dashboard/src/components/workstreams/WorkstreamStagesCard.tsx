import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import type { TicketStage, TicketStageKind } from '../../lib/cases-api'
import { patchWorkstream, type WorkstreamRow } from '../../lib/workstreams-api'

const KINDS: TicketStageKind[] = ['open', 'waiting', 'done']

const selectClass =
  'h-8 rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs text-text-primary'

export function WorkstreamStagesCard({
  workstreamId,
  stages,
  canEdit,
  onSaved,
}: {
  workstreamId: string
  stages: TicketStage[]
  canEdit: boolean
  onSaved: (row: WorkstreamRow) => void
}) {
  const { t } = useTranslation('nav')
  const [draft, setDraft] = useState<TicketStage[]>(stages)
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(stages), [stages])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(stages), [draft, stages])
  const valid = draft.length > 0 && draft.every((s) => s.name.trim()) && draft.some((s) => s.kind === 'done')

  const update = (index: number, patch: Partial<TicketStage>) =>
    setDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const move = (index: number, delta: -1 | 1) =>
    setDraft((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })

  const save = async () => {
    setSaving(true)
    try {
      const row = await patchWorkstream(workstreamId, {
        stages: draft.map((s) => ({ ...s, name: s.name.trim() })),
      })
      onSaved(row)
      toast.success(t('workstreamsPage.stages.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.stages.saveError')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t('workstreamsPage.stages.title')}</CardTitle>
        {canEdit ? (
          <Button type="button" size="sm" disabled={!dirty || !valid || saving} onClick={() => void save()}>
            {saving ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
            {t('workstreamsPage.save')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-text-muted">{t('workstreamsPage.stages.hint')}</p>
        {draft.map((stage, index) => (
          <div key={stage.key || `new-${index}`} className="flex items-center gap-1.5">
            <Input
              value={stage.name}
              disabled={!canEdit}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder={t('workstreamsPage.stages.namePlaceholder')}
              className="h-8 min-w-0 flex-1 text-xs"
            />
            <select
              value={stage.kind}
              disabled={!canEdit}
              onChange={(e) => update(index, { kind: e.target.value as TicketStageKind })}
              className={selectClass}
              aria-label={t('workstreamsPage.stages.kind')}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`workstreamsPage.stages.kinds.${kind}`)}
                </option>
              ))}
            </select>
            {canEdit ? (
              <span className="flex items-center">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={index === 0}
                  aria-label={t('workstreamsPage.moveUp')}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={13} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={index === draft.length - 1}
                  aria-label={t('workstreamsPage.moveDown')}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={13} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-status-error"
                  disabled={draft.length === 1}
                  aria-label={t('workstreamsPage.stages.remove')}
                  onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 size={13} />
                </Button>
              </span>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDraft((prev) => [...prev, { key: '', name: '', kind: 'open' }])}
            >
              <Plus size={13} className="mr-1" />
              {t('workstreamsPage.stages.add')}
            </Button>
            {!draft.some((s) => s.kind === 'done') ? (
              <span className="text-xs text-status-error">{t('workstreamsPage.stages.needDone')}</span>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

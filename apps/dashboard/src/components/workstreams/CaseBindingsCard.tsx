import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  createCaseBinding,
  deleteCaseBinding,
  listCaseBindings,
  listCaseTypes,
  type CaseBindingRow,
  type CaseTypeRow,
} from '../../lib/cases-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'

type Props = {
  targetKind: 'workstream' | 'project'
  targetId: string
  canEdit?: boolean
}

export function CaseBindingsCard({ targetKind, targetId, canEdit = false }: Props) {
  const { t } = useTranslation('nav')
  const [types, setTypes] = useState<CaseTypeRow[]>([])
  const [bindings, setBindings] = useState<CaseBindingRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [typeRows, bindRows] = await Promise.all([
      listCaseTypes(),
      listCaseBindings({ targetKind, targetId }),
    ])
    setTypes(typeRows.filter((row) => row.enabled))
    setBindings(bindRows)
  }, [targetId, targetKind])

  useEffect(() => {
    void load().catch(() => {
      setTypes([])
      setBindings([])
    })
  }, [load])

  const bound = new Map(bindings.map((row) => [row.case_type_id, row]))

  const toggle = async (type: CaseTypeRow, on: boolean) => {
    setBusyId(type.id)
    try {
      const existing = bound.get(type.id)
      if (on && !existing) {
        await createCaseBinding({
          case_type_id: type.id,
          target_kind: targetKind,
          target_id: targetId,
          auto_link: true,
          auto_start_run: targetKind === 'workstream',
        })
      } else if (!on && existing) {
        await deleteCaseBinding(existing.id)
      }
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('cases.bindError', { defaultValue: 'Could not update the binding.' })))
    } finally {
      setBusyId(null)
    }
  }

  const setAutoStart = async (binding: CaseBindingRow, autoStart: boolean) => {
    await deleteCaseBinding(binding.id)
    await createCaseBinding({
      case_type_id: binding.case_type_id,
      target_kind: binding.target_kind,
      target_id: binding.target_id,
      auto_link: binding.auto_link,
      auto_start_run: autoStart,
      priority: binding.priority,
    })
    await load()
  }

  if (types.length === 0) return null

  return (
    <div className="space-y-2">
      <Label className="text-xs text-text-muted">
        {t('cases.bindingsTitle', { defaultValue: 'Accepted intake types' })}
      </Label>
      <ul className="space-y-1.5">
        {types.map((type) => {
          const binding = bound.get(type.id)
          return (
            <li key={type.id} className="rounded-lg border border-border/50 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-text-heading">{type.name}</span>
                <Switch
                  checked={Boolean(binding)}
                  disabled={!canEdit || busyId === type.id}
                  onCheckedChange={(v) => void toggle(type, v)}
                />
              </div>
              {binding && targetKind === 'workstream' && canEdit ? (
                <label className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                  {t('cases.autoStart', { defaultValue: 'Start a run when linked' })}
                  <Switch
                    checked={binding.auto_start_run}
                    onCheckedChange={(v) => void setAutoStart(binding, v)}
                  />
                </label>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

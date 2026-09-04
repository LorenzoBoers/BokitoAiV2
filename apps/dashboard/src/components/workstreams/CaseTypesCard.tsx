import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  createCaseType,
  listCaseTypes,
  patchCaseType,
  type CaseTypeRow,
} from '../../lib/cases-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'

export function CaseTypesCard() {
  const { t } = useTranslation('nav')
  const [rows, setRows] = useState<CaseTypeRow[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setRows(await listCaseTypes())
  }, [])

  useEffect(() => {
    void load().catch(() => setRows([]))
  }, [load])

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await createCaseType({ name: trimmed })
      setName('')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('cases.createTypeError', { defaultValue: 'Could not create the type.' })))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (row: CaseTypeRow, enabled: boolean) => {
    try {
      await patchCaseType(row.id, { enabled })
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('cases.updateTypeError', { defaultValue: 'Could not update the type.' })))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t('cases.typesTitle', { defaultValue: 'Intake types' })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-text-muted">
          {t('cases.typesHint', {
            defaultValue:
              'Types label work that lands on a conversation. Bind them on a workstream or project so agents know where to send them.',
          })}
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('cases.newTypePlaceholder', { defaultValue: 'New type name' })}
            className="h-9 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
          />
          <Button type="button" size="sm" disabled={busy || !name.trim()} onClick={() => void create()}>
            {t('cases.createType', { defaultValue: 'Add type' })}
          </Button>
        </div>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text-heading">{row.name}</span>
                <span className="block truncate text-[11px] text-text-muted">
                  {row.create_mode}
                  {row.requires_verification
                    ? ` · ${t('cases.needsVerify', { defaultValue: 'needs confirmation' })}`
                    : ''}
                </span>
              </span>
              <Switch checked={row.enabled} onCheckedChange={(v) => void toggle(row, v)} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

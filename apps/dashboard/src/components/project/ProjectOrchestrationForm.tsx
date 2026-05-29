import { useTranslation } from 'react-i18next'
import { Label } from '../ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Switch } from '../ui/switch'
import type {
  AutonomyMode,
  HitlSensitivity,
  ProjectOrchestrationConfig,
  WakeCadence,
} from '../../lib/project-orchestration-api'

type OrchestrationPatch = Partial<
  Pick<
    ProjectOrchestrationConfig,
    'wake_cadence' | 'autonomy_mode' | 'hitl_sensitivity' | 'continuous_enabled'
  >
>

type ProjectOrchestrationFormProps = {
  config: ProjectOrchestrationConfig
  saving?: boolean
  onSave: (patch: OrchestrationPatch) => void | Promise<void>
}

export function ProjectOrchestrationForm({ config, saving, onSave }: ProjectOrchestrationFormProps) {
  const { t } = useTranslation('nav')

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>{t('project.orchestration.wakeFrequency.label')}</Label>
        <p className="text-xs text-text-muted">{t('project.orchestration.wakeFrequency.hint')}</p>
        <Select
          value={config.wake_cadence}
          disabled={saving}
          onValueChange={(v) => void onSave({ wake_cadence: v as WakeCadence })}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hourly">
              {t('project.orchestration.wakeFrequency.options.hourly')}
            </SelectItem>
            <SelectItem value="daily">
              {t('project.orchestration.wakeFrequency.options.daily')}
            </SelectItem>
            <SelectItem value="weekly">
              {t('project.orchestration.wakeFrequency.options.weekly')}
            </SelectItem>
            <SelectItem value="manual">
              {t('project.orchestration.wakeFrequency.options.manual')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t('project.orchestration.autonomyMode.label')}</Label>
        <p className="text-xs text-text-muted">{t('project.orchestration.autonomyMode.hint')}</p>
        <Select
          value={config.autonomy_mode}
          disabled={saving}
          onValueChange={(v) => void onSave({ autonomy_mode: v as AutonomyMode })}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="conservative">
              {t('project.orchestration.autonomyMode.options.conservative')}
            </SelectItem>
            <SelectItem value="balanced">
              {t('project.orchestration.autonomyMode.options.balanced')}
            </SelectItem>
            <SelectItem value="aggressive">
              {t('project.orchestration.autonomyMode.options.aggressive')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t('project.orchestration.hitl.label')}</Label>
        <p className="text-xs text-text-muted">{t('project.orchestration.hitl.hint')}</p>
        <Select
          value={config.hitl_sensitivity}
          disabled={saving}
          onValueChange={(v) => void onSave({ hitl_sensitivity: v as HitlSensitivity })}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">{t('project.orchestration.hitl.options.low')}</SelectItem>
            <SelectItem value="medium">{t('project.orchestration.hitl.options.medium')}</SelectItem>
            <SelectItem value="high">{t('project.orchestration.hitl.options.high')}</SelectItem>
            <SelectItem value="all">{t('project.orchestration.hitl.options.all')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-3">
        <div>
          <p className="text-sm font-medium text-text-primary">
            {t('project.orchestration.continuous.label')}
          </p>
          <p className="text-xs text-text-muted">{t('project.orchestration.continuous.hint')}</p>
        </div>
        <Switch
          checked={config.continuous_enabled}
          disabled={saving}
          onCheckedChange={(checked) => void onSave({ continuous_enabled: checked })}
        />
      </div>
    </div>
  )
}

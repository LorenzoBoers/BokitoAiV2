import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { departmentPath } from '../../lib/navigation'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import { hireModuleAgent, type IntegrationModuleRow } from '../../lib/integrations-api'

/** Who uses the module's tools: the agents in its department and the departments below it. */
export function ModuleDepartmentSection({
  module,
  onChanged,
}: {
  module: IntegrationModuleRow
  onChanged?: () => void
}) {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const [hiring, setHiring] = useState(false)
  const specialistId = module.specialist_agent_id ?? null

  const hire = async () => {
    setHiring(true)
    try {
      const result = await hireModuleAgent(module.slug, true)
      onChanged?.()
      if (result.path) navigate(result.path)
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('integrations.modules.agents.hireError', { defaultValue: 'Could not hire the module specialist.' })),
      )
    } finally {
      setHiring(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        {module.department_name
          ? t('integrations.modules.department.hint', {
              name: module.department_name,
              defaultValue: 'Agents in {{name}} and the departments below it use these tools.',
            })
          : t('integrations.modules.department.hintNone', {
              defaultValue: 'Add the module to a department; its agents then use these tools.',
            })}
      </p>
      {module.default_agent_name ? (
        <p className="text-xs text-text-secondary">
          {t('integrations.modules.department.contact', {
            name: module.default_agent_name,
            defaultValue: 'Point of contact: {{name}}',
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {module.department_id ? (
          <Button asChild size="sm" variant="secondary">
            <Link to={departmentPath(module.department_id)}>
              {t('integrations.modules.department.open', { defaultValue: 'Open department' })}
            </Link>
          </Button>
        ) : null}
        {specialistId ? (
          <Button asChild size="sm" variant="ghost">
            <Link
              to={talkToAssistantPath(
                t('integrations.modules.agents.setupChatPrompt', { defaultValue: 'Help me finish setup for this module.' }),
                specialistId,
              )}
            >
              {t('integrations.modules.agents.openSetup', { defaultValue: 'Open setup chat' })}
            </Link>
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={hiring} onClick={() => void hire()}>
            {hiring ? <Spinner size="sm" /> : t('integrations.modules.agents.hire', { defaultValue: 'Hire specialist' })}
          </Button>
        )}
      </div>
    </div>
  )
}

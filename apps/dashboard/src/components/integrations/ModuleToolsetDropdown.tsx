import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Button } from '../ui/button'
import { ModuleToolsetPanel } from './ModuleToolsetPanel'
import type { IntegrationModuleRow } from '../../lib/integrations-api'

type Props = {
  module: Pick<
    IntegrationModuleRow,
    'slug' | 'tool_cards' | 'verbs' | 'propose_verbs' | 'verb_labels'
  >
}

/** Compact peek at the module toolset; full showcase lives in ModuleToolsetPanel. */
export function ModuleToolsetDropdown({ module }: Props) {
  const { t } = useTranslation('nav')
  const hasTools =
    (module.tool_cards?.length ?? 0) > 0 ||
    (module.verb_labels?.length ?? 0) > 0 ||
    (module.verbs?.length ?? 0) > 0
  if (!hasTools) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          {t('integrations.modules.toolset', { defaultValue: 'AI toolset' })}
          <ChevronDown size={14} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-80 overflow-y-auto p-2">
        <DropdownMenuLabel>
          {t('integrations.modules.toolsetTitle', {
            defaultValue: 'Actions this module can perform',
          })}
        </DropdownMenuLabel>
        <ModuleToolsetPanel module={module} compact className="mt-1" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

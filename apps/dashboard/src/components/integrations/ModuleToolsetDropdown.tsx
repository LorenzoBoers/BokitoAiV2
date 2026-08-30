import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Button } from '../ui/button'
import { verbLabelKey } from '../../lib/integration-modules'

type Props = {
  moduleSlug: string
  verbLabels: string[]
  verbs?: string[]
  proposeVerbs?: string[]
  capability?: string
}

/** Showcase the uniform AI toolset (read verbs + propose verbs) for a module. */
export function ModuleToolsetDropdown({
  moduleSlug,
  verbLabels,
  verbs = [],
  proposeVerbs = [],
  capability,
}: Props) {
  const { t } = useTranslation('nav')
  if (verbLabels.length === 0 && verbs.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          {t('integrations.modules.toolset', { defaultValue: 'AI toolset' })}
          <ChevronDown size={14} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>
          {t('integrations.modules.toolsetTitle', {
            defaultValue: 'Actions this module can perform',
          })}
        </DropdownMenuLabel>
        {capability ? (
          <p className="px-2 pb-2 text-xs text-text-muted">{capability}</p>
        ) : null}
        <DropdownMenuSeparator />
        {verbLabels.map((label, index) => (
          <DropdownMenuItem key={label} className="flex flex-col items-start gap-0.5" disabled>
            <span className="text-sm text-text-heading">
              {t(`integrations.modules.verbs.${verbLabelKey(label)}`, { defaultValue: label })}
            </span>
            {verbs[index] ? (
              <span className="font-mono text-[10px] text-text-muted">
                {moduleSlug}_{verbs[index]}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
        {proposeVerbs.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {t('integrations.modules.proposeToolset', {
                defaultValue: 'Writes (as decisions)',
              })}
            </DropdownMenuLabel>
            {proposeVerbs.map((verb) => (
              <DropdownMenuItem key={verb} className="font-mono text-[11px]" disabled>
                {verb}
              </DropdownMenuItem>
            ))}
            <p className="px-2 pb-1.5 pt-1 text-[11px] text-text-muted">
              {t('integrations.modules.applyNote', {
                defaultValue:
                  'Proposals land as decisions. Approval applies the write only when the workspace write switch is on.',
              })}
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

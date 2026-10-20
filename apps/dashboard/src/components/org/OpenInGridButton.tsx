import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GRID_ICON } from '../../lib/navigation'
import { orgGridPath, type OrgGridKind } from '../../lib/org-grid'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Tip } from '../ui/Tip'

type Props = {
  /** Focus this org-map node after navigate (same as a legend click). */
  kind?: OrgGridKind
  id?: string
  /** Already-formed node id (`agent:…`). Overrides kind/id when set. */
  nodeId?: string | null
  className?: string
  /** Icon-only control for dense headers. */
  iconOnly?: boolean
}

/**
 * Consistent "Open in Grid" entry: the rail Grid mark + optional focus.
 * Opens the Grid and, when a node is given, finds it like the legend.
 */
export function OpenInGridButton({ kind, id, nodeId, className, iconOnly = false }: Props) {
  const { t } = useTranslation('nav')
  const label = t('orgCanvas.openInGrid')
  const focus =
    nodeId?.trim() ||
    (kind && id?.trim() ? { kind, id: id.trim() } : null)
  const to = orgGridPath(focus)

  const button = (
    <Button
      type="button"
      size={iconOnly ? 'icon' : 'sm'}
      variant="outline"
      className={cn(iconOnly ? 'h-8 w-8 shrink-0 text-text-muted' : 'shrink-0', className)}
      asChild
    >
      <Link to={to} aria-label={label} data-testid="open-in-grid">
        <GRID_ICON size={14} aria-hidden />
        {iconOnly ? null : <span>{label}</span>}
      </Link>
    </Button>
  )

  return iconOnly ? (
    <Tip label={label} side="bottom">
      {button}
    </Tip>
  ) : (
    button
  )
}

export default OpenInGridButton

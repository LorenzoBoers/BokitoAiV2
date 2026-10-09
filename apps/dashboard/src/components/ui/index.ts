/**
 * The dashboard catalog. Import from here; add new primitives here only.
 * Families: surfaces, controls, feedback, data, identity.
 * Guide: apps/dashboard/docs/DESIGN_SYSTEM.md
 */

// Surfaces
export { Card, CardHeader, CardHeaderActions, CardTitle, CardDescription, CardContent } from './card'
export { InsetPanel } from './inset-panel'
export { SectionHeading } from './section-heading'
export { SettingsSection } from '../layout/SettingsSection'

// Controls
export { Button, buttonVariants } from './button'
export { TextLink } from './text-link'
export { OptionCard, OptionCardGrid } from './option-card'
export { SegmentedControl, type SegmentedOption } from './segmented-control'
export { FilterChip, FilterChipRow } from './filter-chip'
export { SearchField } from './search-field'
export { Input } from './input'
export { Textarea } from './textarea'
export { Switch } from './switch'
export { Label } from './label'
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select'
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'

// Feedback
export { Callout, type CalloutTone } from './callout'
export { ConfirmDialog, ConfirmProvider, useConfirm, type ConfirmOptions } from './confirm-dialog'
export { EmptyState } from './empty-state'
export { Spinner } from './spinner'
export { LoadingBlock } from './loading-block'
export { ApiErrorBanner, formatApiErrorMessage } from './ApiErrorBanner'

// Data
export { Badge, badgeVariants, type BadgeTone } from './badge'
export { MetaLine } from './meta-line'
export { EntityRow, EntityList, DescriptionRow } from './entity-row'
export { StatTile, StatGrid } from './stat-tile'
export { Chart, type ChartKind, type ChartPoint, type ChartSeries } from './chart'
export { CapBar } from './cap-bar'
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table'

// Identity
export { IconTile, type IconTileTone } from './icon-tile'

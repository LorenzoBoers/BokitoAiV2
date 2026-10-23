/**
 * The dashboard catalog. Import from here; add new primitives here only.
 * Families: surfaces, controls, feedback, data, identity.
 * Guide: apps/dashboard/docs/DESIGN_SYSTEM.md
 */

// Surfaces
export { Card, CardHeader, CardHeaderActions, CardTitle, CardDescription, CardContent } from './card'
export { InsetPanel } from './inset-panel'
export { SectionHeading } from './section-heading'
export { SectionLabel } from './section-label'
export { SettingsSection } from '../layout/SettingsSection'

// Recipes
export { PageHeader } from './page-header'
export { PageContent } from '../layout/PageContent'
export { DangerZone, DangerZoneRow } from '../layout/DangerZone'
export { AuthShell } from '../auth/AuthShell'

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
  controlChipClass,
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
export {
  SidePanel,
  SidePanelBody,
  SidePanelClose,
  SidePanelContent,
  SidePanelDescription,
  SidePanelHeader,
  SidePanelTitle,
} from './side-panel'
export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'
export { Tip } from './Tip'
export { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

// Feedback
export { Callout, type CalloutTone } from './callout'
export { ConfirmDialog, ConfirmProvider, useConfirm, type ConfirmOptions } from './confirm-dialog'
export { EmptyState } from './empty-state'
export { Spinner } from './spinner'
export { LoadingBlock } from './loading-block'
export { ApiErrorBanner, formatApiErrorMessage } from './ApiErrorBanner'
export { StatusDot } from './status-dot'
export { PresenceDot } from './PresenceDot'
export { ThreadStatusDot } from './ThreadStatusDot'

// Data
export { Badge, badgeVariants, type BadgeTone } from './badge'
export { MetaLine } from './meta-line'
export { EntityRow, EntityList, DescriptionRow, SettingRow } from './entity-row'
export { StatTile, StatGrid } from './stat-tile'
export { Chart, type ChartKind, type ChartPoint, type ChartSeries } from './chart'
export { CapBar } from './cap-bar'
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table'

// Identity
export { IconTile, type IconTileTone } from './icon-tile'
export { Avatar, type AvatarProps, type TeamAvatarSource } from './avatar'
export { TagPill, TagPillInline } from './TagPill'
export { Hashtag, HashtagMark, HashtagSet } from './HashtagMark'
export { ChoiceSelect, type ChoiceGroup } from './ChoiceSelect'
export { ChoiceMark, ChoiceOption, type ChoiceItem, type ChoiceKind } from './ChoiceOption'
export { TeamFacepile } from './TeamFacepile'
export { AvatarStack, AVATAR_STACK_MAX, splitAvatarStack, type AvatarStackMember } from './AvatarStack'
export { AgentSelect } from './AgentSelect'

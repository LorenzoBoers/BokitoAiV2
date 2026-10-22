# Dashboard design system

One small catalog, managed centrally. Every screen is built from the
components below; a look changes in the component, never at the call site.
Import from `components/ui` (barrel `components/ui/index.ts`).

The agent rule `.cursor/rules/dashboard-design-system.mdc` holds the same
catalog in short form. `npm run lint` enforces it.

## Principles

- **Use, do not copy.** If the catalog has it, use it. No page-local
  segmented controls, option cards, pills, cap bars or confirm prompts.
- **Fix centrally.** A wrong look is a component bug. Change the component
  so every screen follows.
- **Fold rare styles.** A one-off style takes the nearest catalog component
  rather than becoming a new one.
- **Add deliberately.** A new primitive needs a second real use, an entry in
  this file and the rule, and an export in `index.ts`.
- **Calm Bokito feel.** Inter, warm-neutral surfaces, hairline borders, soft
  pills, no emoji, Lucide icons only.

## Tokens

| Token | Values |
|---|---|
| Font | `--font-sans` Inter, `--font-mono` JetBrains Mono (`index.css`) |
| Size | `text-2xs` 10.5, `xs` 11.5, `sm` 12.5, `base` 13.5, `lg` 15, `xl` 17, `2xl` 20 |
| Radius | shell `2xl`/`xl`; Card, Badge, OptionCard, Callout `lg`; InsetPanel, input, button, FilterChip `md`; `full` for avatars, dots, switches, count bubbles, label pills |
| Titles | `.title-page` (h1), `.title-dialog`, `.title-section`, `.title-card`, `.title-eyebrow` (`index.css`); primitives use them, so pages rarely set a heading size |
| Width | `max-w-form` 40rem, `reading` 56rem, `page` 62.5rem, `dense` 75rem, `shell` 77.5rem, `canvas` 112.5rem; rail `w-rail` / `w-rail-collapsed` |
| Backdrop | `.scrim` for every modal, drawer and tour overlay |
| Docs type | `text-docs-nav`, `text-docs-body`, `text-docs-h2`, `text-display` for `/docs` only |
| Surface | `bg` (chrome), `bg-surface` (cards), `bg-elevated` (insets), `bg-hover` (hover, neutral pills), `bg-input` (fields) |
| Status | `status-success`, `status-warning`, `status-error`, `status-info` |
| Identity | `accent` (brand), `ai` / `ai-ink` (agents, knowledge) |

Raw palette colors (`emerald-500`, `amber-600`, `red-500`) and arbitrary
sizes (`text-[13px]`) are not allowed.

No glows. AI is marked by color (`ai`, `ai-ink`) and a hairline, never by a
blur, halo, drop shadow or pulsing ring. Agent bubbles are a flat surface with
a 2px `ai` left edge; toasts and overlays are solid elevated surfaces.

The one exception is `AgentGlow`: a soft wash in the agent's own color on
agent showcase surfaces only (agent hero, Agents library card, marketplace
module card, specialist portrait). `placement="behind"` sits behind an avatar;
`corner-left` / `corner-right` washes a card corner. Rows, lists and chat stay
flat.

## Surfaces

```tsx
<Card>
  <CardHeader><CardTitle>Title</CardTitle></CardHeader>
  <CardContent>...</CardContent>
</Card>

<SettingsSection title="Branding" description="Shown in the widget." actions={<Button size="sm">Save</Button>}>
  ...
</SettingsSection>

<InsetPanel>Sublist or preview inside a card</InsetPanel>
<SectionHeading title="Members" description="People with access" actions={...} />

{/* Rail / side-panel group labels — one chrome for closable and static */}
<SectionLabel title="Folders" count={2} open={open} onOpenChange={setOpen}>{/* rows */}</SectionLabel>
<SectionLabel title="This conversation" /> {/* static: omit onOpenChange */}
{/* Rail reorder: pass dnd-kit listeners via titleButtonProps (distance ≥ 6 so click still toggles) */}
```

`className="panel"` is the CSS form of `Card` for elements that must stay a
`<section>`, `<li>` or `<button>`.

```tsx
<div className="relative overflow-hidden">
  <AmbientSpotlights />
  <div className="relative">{/* content sits above the wash */}</div>
</div>
```

`AmbientSpotlights` is one soft accent wash at the top of a large canvas or the signed-out pages.
The parent is `relative`. Content that should stay crisp uses `relative`.

## Controls

```tsx
<OptionCardGrid columns={4}>
  <OptionCard selected tone="ai" icon={<IconTile icon={Sparkles} tone="ai" />} title="Automatic" description="..." badge={<Badge variant="ai">Default</Badge>} onClick={...} />
</OptionCardGrid>

<SegmentedControl value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />

<FilterChipRow>
  <FilterChip active={type === null} onClick={() => setType(null)} count={12}>All</FilterChip>
</FilterChipRow>

<SearchField value={q} onChange={setQ} />
<TextLink to="/settings/models">Open models</TextLink>
```

Forms use `Input`, `Textarea`, `Select`, `Switch`, `Label`. Menus use
`DropdownMenu`; modals use `Dialog`; side sheets use `SidePanel`. Hover hints
use `Tip` (or a native `title`, which `NativeTitleTooltipBridge` upgrades).

`Button` variants: `default` (accent), `secondary` (hairline), `ghost`, `ai`,
`destructive`. Sizes `sm`, `md`, `lg`, `icon`, `iconSm`. Inline text actions
are `TextLink` (`tone="muted"` for quiet ones), never a raw `<button>`.

## Recipes

```tsx
<PageHeader title="Contacts" subtitle="People and companies" meta={<Button size="sm">New</Button>} />
<PageContent width="lg">...</PageContent>

<DangerZone title="Danger zone">
  <DangerZoneRow title="Delete workspace" description="..." action={<Button variant="destructive" size="sm">Delete</Button>} />
</DangerZone>

<AuthShell subtitle="Sign in to your workspace">{/* one card */}</AuthShell>
```

`PageHeader` is `components/shell/ContentHeader`. Every signed-out page
(login, signup, forgot / reset password, invite, verify email) uses
`AuthShell`; it owns the wordmark, the card and the copyright line.
Irreversible settings actions sit in one `DangerZone` at the bottom of the
page and confirm through `ConfirmDialog` or a `Dialog`.

## Feedback

```tsx
const confirm = useConfirm()
if (!(await confirm({ title: 'Delete key?', description: '...', destructive: true }))) return

<Callout tone="warning" title="Full access">This key can change settings.</Callout>
<EmptyState tone="dashed" icon={Inbox} title="No rules yet" action={<Button size="sm">Add rule</Button>} />
<Spinner size="sm" />
<LoadingBlock variant="skeleton" rows={3} />
```

`ConfirmDialog` with `typeToConfirm` covers type-the-name deletes.

## Data

```tsx
<Badge variant={statusTone(row.status)} dot>{label}</Badge>
<Badge variant={roleTone(member.role)}>{roleLabel}</Badge>
<MetaLine>{channel}{timeAgo}{count ? `${count} messages` : null}</MetaLine>

<EntityList>
  <EntityRow leading={<UserAvatar ... />} title={name} badges={<Badge>Admin</Badge>} meta={<MetaLine>...</MetaLine>} trailing={<Button variant="ghost" size="iconSm">...</Button>} />
</EntityList>

<StatGrid><StatTile label="Tokens today" value="12.4k" hint="of 50k" /></StatGrid>
<CapBar label="Daily tokens" value="12k / 50k" ratio={0.24} />

<Chart
  kind="bar"
  series={[{ name: 'Shipped', points: [{ x: 'W1', y: 2 }, { x: 'W2', y: 5 }] }]}
  xLabel="Week"
  yLabel="Items"
/>
```

`Chart` (`bar`, `line`, `area`) is the only quantitative plot. `showAxes={false}`
is the sparkline. `tone` is `accent` (default) or `ai` (violet first). Canvas
`BarChart` / `LineChart` use accent; Overview and Usage token series use `ai`.

Swimlane timelines stay custom: `AgentActivityTimeline` (agents on one clock,
markers, clusters, Now line). Do not force those into `Chart`.

Badge tones: `neutral`, `accent`, `ai`, `success`, `warning`, `error`,
`info`. Domain mapping lives in `lib/badge-tones.ts` (`statusTone`,
`roleTone`, `memberTypeTone`, `ratioTone`); add a mapping there instead of
coloring a pill locally.

## Identity

`IconTile` (`neutral`, `accent`, `ai`, `success`, `warning`, `error`; sizes
`sm`, `md`, `lg`) holds one icon or logo. Every round face renders through
`AvatarDisc` (image or initials). Face boxes share one ladder in
`lib/mark-scale.ts`: **16, 20, 24, 32, 40, 48, 64, 80, 96, 128**. A row uses
one step and a 4px gap (`gap-1`, `gap-2`, `gap-3`) so names start on the same
line. One face: `UserAvatar` (members),
`PersonAvatar` (a name or email only), `AgentMark` (agents; wraps `AiAvatar`), `ContactAvatar` (external people and companies),
`TeamAvatar` (empty-team fallback). A group of people and agents is
`AvatarStack`: three faces when there are three people or agents; with more, the third circle is +N. Agent orbs use a
silhouette cutout; people use a surface ring. `TeamFacepile` is that pile
for a team (member faces, otherwise `TeamAvatar`). The thread participant
row uses the same pile.

Named things in a menu always wear that same mark. Use `ChoiceSelect` for a
select of agents, people, teams, flows, projects, tags, calendars, or
connections. Pass `kind` plus the avatar or `brandSlug`; the closed control
and every row render `ChoiceOption`. `AgentSelect` is that picker for agents
only. A `DropdownMenu` of the same things uses `ChoiceOption` inside each
item. Enums (a mode, a language, a number) stay a plain `Select`.

State dots are `StatusDot` (8px): `PresenceDot` for availability,
`ThreadStatusDot` for conversation state, `HashtagMark` for a free label.
Labels are `TagPill` / `Hashtag` / `HashtagSet`; all three share
`TAG_PILL_SIZE` from `label-marks.ts`.

## Guard

`npm run lint` runs `scripts/check-design-system.mjs`:

| Rule | Fix |
|---|---|
| `window-confirm` | `useConfirm()` |
| `native-select` | `Select` |
| `arbitrary-text-size` | size ladder |
| `hand-rolled-card` | `Card` / `.panel` |
| `legacy-inset` | `InsetPanel` / `OptionCard` |
| `raw-status-color` | status tokens, `Badge`, `Callout` |
| `capsule-chip` | `Badge` / `FilterChip` |
| `legacy-class` | `Badge`, `InsetPanel`, `font-sans` |

Ratchet rules count per file against `scripts/design-system-baseline.json`;
a file may not gain more than its baseline:

| Rule | Fix |
|---|---|
| `raw-button` | `Button`, `TextLink` |
| `raw-input` | `Input`, `SearchField` |
| `hex-color` | color tokens |
| `arbitrary-radius` | radius scale |

After a cleanup, run `node scripts/check-design-system.mjs --update-baseline`
to lock in the lower counts.

The chat widget and the mobile app read the same palette and type from
`@bokito/ui-tokens` (Inter, JetBrains Mono). Only the tenant brand color
varies in the widget.

Exempt a line only with a `design-system-ignore` comment stating why.

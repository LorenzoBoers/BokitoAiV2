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
- **Calm Bokito feel.** Inter for the interface, Source Serif 4 for headings
  and agent text, warm-neutral surfaces, one border strength, flat controls,
  no emoji, Lucide icons only.

## Tokens

| Token | Values |
|---|---|
| Font | `--font-sans` Inter, `--font-serif` Source Serif 4, `--font-mono` JetBrains Mono (`index.css`) |
| Serif | Headings and agent text only: `.title-page`, `.title-dialog`, `.title-section` and the text of an agent reply. Everything else, own messages included, is sans |
| Size (px) | `text-2xs` 11.5/15, `xs` 13/19, `sm` 14/21, `base` 15/23, `lg` 16/25, `xl` 19/27, `2xl` 24/31 (size/line height, `packages/ui-tokens/src/typography.ts`) |
| Radius (px) | `sm` 4, `DEFAULT` 8, `md` 10, `lg` 12, `xl` 16, `2xl` 20, `3xl` 24, `full`. Card, Dialog `xl`; Callout `lg`; input, button, menu item `md`; Badge, avatars, dots, switches `full`. Two fixed shapes: chat bubble 18, composer 22 |
| Shadow | Buttons and cards are flat (`btn`, `card` = none). `shadow-overlay` for menus, popovers, drawers and dialogs; `shadow-composer` for the floating composer only |
| Border | `border-border` at full strength; `border-border-light` for fields. No opacity steps (`border-border/60`) |
| Titles | `.title-page` (h1, serif 30/36), `.title-dialog` (serif 20/28), `.title-section` (serif 18/26), `.title-card` (sans 14, 500), `.title-eyebrow` (sans 12.5, muted) in `index.css`; primitives use them, so pages rarely set a heading size |
| Shell | Topbar `h-topbar` 52px, transparent, no bottom rule. Sidebar and second rails `bg-bg-sidebar` without an edge line. `.nav-row` 34px, `.nav-folder` 28px |
| Icons | Lucide at stroke width 1.75 by default (`svg.lucide` in the base layer); pass `strokeWidth` only for a deliberate exception |
| Width | `max-w-form` 40rem, `reading` 56rem, `page` 62.5rem, `dense` 75rem, `shell` 77.5rem, `canvas` 112.5rem; rail `w-rail` / `w-rail-collapsed` |
| Backdrop | `.scrim` for every modal, drawer and tour overlay |
| Docs type | `text-docs-nav`, `text-docs-body`, `text-docs-h2`, `text-display` for `/docs` only |
| Surface | `bg` (page), `bg-sidebar` (sidebar and rails), `bg-surface` (cards, composer), `bg-elevated` (insets), `bg-hover` (hover, neutral pills, own chat message), `bg-input` (fields) |
| Status | `status-success`, `status-warning`, `status-error`, `status-info` |
| Identity | `accent` (brand), `ai` / `ai-ink` (agents, knowledge) |

Raw palette colors (`emerald-500`, `amber-600`, `red-500`), arbitrary
sizes (`text-[13px]`) and opacity steps on `text-text-muted` or
`border-border` are not allowed. Every text and accent pair in
`palette.mjs` keeps at least 4.5:1 contrast; `tokens.test.ts` fails below it.

No glows. AI is marked by color (`ai`, `ai-ink`) and the agent's mark,
never by a blur, halo, wash, drop shadow or pulsing ring; the bot orb shows
its mood in its face only. An agent reply has no bubble: serif text beside the
avatar. Your own message is a `bg-hover` bubble with normal ink. Toasts and
overlays are solid elevated surfaces.

Toasts come from `ui/toaster` (Sonner, `unstyled`), top right under the
topbar. Text is heading ink; only the Lucide icon carries the status color.
The action ("Undo", "Open") is a quiet `ghost` `xs` button in `accent-ink`, and
the close control sits last in the row and shows on hover or focus. A
`toast.custom` body uses the same card and `TOAST_CLOSE_CLASS`.

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

`<Card padding="compact|default">` sets the inner padding (12 / 16px; default
`none` for cards with their own header and rows). `<Card asChild>` makes a
`<section>`, `<li>`, `<a>` or `<button>` the card. There is no `.panel` class.

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

<Pressable onClick={open} className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-hover">...</Pressable>
```

Forms use `Input`, `Textarea`, `Select`, `Switch`, `Checkbox`, `Label`. Menus use
`DropdownMenu`; modals use `Dialog`; side sheets and mobile drawers use
`SidePanel` (`side="left"` for navigation). Both take `hideClose` when the
content brings its own close button. No hand-rolled `fixed inset-0` layer. Hover hints
use `Tip` (or a native `title`, which `NativeTitleTooltipBridge` upgrades).

`Button` variants: `default` (accent), `secondary` (hairline), `ghost`, `ai`,
`destructive`; all flat. Sizes `xs` 28, `sm` 32 (default), `md` 36, `lg` 40,
`icon` 32, `iconSm` 28. Set the height with `size`, never with `h-*` in
`className`. `icon` and `iconSm` are icon-only: square, with a minimum width
rather than a fixed one, so content can never spill over a neighbour. A
button that is sometimes labelled switches size with the label
(`size={iconOnly ? 'icon' : 'sm'}`). Inline text actions are `TextLink` (`tone="muted"` for quiet
ones). A click area without a button look (a whole row, tile, calendar cell,
scrim or docs control) is `Pressable`: `w-full`, `text-left`, `rounded-md` and a
focus ring, with `asChild`; add `w-auto` when it sits inline. A choice from a
group is `SegmentedControl`, `FilterChip` or `Tabs`. A raw `<button>` only
lives inside `components/ui`.

| Looks like | Use |
|---|---|
| Icon only | `Button variant="ghost" size="iconSm"` or `"icon"` with `aria-label` |
| Short text action | `Button variant="ghost" size="xs"` or `TextLink tone="muted"` |
| Whole row, card or tile | `Pressable` (or `EntityRow interactive`) |
| Menu trigger | `DropdownMenuTrigger asChild` around a `Button` or `Pressable` |
| One of a group | `SegmentedControl`, `FilterChip`, `Tabs` |

Fields (`Input`, `Select`, `SearchField`) are 36px with a `border-light` edge
and a 3px focus ring; `Textarea` shares the edge and ring. Menu and select
items are 32px. `Badge` is a 22px pill (`md`). `ComposerCard` is the
floating composer: radius 22, `bg-surface`, `shadow-composer`, no visible
edge, text 16/24.

## Recipes

```tsx
<PageHeader
  title="Contacts"
  subtitle="People and companies"
  guide="contacts"
  actions={<Button size="sm" variant="secondary">Refresh</Button>}
  primaryAction={<Button size="sm">New</Button>}
/>
<PageHeader back={{ to: '/contacts', label: 'All contacts' }} title={contact.name} />
<PageContent width="lg">...</PageContent>

<DangerZone title="Danger zone">
  <DangerZoneRow title="Delete workspace" description="..." action={<Button variant="destructive" size="sm">Delete</Button>} />
</DangerZone>

<AuthShell subtitle="Sign in to your workspace">{/* one card */}</AuthShell>
```

`PageHeader` (`components/ui/page-header`) owns the page's one `<h1>` in
`.title-page`. Every route starts with it. `primaryAction` is the one main
button and always shows; `actions` move behind a menu below `sm`. `back`
adds the arrow link of a detail page and `icon` a leading `IconTile`. The
topbar carries only the breadcrumb; below `md` it shows the title instead,
so a top-level page's heading is screen-reader only there (detail pages
keep theirs). A full-bleed screen (inbox, agenda, canvas) renders
`<PageHeader className="sr-only" title=... />`. Every signed-out page
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

An empty list or page is always `EmptyState`: one sentence and one action.
Use `tone="plain"` inside a card or panel and `size="sm"` in rails, panels
and menus. A "None yet" line that is really a field value stays text and
carries `design-system-ignore` with a reason.

`ConfirmDialog` with `typeToConfirm` is the only type-the-name delete. The phrase is a button: click copies it and fills the field.

## Data

```tsx
<Badge variant={statusTone(row.status)} dot>{label}</Badge>
<Badge variant={roleTone(member.role)}>{roleLabel}</Badge>
<MetaLine>{channel}{timeAgo}{count ? `${count} messages` : null}</MetaLine>

<EntityList loading={loading} empty="No members yet">
  <EntityRow
    href={`/contacts/${id}`}
    leading={<Avatar kind="person" ... />}
    title={name}
    badges={<Badge>Admin</Badge>}
    description={email}
    meta={timeAgo}
    actions={<Button variant="ghost" size="iconSm" aria-label="Remove">...</Button>}
    trailing={<Badge variant="success">Active</Badge>}
  />
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

## Lists

Every list row is `EntityRow`. Slots: `select` (a checkbox or state dot,
left of `leading`), `leading` (Avatar or IconTile), `title`, `badges`,
`description` (one line, truncated), `footer` (an extra line under the
description), `meta` (top right, for example a time), `trailing` (always
visible) and `actions`. Actions take no space until the row is hovered,
focused or has `data-menu-open`; then they replace `meta`. `density` is `sm`
(44px) or `md` (56px); `selected` (full hover tint, no lighter hover),
`unread` (title 600, plus an accent dot unless `select` carries the state),
`href` (the main zone is a link) and `interactive` with `onClick` (the main
zone is a `Pressable`). Select, actions and trailing sit outside the click
zone. `EntityList` draws the dividers and
takes `empty` (a title or an `EmptyState`) and `loading`. A new list without
`EntityRow` comes back in review.

| List | Component | On `EntityRow` |
|---|---|---|
| Contacts, companies | `pages/ContactsPage` | yes |
| Members, invites, agents | `pages/MemberManagement` | yes |
| Teams | `pages/TeamPage` | yes |
| Connections per program | `integrations/ConnectionSections` | yes |
| Folders | `pages/ProjectsPage` | yes |
| Labels | `inbox/TagRegistrySection` | yes |
| Proposal items | `inbox/ProposalItemPreview` | yes |
| Conversations | `inbox/ThreadListItem` | yes |
| Tickets on a flow | `flows/FlowTicketBoard` | no: a board of `FlowTicketCard`, no list view |
| Dense data (runs, MCP servers, Ops, usage) | `Table` | no: tables stay tables |

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
`sm`, `md`, `lg`) holds one icon or logo. Every face is one `Avatar`:

```tsx
<Avatar kind="person" name={member.name} email={member.email} imageUrl={member.avatarUrl} presence={status} />
<Avatar kind="person" name={contact.name} email={contact.address} domain={contact.host ?? null} />
<Avatar kind="agent" agent={agentRow} mode="static" activity={presence} />
<Avatar kind="team" team={teamRow} />
```

`person` is a photo, colored initials, or a quiet question mark for an
unknown visitor. Pass `domain` (null derives it from the email) for external
contacts so an organisation sender shows its favicon. `agent` takes the whole
agent, thread or picker row; it shows the bot orb unless the agent picked an
image, icon or initials. The violet `ai` ring only shows while the agent
works; people never wear it. Faces are decorative by default; pass
`decorative={false}` when the face stands alone without a name.

Face boxes share one ladder in
`lib/mark-scale.ts`: **16, 20, 24, 32, 40, 48, 64, 80, 96, 128**. A row uses
one step and a 4px gap (`gap-1`, `gap-2`, `gap-3`) so names start on the same
line. A group of people and agents is
`AvatarStack`: three faces when there are three people or agents; with more, the third circle is +N. Agent orbs use a
silhouette cutout; people use a surface ring. `TeamFacepile` is that pile
for a team (member faces, otherwise the team `Avatar`). The thread participant
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

## Rules

- Icons are 14, 16 or 20 (24, 32, 40 for display).
- Hover is `bg-bg-hover` at full strength or `/50`, nothing in between.
- One spinner: `Spinner`.
- Every page starts with `PageHeader`.
- No bare `button`: use `Button`, or `Pressable` for a click area without chrome.
- An empty list or page is always `EmptyState`.
- Every list row is `EntityRow`.

Gone from the catalog: `PageIntro` (use `PageHeader`), `ParticipantMark` and
the separate person, agent and team avatars (use `Avatar`), `.panel` (use
`Card padding`) and `TeamCardsSkeleton` (use `EntityList loading`).

## Guard

`npm run lint` runs `scripts/check-design-system.mjs`:

| Rule | Fix |
|---|---|
| `window-confirm` | `useConfirm()` |
| `native-select` | `Select` |
| `arbitrary-text-size` | size ladder |
| `hand-rolled-card` | `Card` |
| `panel-class` | `Card padding` / `Card asChild` |
| `legacy-inset` | `InsetPanel` / `OptionCard` |
| `raw-status-color` | status tokens, `Badge`, `Callout` |
| `capsule-chip` | `Badge` / `FilterChip` |
| `button-height-override` | `Button size` |
| `icon-button-label` (visible text in `size="icon"` / `"iconSm"`) | a text size (`xs`, `sm`), or a size that follows the label |
| `muted-text-opacity` | `text-text-muted` |
| `legacy-class` | `Badge`, `InsetPanel`, `font-sans` |
| `raw-spinner` | `Spinner` |
| `hover-tint` | `hover:bg-bg-hover` or `/50` |
| `page-tint` | `bg-bg`, `.scrim` |
| `raw-h1` | `PageHeader` (auth, docs and public trust pages are exempt) |
| `legacy-avatar` | `Avatar kind="person"`, `"agent"` or `"team"` |
| `raw-button` | `Button`, `Pressable`, `TextLink`, `FilterChip`, `SegmentedControl` |
| `hand-overlay` | `Dialog`, `SidePanel` (the tour is exempt) |
| `border-opacity` | `border-border`, `border-border-light` |

Face `size` on `Avatar`, `AvatarStack` and `TeamFacepile` stays on the mark
ladder (`mark-scale`).

Lucide icons also follow the icon scale: `size` 14, 16 or 20 (24, 32, 40 for
display) and no `strokeWidth`; the base layer sets 1.75.

Ratchet rules count per file against `scripts/design-system-baseline.json`;
a file may not gain more than its baseline:

| Rule | Fix |
|---|---|
| `raw-input` | `Input`, `SearchField`, `Checkbox` |
| `hex-color` | color tokens |
| `arbitrary-radius` | radius scale |
| `loose-empty-copy` | `EmptyState` (counted by `scripts/list-empty-copy.mjs`) |

After a cleanup, run `node scripts/check-design-system.mjs --update-baseline`
to lock in the lower counts.

The chat widget and the mobile app read the same palette and type from
`@bokito/ui-tokens` (Inter, JetBrains Mono). Radius and font size reach the
mobile `theme.generated.ts` as well. Only the tenant brand color
varies in the widget.

Exempt a line only with a `design-system-ignore` comment stating why.

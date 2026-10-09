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
| Radius | shell `2xl`/`xl`; Card, Badge, OptionCard, Callout `lg`; InsetPanel, input, button, FilterChip `md`; `full` for avatars, dots, switches, count bubbles |
| Surface | `bg` (chrome), `bg-surface` (cards), `bg-elevated` (insets), `bg-hover` (hover, neutral pills), `bg-input` (fields) |
| Status | `status-success`, `status-warning`, `status-error`, `status-info` |
| Identity | `accent` (brand), `ai` / `ai-ink` (agents, knowledge) |

Raw palette colors (`emerald-500`, `amber-600`, `red-500`) and arbitrary
sizes (`text-[13px]`) are not allowed.

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
```

`className="panel"` is the CSS form of `Card` for elements that must stay a
`<section>`, `<li>` or `<button>`.

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
`DropdownMenu`; modals use `Dialog`.

## Feedback

```tsx
const confirm = useConfirm()
if (!(await confirm({ title: 'Delete key?', description: '...', destructive: true }))) return

<Callout tone="warning" title="Full access">This key can change settings.</Callout>
<EmptyState tone="dashed" icon={Inbox} title="No rules yet" action={<Button size="sm">Add rule</Button>} />
<Spinner size="sm" />
<LoadingBlock variant="skeleton" rows={3} />
```

`ConfirmDialog` with `typeToConfirm` covers type-the-name deletes
(`ConfirmDeleteDialog` is a preset of it).

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

`Chart` (`bar`, `line`, `area`) is the only plot. `showAxes={false}` is the
sparkline. Colors are `accent`, then `ai`, then muted. Canvas `BarChart` /
`LineChart` and the Overview token sparkline both render this component.

Badge tones: `neutral`, `accent`, `ai`, `success`, `warning`, `error`,
`info`. Domain mapping lives in `lib/badge-tones.ts` (`statusTone`,
`roleTone`, `memberTypeTone`, `ratioTone`); add a mapping there instead of
coloring a pill locally.

## Identity

`IconTile` (`neutral`, `accent`, `ai`, `success`, `warning`, `error`; sizes
`sm`, `md`, `lg`) holds one icon or logo. Avatars: `UserAvatar` (members),
`AiAvatar` (agents), `ContactAvatar` (external people and companies),
`TeamAvatar` (teams).

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

Exempt a line only with a `design-system-ignore` comment stating why.
